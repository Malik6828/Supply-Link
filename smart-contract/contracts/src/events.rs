use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Add a tracking event for a product. Enforces lifecycle stage transitions (#404).
    /// Add a tracking event for a product.
    ///
    /// Appends a new [`TrackingEvent`] to the product's event log. The event
    /// log is stored as a `Vec<TrackingEvent>` and grows with each call.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product to record the event against.
    /// - `caller` — Address of the supply-chain participant submitting the
    ///   event. Must be the product owner or an address in
    ///   `authorized_actors`.
    /// - `location` — Free-form location string (e.g. `"Port of Hamburg"`).
    /// - `event_type` — Canonical supply-chain stage. Must be one of:
    ///   `"HARVEST"`, `"PROCESSING"`, `"SHIPPING"`, `"RETAIL"`.
    ///   Unknown values are rejected with `"invalid event_type"` (issue #310).
    /// - `metadata` — Arbitrary JSON string with stage-specific data.
    ///
    /// # Returns
    /// The newly created [`TrackingEvent`] struct.
    ///
    /// # Authorization
    /// Requires `caller.require_auth()`. The authorization check is performed
    /// *after* verifying that `caller` is the owner or an authorized actor, so
    /// unauthorized addresses are rejected before any auth overhead is incurred.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    /// - `"caller is not authorized"` — if `caller` is neither the product
    ///   owner nor in `authorized_actors`.
    ///
    /// # Emitted Events
    /// - When `product.required_signatures <= 1`: publishes an
    ///   `("event_added", product_id, event_type, schema_version)` event with
    ///   the [`TrackingEvent`] struct as the event body.
    /// - When `product.required_signatures > 1`: the event is staged as
    ///   pending and an `("event_pending", product_id, event_type,
    ///   schema_version)` event is published instead. The event is not added
    ///   to the finalized log until [`Self::approve_event`] collects enough
    ///   approvals.
    pub fn add_tracking_event(
        env: Env,
        product_id: String,
        caller: Address,
        location: String,
        event_type: String,
        metadata: String,
    ) -> Result<TrackingEvent, Error> {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .ok_or(Error::ProductNotFound)?;

        if !product.active {
            panic!("product is deactivated");
        }

        // Emergency stop: reject writes when contract is paused.
        if env.storage().persistent().get(&DataKey::ContractPaused).unwrap_or(false) {
            return Err(Error::ContractPaused);
        }

        // Reject events on recalled products (#393)
        if product.recalled {
            panic!("product is recalled");
        }

        let caller = product.owner.clone();
        // Verify caller is owner or an authorized actor before requiring auth
        let is_owner = product.owner == caller;
        let is_actor = product.authorized_actors.contains(&caller);
        if !is_owner && !is_actor {
            return Err(Error::NotAuthorized);
        }
        caller.require_auth();
        // Issue #311: enforce size limits.
        assert_len(&location, MAX_LOCATION_LEN, "location");
        assert_len(&metadata, MAX_METADATA_LEN, "metadata");

        let timestamp = env.ledger().timestamp();

        // Compute stable_id: SHA-256 of "product_id|event_type|timestamp" encoded as bytes
        let stable_id = compute_stable_id(&env, &product_id, &caller, &event_type, timestamp, &metadata);

        // #401: Replay protection — reject duplicate event hashes
        if env.storage().persistent().get::<DataKey, bool>(&DataKey::EventHashSeen(stable_id.clone())).unwrap_or(false) {
            panic!("duplicate event: replay detected");
        }

        // Enforce lifecycle transition (#404)
        if !validate_lifecycle_transition(&env, &product.lifecycle_stage, &event_type) {
            panic!("invalid lifecycle transition");
        }

        // Advance lifecycle stage if this event triggers a transition
        if let Some(next_stage) = event_type_to_stage(&env, &event_type) {
            product.lifecycle_stage = next_stage;
            env.storage()
                .persistent()
                .set(&DataKey::Product(product_id.clone()), &product);
        }

        let event = TrackingEvent {
            schema_version: EVENT_SCHEMA_VERSION,
            product_id: product_id.clone(),
            location,
            actor: caller,
            timestamp,
            event_type: event_type.clone(),
            metadata,
            metadata_commitment: String::from_str(&env, ""),
            private_metadata: false,
            stable_id,
        };

        Self::record_event(&env, &product, event.clone());

        Ok(event)
    }
    /// Submit multiple tracking events for a single product in one call.
    ///
    /// Each event is stored as an independent `DataKey::EventEntry` entry
    /// (O(1) per event). The total cost scales linearly with `events.len()`,
    /// matching the acceptance criterion that batch operations scale linearly
    /// with input size.
    ///
    /// # Parameters
    /// - `product_id` — product all events belong to.
    /// - `caller`     — must be product owner or authorized actor.
    /// - `locations`  — one location string per event.
    /// - `event_types`— one event_type string per event.
    /// - `metadatas`  — one metadata string per event.
    ///
    /// All three Vecs must have the same length, capped at 20.
    pub fn batch_add_tracking_events(
        env: Env,
        product_id: String,
        caller: Address,
        locations: Vec<String>,
        event_types: Vec<String>,
        metadatas: Vec<String>,
    ) -> Vec<TrackingEvent> {
        let n = locations.len();
        if n > 20 {
            panic!("batch size exceeds maximum of 20 events");
        }
        if n != event_types.len() || n != metadatas.len() {
            panic!("locations, event_types, and metadatas must have equal length");
        }

        let mut results = Vec::new(&env);
        for i in 0..n {
            let loc = locations.get(i).unwrap();
            let et = event_types.get(i).unwrap();
            let meta = metadatas.get(i).unwrap();
            // Delegate to the single-event path to reuse all validation logic.
            // Each call is O(1) with the new keyed-storage backend.
            let event = Self::add_tracking_event(
                env.clone(),
                product_id.clone(),
                caller.clone(),
                loc,
                et,
                meta,
            );
            if let Ok(ev) = event {
                results.push_back(ev);
            }
        }
        results
    }
    /// Return CPU-instruction and storage-entry estimates for common operations.
    ///
    /// All values are based on the measured budgets in `profiling.rs` and the
    /// documented thresholds in `docs/storage-cost-budget.md`. This is a
    /// pure view function — it reads the current event/product counts and
    /// returns a deterministic estimate without modifying any state.
    ///
    /// # Returns
    /// A four-element Vec<u64>:
    ///   [0] estimated CPU instructions for `add_tracking_event`
    ///   [1] estimated CPU instructions for `register_product`
    ///   [2] estimated CPU instructions for `get_tracking_events_page(limit=10)`
    ///   [3] current event count for `product_id` (0 if product has no events)
    pub fn estimate_gas(env: Env, product_id: String) -> Vec<u64> {
        // Base costs derived from profiling suite measurements.
        const BASE_ADD_EVENT_CPU: u64 = 1_800_000;   // O(1) keyed write baseline
        const BASE_REGISTER_CPU: u64 = 1_200_000;    // two writes + one RMW
        const PER_EVENT_READ_CPU: u64 = 120_000;     // per-entry read cost (10 events)

        let event_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::EventCount(product_id))
            .unwrap_or(0u32);

        let mut estimates = Vec::new(&env);
        estimates.push_back(BASE_ADD_EVENT_CPU);
        estimates.push_back(BASE_REGISTER_CPU);
        // get_tracking_events_page with limit=10: 10 × per-entry read
        estimates.push_back(PER_EVENT_READ_CPU * 10);
        estimates.push_back(event_count as u64);
        estimates
    }
    pub fn add_private_tracking_event(
        env: Env,

        product_id: String,
        caller: Address,
        location: String,
        event_type: String,
        metadata_commitment: String,
    ) -> Result<TrackingEvent, Error> {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .ok_or(Error::ProductNotFound)?;

        let is_owner = product.owner == caller;
        let is_actor = product.authorized_actors.contains(&caller);
        if !is_owner && !is_actor {
            return Err(Error::NotAuthorized);
        }
        caller.require_auth();

        assert_len(&location, MAX_LOCATION_LEN, "location");
        if metadata_commitment.len() == 0 {
            panic!("commitment required for private metadata");
        }
        assert_len(&metadata_commitment, MAX_COMMITMENT_LEN, "metadata_commitment");

        let event = TrackingEvent {
            schema_version: EVENT_SCHEMA_VERSION,
            product_id: product_id.clone(),
            location,
            actor: caller.clone(),
            timestamp: env.ledger().timestamp(),
            event_type,
            // Plaintext is NEVER stored on-chain for private events.
            metadata: String::from_str(&env, ""),
            metadata_commitment,
            private_metadata: true,
        };

        Self::record_event(&env, &product, event.clone());

        Ok(event)
    }
    pub fn get_tracking_events(env: Env, product_id: String) -> Vec<TrackingEvent> {
        // Backward-compat: return up to the first 50 events via the O(1) keyed store.
        // Callers that need a specific page should use get_tracking_events_page.
        Self::get_tracking_events_page(env, product_id, 0, 50)
    }
    /// Return the number of tracking events recorded for a product.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — The product ID to query.
    ///
    /// # Returns
    /// The number of events as a `u32`. Returns `0` if the product has no
    /// events or does not exist.
    ///
    /// # Note
    /// This function deserialises the full `Vec<TrackingEvent>` from storage
    /// to read its length. It has the same storage cost as
    /// `get_tracking_events(product_id).len()` and is not a cheaper
    /// alternative for large event logs.
    ///
    /// # Authorization
    /// None — this is a read-only function.
    ///
    /// # Panics
    /// Does not panic.
    pub fn get_events_count(env: Env, product_id: String) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::EventCount(product_id))
            .unwrap_or(0u32)
    }
    /// Return a paginated slice of tracking events for a product.
    ///
    /// Events are returned in insertion order (oldest first).
    ///
    /// # Parameters
    /// - `product_id` — The product to query.
    /// - `offset` — Zero-based index of the first event to return.
    /// - `limit` — Maximum number of events to return.
    ///
    /// # Returns
    /// A `Vec<TrackingEvent>`. Returns an empty vector if offset is beyond
    /// the total count or the product has no events.
    pub fn list_tracking_events(
        env: Env,
        product_id: String,
        offset: u32,
        limit: u32,
    ) -> Vec<TrackingEvent> {
        let all: Vec<TrackingEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::Events(product_id))
            .unwrap_or_else(|| Vec::new(&env));

        let total = all.len();
        if offset >= total {
            return Vec::new(&env);
        }

        let end = core::cmp::min(offset + limit, total);
        let mut page = Vec::new(&env);
        for i in offset..end {
            page.push_back(all.get(i).unwrap());
        }
        page
    }
    /// Return the total number of tracking events for a product.
    /// Alias of `get_events_count` — provided for API symmetry with `list_tracking_events`.
    pub fn count_tracking_events(env: Env, product_id: String) -> u32 {
        env.storage()
            .persistent()
            .get::<DataKey, Vec<TrackingEvent>>(&DataKey::Events(product_id))
            .map(|v| v.len())
            .unwrap_or(0)
    }
    /// Approve a pending event for a high-value product.
    ///
    /// For products with `required_signatures > 1`, events are staged as pending
    /// until the required number of approvals are received. This function allows
    /// authorized actors to approve a pending event using its stable identifier.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment (injected by the runtime).
    /// - `product_id` — ID of the product.
    /// - `pending_event_id` — Stable ID of the pending event to approve.
    ///   This ID remains unchanged even if other pending events are removed.
    /// - `approver` — Address of the actor approving the event.
    /// - `nonce` — Sequential nonce for authorization, incremented by the contract.
    ///
    /// # Returns
    /// `true` if the event was finalized (all signatures received), `false` if
    /// more approvals are needed.
    ///
    /// # Authorization
    /// Requires `approver.require_auth()`. The approver must be the owner or
    /// an authorized actor.
    ///
    /// # Errors
    /// - [`Error::ProductNotFound`] — if `product_id` is not registered.
    /// - [`Error::ApproverNotAuthorized`] — if approver is not owner or actor.
    /// - [`Error::NoPendingEvents`] — if there are no pending events.
    /// - [`Error::PendingEventExpired`] — if the pending event has expired (issue #314).
    ///
    /// # Panics
    /// - `"event index out of bounds"` — if `event_index` is invalid.
    ///
    /// # Emitted Events
    /// - When the event is **not yet finalized**: no event is emitted.
    /// - When the event **is finalized** (approvals reach `required_signatures`):
    ///   publishes an `("event_finalized", product_id, event_type,
    ///   schema_version)` event with the [`TrackingEvent`] struct as the body.
    pub fn approve_event(
        env: Env,
        product_id: String,
        pending_event_id: u64,
        approver: Address,
        nonce: u64,
    ) -> Result<bool, Error> {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .ok_or(Error::ProductNotFound)?;

        let is_owner = product.owner == approver;
        let is_actor = product.authorized_actors.contains(&approver);
        if !is_owner && !is_actor {
            return Err(Error::ApproverNotAuthorized);
        }
        approver.require_auth();
        Self::validate_and_increment_nonce(&env, &approver, nonce);

        let mut pending: Vec<PendingEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingEvents(product_id.clone()))
            .ok_or(Error::NoPendingEvents)?;

        // Find the pending event by stable ID (not index-based)
        let mut event_position: Option<usize> = None;
        for i in 0..pending.len() {
            if pending.get(i).unwrap().pending_event_id == pending_event_id {
                event_position = Some(i);
                break;
            }
        }

        let event_index = event_position.ok_or_else(|| {
            panic!("pending event not found")
        })?;

        let mut pending_event = pending.get(event_index).unwrap().clone();

        // Check expiration (issue #314)
        let current_time = env.ledger().timestamp();
        if current_time > pending_event.expiration {
            return Err(Error::PendingEventExpired);
        }

        if !pending_event.approvals.contains(&approver) {
            pending_event.approvals.push_back(approver.clone());
        }

        let is_finalized = pending_event.approvals.len() as u32 >= pending_event.required_signatures;

        if is_finalized {
            let mut events: Vec<TrackingEvent> = env
                .storage()
                .persistent()
                .get(&DataKey::Events(product_id.clone()))
                .unwrap_or_else(|| Vec::new(&env));

            events.push_back(pending_event.event.clone());
            env.storage()
                .persistent()
                .set(&DataKey::Events(product_id.clone()), &events);

            // Update provenance root
            let prev_root: BytesN<32> = env
                .storage()
                .persistent()
                .get(&DataKey::ProvenanceRoot(product_id.clone()))
                .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]));
            let new_root = Self::compute_next_provenance_root(&env, &prev_root, &pending_event.event);
            env.storage()
                .persistent()
                .set(&DataKey::ProvenanceRoot(product_id.clone()), &new_root);

            // Remove from pending
            pending.remove(event_index);
            if pending.len() > 0 {
                env.storage()
                    .persistent()
                    .set(&DataKey::PendingEvents(product_id.clone()), &pending);
            } else {
                env.storage()
                    .persistent()
                    .remove(&DataKey::PendingEvents(product_id.clone()));
            }

            env.events().publish(
                (
                    Symbol::new(&env, "event_finalized"),
                    product_id,
                    pending_event.event.event_type.clone(),
                    EVENT_SCHEMA_VERSION,
                ),
                pending_event.event,
            );

            Ok(true)
        } else {
            // Update pending event with new approval
            pending.set(event_index, pending_event);
            env.storage()
                .persistent()
                .set(&DataKey::PendingEvents(product_id), &pending);
            Ok(false)
        }
    }
    /// Reject a pending event for a high-value product.
    ///
    /// Removes a pending event from the approval queue without finalizing it.
    /// Optionally accepts a reason for the rejection for audit purposes.
    /// Uses the stable identifier of the pending event to ensure deterministic
    /// behavior even after queue mutations.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product.
    /// - `pending_event_id` — Stable ID of the pending event to reject.
    ///   This ID remains unchanged even if other pending events are removed.
    /// - `rejector` — Address of the actor rejecting the event.
    /// - `reason` — Optional reason for rejection (max 256 characters).
    /// - `nonce` — Sequential nonce for authorization, incremented by the contract.
    ///
    /// # Returns
    /// `true` on success.
    ///
    /// # Authorization
    /// Requires `rejector.require_auth()`. The rejector must be the owner.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    /// - `"only owner can reject"` — if rejector is not the owner.
    /// - `"no pending events"` — if there are no pending events.
    /// - `"pending event not found"` — if `pending_event_id` doesn't match any pending event.
    /// - `"rejection reason too long"` — if reason exceeds 256 characters.
    /// - `"invalid nonce"` — if nonce does not match the expected sequential value.
    pub fn reject_event(
        env: Env,
        product_id: String,
        pending_event_id: u64,
        rejector: Address,
        reason: String,
        nonce: u64,
    ) -> Result<bool, Error> {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");
        product.owner.require_auth();

        let mut policy: AuthPolicy = env
            .storage()
            .persistent()
            .get(&DataKey::AuthPolicy(product_id.clone()))
            .unwrap_or(AuthPolicy {
                threshold: 1,
                roles: Vec::new(&env),
            });

        // Replace existing role for actor or append
        let mut new_roles: Vec<ActorRole> = Vec::new(&env);
        let mut replaced = false;
        for i in 0..policy.roles.len() {
            let ar = policy.roles.get(i).unwrap();
            if ar.actor == actor {
                new_roles.push_back(ActorRole { actor: actor.clone(), role: role.clone() });
                replaced = true;
            } else {
                new_roles.push_back(ar);
            }
        }
        if !replaced {
            new_roles.push_back(ActorRole { actor, role });
        }
        policy.roles = new_roles;

        env.storage()
            .persistent()
            .set(&DataKey::AuthPolicy(product_id), &policy);
        true
    }
}
