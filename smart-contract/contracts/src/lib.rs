#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Bytes, BytesN, Env, String, Vec, Symbol};

// ── Schema version ────────────────────────────────────────────────────────────

/// Current schema version for Product and TrackingEvent structs (#392).
pub const SCHEMA_VERSION: u32 = 1;

// ── Error codes ───────────────────────────────────────────────────────────────


/// Current event schema version.
///
/// Bump this constant whenever the [`TrackingEvent`] payload layout changes in
/// a backward-incompatible way. Consumers should inspect the `schema_version`
/// field (and the matching topic slot) to select the correct parser.
///
/// | Version | Changes |
/// |---------|---------|
/// | 1       | Initial versioned schema. Adds `schema_version` field. |
/// | 2       | Adds `metadata_commitment` and `private_metadata` fields for privacy-preserving (off-chain encrypted) metadata. |
pub const EVENT_SCHEMA_VERSION: u32 = 2;

mod tests;
mod upgrade_tests;
mod resilience_tests;
mod compliance_tests;
mod archival_tests;
mod document_hash_tests;

// ── Payload size limits (issue #311) ─────────────────────────────────────────
// All limits are in bytes (Soroban String::len() returns byte count).
// | Field    | Max bytes | Notes                          |
// |----------|-----------|--------------------------------|
// | id       |       128 | Storage key; keep short        |
// | name     |       256 | Human-readable label           |
// | origin   |       256 | Geographic/org string          |
// | location |       256 | Per-event location             |
// | metadata |      4096 | JSON payload                   |
const MAX_ID_LEN:       u32 = 128;
const MAX_NAME_LEN:     u32 = 256;
const MAX_ORIGIN_LEN:   u32 = 256;
const MAX_LOCATION_LEN: u32 = 256;
const MAX_METADATA_LEN: u32 = 4096;
// Privacy commitment (issue #409): a hex-encoded hash of the off-chain encrypted
// payload. A SHA-256 hex digest is 64 chars; allow headroom for other digests.
const MAX_COMMITMENT_LEN: u32 = 128;

// ── Event expiration policy (issue #314) ──────────────────────────────────────
/// Pending events expire after this many seconds (7 days).
const EXPIRATION_WINDOW: u64 = 604_800;  // 7 * 24 * 60 * 60 seconds

mod types;
mod storage;
mod products;
mod events;
mod event_audit;
mod pagination;
mod authorization;
mod compliance;
mod certifications;
mod batches;
mod auditors;
mod documents;
mod provenance;
mod anomalies;
mod rejection_reason_tests;
mod proptest_tests;

fn assert_len(s: &String, max: u32, field: &'static str) {
    if s.len() > max { panic!("{} exceeds max length", field); }
}

/// Map an event_type string to the lifecycle stage it transitions the product to.
fn event_type_to_stage(env: &Env, event_type: &String) -> Option<LifecycleStage> {
    if *event_type == String::from_str(env, "HARVEST") {
        Some(LifecycleStage::Harvested)
    } else if *event_type == String::from_str(env, "PROCESSING") {
        Some(LifecycleStage::Processed)
    } else if *event_type == String::from_str(env, "SHIPPING") {
        Some(LifecycleStage::Shipped)
    } else if *event_type == String::from_str(env, "DELIVERY") {
        Some(LifecycleStage::Delivered)
    } else if *event_type == String::from_str(env, "RETAIL") {
        Some(LifecycleStage::Retail)
    } else {
        None
    }
}

/// Validate that the given event_type is allowed from the current lifecycle stage.
fn validate_lifecycle_transition(env: &Env, current: &LifecycleStage, event_type: &String) -> bool {
    match current {
        LifecycleStage::Registered => *event_type == String::from_str(env, "HARVEST"),
        LifecycleStage::Harvested  => *event_type == String::from_str(env, "PROCESSING"),
        LifecycleStage::Processed  => *event_type == String::from_str(env, "SHIPPING"),
        LifecycleStage::Shipped    => *event_type == String::from_str(env, "DELIVERY"),
        LifecycleStage::Delivered  => *event_type == String::from_str(env, "RETAIL"),
        LifecycleStage::Retail     => false,
    }
}


pub use types::*;
pub use storage::*;

#[contract]
pub struct SupplyLinkContract;

#[contractimpl]
impl SupplyLinkContract {
    /// Append a finalized event, or stage it for multi-signature approval, then
    /// emit the matching event. Shared by [`Self::add_tracking_event`] and
    /// [`Self::add_private_tracking_event`].
    pub(crate) fn record_event(env: &Env, product: &Product, event: TrackingEvent) {
        let product_id = event.product_id.clone();
        let event_type = event.event_type.clone();

        if product.required_signatures > 1 {
            // Stage event as pending with a stable ID
            let mut pending: Vec<PendingEvent> = env
                .storage()
                .persistent()
                .get(&DataKey::PendingEvents(product_id.clone()))
                .unwrap_or_else(|| Vec::new(env));

            let next_id: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::NextPendingId(product_id.clone()))
                .unwrap_or(0u64);

            let mut approvals = Vec::new(env);
            approvals.push_back(event.actor.clone());

            let pending_event = PendingEvent {
                pending_event_id: next_id,
                product_id: product_id.clone(),
                event: event.clone(),
                approvals,
                required_signatures: product.required_signatures,
                created_at: env.ledger().timestamp(),
                expiration: env.ledger().timestamp() + EXPIRATION_WINDOW,
            };

            pending.push_back(pending_event);
            env.storage()
                .persistent()
                .set(&DataKey::PendingEvents(product_id.clone()), &pending);

            env.storage()
                .persistent()
                .set(&DataKey::NextPendingId(product_id.clone()), &(next_id + 1));

            env.events().publish(
                (Symbol::new(env, "event_pending"), product_id, event_type, EVENT_SCHEMA_VERSION),
                event,
            );
        } else {
            // ── O(1) per-event keyed storage ─────────────────────────────────
            // Each event is stored under DataKey::EventEntry(product_id, index).
            // A per-product counter (DataKey::EventCount) tracks the next index.
            // This replaces the previous unbounded-Vec pattern which required
            // deserialising the entire event list on every write (O(n) CPU).
            let idx: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::EventCount(product_id.clone()))
                .unwrap_or(0u32);

            env.storage()
                .persistent()
                .set(&DataKey::EventEntry(product_id.clone(), idx), &event.clone());
            env.storage()
                .persistent()
                .set(&DataKey::EventCount(product_id.clone()), &(idx + 1));

            // #403/#402/#401: update indexes, store proof, mark hash seen
            update_event_indexes(env, &event);

            env.events().publish(
                (Symbol::new(env, "event_added"), product_id, event_type, EVENT_SCHEMA_VERSION),
                event,
            );
        }
    }
    pub(crate) fn require_admin(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("admin not initialized")
    }

    pub(crate) fn is_upgrade_guardian_internal(env: &Env, guardian: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::UpgradeGuardian(guardian))
            .unwrap_or(false)
    }
    pub(crate) fn compute_next_provenance_root(env: &Env, prev_root: &BytesN<32>, event: &TrackingEvent) -> BytesN<32> {
        let et_hash = env.crypto().sha256(&event.event_type.clone().to_xdr(env));
        let loc_hash = env.crypto().sha256(&event.location.clone().to_xdr(env));
        let meta_hash = env.crypto().sha256(&event.metadata.clone().to_xdr(env));
        let pid_hash = env.crypto().sha256(&event.product_id.clone().to_xdr(env));

        let mut input = Bytes::from_slice(env, &prev_root.to_array());
        input.append(&Bytes::from_slice(env, &et_hash.to_array()));
        input.append(&Bytes::from_slice(env, &loc_hash.to_array()));
        input.append(&Bytes::from_slice(env, &meta_hash.to_array()));
        input.append(&Bytes::from_slice(env, &pid_hash.to_array()));
        input.append(&Bytes::from_slice(env, &event.timestamp.to_be_bytes()));
        input.append(&Bytes::from_slice(env, &event.schema_version.to_be_bytes()));

        env.crypto().sha256(&input)
    }

    pub(crate) fn validate_and_increment_nonce(env: &Env, actor: &Address, provided_nonce: u64) {
        let current_nonce: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ActorNonce(actor.clone()))
            .unwrap_or(0);

        if provided_nonce != current_nonce {
            panic!("invalid nonce");
        }

        env.storage()
            .persistent()
            .set(&DataKey::ActorNonce(actor.clone()), &(current_nonce + 1));
    }
}

/// Compute a stable deterministic event ID.
///
/// Concatenates `product_id`, `actor` (as bytes), `event_type`, `timestamp`
/// (big-endian u64), and `metadata` into a single byte buffer, then returns
/// the SHA-256 hash as a lowercase hex `String`.
///
/// The result is invariant as long as the input fields are identical, making
/// it safe to use as a permanent reference across contract upgrades.
fn compute_stable_id(
    env: &Env,
    product_id: &String,
    actor: &Address,
    event_type: &String,
    timestamp: u64,
    metadata: &String,
) -> String {
    // Build a byte buffer: product_id bytes + event_type bytes + timestamp (8 bytes BE) + metadata bytes
    let pid_bytes = product_id.clone().to_xdr(env);
    let et_bytes = event_type.clone().to_xdr(env);
    let meta_bytes = metadata.clone().to_xdr(env);
    let actor_bytes = actor.clone().to_xdr(env);

    let ts_bytes: [u8; 8] = timestamp.to_be_bytes();
    let ts_buf = Bytes::from_array(env, &ts_bytes);

    let mut buf = Bytes::new(env);
    buf.append(&pid_bytes);
    buf.append(&actor_bytes);
    buf.append(&et_bytes);
    buf.append(&ts_buf);
    buf.append(&meta_bytes);

    let hash = env.crypto().sha256(&buf);

    // Encode hash as lowercase hex string
    let hex_chars = b"0123456789abcdef";
    let mut hex_bytes = [0u8; 64];
    for (i, byte) in hash.to_array().iter().enumerate() {
        hex_bytes[i * 2] = hex_chars[(byte >> 4) as usize];
        hex_bytes[i * 2 + 1] = hex_chars[(byte & 0xf) as usize];
    }

    // Return the hex string representing the SHA-256 digest.
    String::from_bytes(env, &hex_bytes)
}

fn update_event_indexes(env: &Env, event: &TrackingEvent) {
    // #403 — actor index
    let mut by_actor: Vec<String> = env
        .storage()
        .persistent()
        .get(&DataKey::EventsByActor(event.actor.clone()))
        .unwrap_or_else(|| Vec::new(env));
    by_actor.push_back(event.stable_id.clone());
    env.storage()
        .persistent()
        .set(&DataKey::EventsByActor(event.actor.clone()), &by_actor);

    // #403 — location index
    let mut by_loc: Vec<String> = env
        .storage()
        .persistent()
        .get(&DataKey::EventsByLocation(event.location.clone()))
        .unwrap_or_else(|| Vec::new(env));
    by_loc.push_back(event.stable_id.clone());
    env.storage()
        .persistent()
        .set(&DataKey::EventsByLocation(event.location.clone()), &by_loc);

    // #403 — event_type index
    let mut by_type: Vec<String> = env
        .storage()
        .persistent()
        .get(&DataKey::EventsByType(event.event_type.clone()))
        .unwrap_or_else(|| Vec::new(env));
    by_type.push_back(event.stable_id.clone());
    env.storage()
        .persistent()
        .set(&DataKey::EventsByType(event.event_type.clone()), &by_type);

    // #402 — signer proof
    let proof = SignerProof {
        event_stable_id: event.stable_id.clone(),
        signer: event.actor.clone(),
        payload_hash: event.stable_id.clone(), // stable_id IS the SHA-256 payload hash
        timestamp: event.timestamp,
    };
    env.storage()
        .persistent()
        .set(&DataKey::SignerProof(event.stable_id.clone()), &proof);

    // #401 — mark hash as seen (replay protection)
    env.storage()
        .persistent()
        .set(&DataKey::EventHashSeen(event.stable_id.clone()), &true);
}

fn paginate_string_vec(env: &Env, all: &Vec<String>, offset: u32, limit: u32) -> Vec<String> {
    let mut result = Vec::new(env);
    let len = all.len();
    let start = offset.min(len);
    let end = (offset + limit).min(len);
    for i in start..end {
        result.push_back(all.get(i).unwrap());
    }
    result
}

fn format_cert_id(env: &Env, product_id: &String, event_stable_id: &String) -> String {
    let mut result = String::from_str(env, "cert_");
    result.append(&product_id.clone());
    result.append(&String::from_str(env, "_"));
    result.append(&event_stable_id.clone());
    result
}

fn format_notarization_id(env: &Env, product_id: &String) -> String {
    let mut result = String::from_str(env, "notary_");
    result.append(&product_id.clone());
    result
}

fn format_event_cert_id(env: &Env, product_id: &String, event_stable_id: &String, cert_type: &String) -> String {
    let mut result = String::from_str(env, "eventcert_");
    result.append(&product_id.clone());
    result.append(&String::from_str(env, "_"));
    result.append(&event_stable_id.clone());
    result.append(&String::from_str(env, "_"));
    result.append(&cert_type.clone());
    result
}

fn format_anomaly_id(env: &Env, product_id: &String) -> String {
    let mut result = String::from_str(env, "anomaly_");
    result.append(&product_id.clone());
    result
}
