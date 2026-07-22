use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Register a new auditor. Admin-only.
    ///
    /// # Parameters
    /// - `auditor_address` — Stellar address of the auditor to register.
    /// - `name` — Human-readable name of the auditing organisation (max 256 bytes).
    ///
    /// # Authorization
    /// Requires the contract admin's `require_auth()`.
    ///
    /// # Panics
    /// - `"admin not initialized"` — if no admin has been set.
    /// - `"auditor already registered"` — if the address is already registered.
    /// - `"name too long"` — if name exceeds 256 bytes.
    ///
    /// # Emitted Events
    /// Publishes `("auditor_registered", auditor_address)` with the `Auditor` struct.
    pub fn register_auditor(
        env: Env,
        auditor_address: Address,
        name: String,
    ) -> Auditor {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("admin not initialized");
        admin.require_auth();

        if env.storage().persistent().has(&DataKey::Auditor(auditor_address.clone())) {
            panic!("auditor already registered");
        }
        assert_len(&name, MAX_NAME_LEN, "name");

        let auditor = Auditor {
            address: auditor_address.clone(),
            name,
            active: true,
            registered_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Auditor(auditor_address.clone()), &auditor);

        env.events().publish(
            (Symbol::new(&env, "auditor_registered"), auditor_address),
            auditor.clone(),
        );

        auditor
    }
    /// Deactivate a registered auditor. Admin-only.
    ///
    /// Deactivated auditors cannot submit new attestations. Existing
    /// attestations remain valid and queryable.
    ///
    /// # Authorization
    /// Requires the contract admin's `require_auth()`.
    pub fn deactivate_auditor(env: Env, auditor_address: Address) -> bool {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("admin not initialized");
        admin.require_auth();

        let mut auditor: Auditor = env
            .storage()
            .persistent()
            .get(&DataKey::Auditor(auditor_address.clone()))
            .expect("auditor not found");

        auditor.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Auditor(auditor_address.clone()), &auditor);

        env.events().publish(
            (Symbol::new(&env, "auditor_deactivated"), auditor_address),
            false,
        );
        true
    }
    /// Return the auditor record for a given address, if registered.
    pub fn get_auditor(env: Env, auditor_address: Address) -> Option<Auditor> {
        env.storage()
            .persistent()
            .get(&DataKey::Auditor(auditor_address))
    }
    /// Check whether an address is a currently active registered auditor.
    pub fn is_active_auditor(env: Env, auditor_address: Address) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, Auditor>(&DataKey::Auditor(auditor_address))
            .map(|a| a.active)
            .unwrap_or(false)
    }
    /// Submit a signed attestation for a product or a specific product event.
    ///
    /// Only registered, active auditors may submit attestations. The `signature`
    /// field must be a hex-encoded Ed25519 signature over the canonical payload:
    /// `product_id|target_id|attestation_type|timestamp` (UTF-8, pipe-separated).
    ///
    /// # Parameters
    /// - `product_id` — ID of the product being attested.
    /// - `target_id` — Stable event ID (`TrackingEvent.stable_id`) if attesting
    ///   a specific event, or empty string for a product-level attestation.
    /// - `auditor_address` — Stellar address of the submitting auditor.
    /// - `attestation_id` — Caller-supplied unique ID for this attestation (max 128 bytes).
    /// - `attestation_type` — Type key (e.g. `"quality_check"`, `"origin_verified"`).
    /// - `signature` — Hex-encoded Ed25519 signature (max 128 bytes).
    /// - `notes` — Optional auditor notes (max 1024 bytes).
    ///
    /// # Authorization
    /// Requires `auditor_address.require_auth()`.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    /// - `"auditor not registered"` — if the address is not in the registry.
    /// - `"auditor is not active"` — if the auditor has been deactivated.
    /// - `"attestation_id too long"` — if attestation_id exceeds 128 bytes.
    /// - `"attestation_type too long"` — if attestation_type exceeds 64 bytes.
    /// - `"signature too long"` — if signature exceeds 128 bytes.
    /// - `"notes too long"` — if notes exceed 1024 bytes.
    ///
    /// # Emitted Events
    /// Publishes `("attestation_submitted", product_id)` with the `Attestation` struct.
    pub fn submit_attestation(
        env: Env,
        product_id: String,
        target_id: String,
        auditor_address: Address,
        attestation_id: String,
        attestation_type: String,
        signature: String,
        notes: String,
    ) -> Attestation {
        // Verify product exists
        if !env.storage().persistent().has(&DataKey::Product(product_id.clone())) {
            panic!("product not found");
        }

        // Verify auditor is registered and active
        let auditor: Auditor = env
            .storage()
            .persistent()
            .get(&DataKey::Auditor(auditor_address.clone()))
            .expect("auditor not registered");

        if !auditor.active {
            panic!("auditor is not active");
        }

        auditor_address.require_auth();

        // Validate field lengths
        assert_len(&attestation_id, MAX_ID_LEN, "attestation_id");
        assert_len(&attestation_type, 64, "attestation_type");
        assert_len(&signature, MAX_COMMITMENT_LEN, "signature");
        if notes.len() > 1024 {
            panic!("notes too long");
        }

        let attestation = Attestation {
            id: attestation_id,
            product_id: product_id.clone(),
            target_id,
            auditor: auditor_address,
            attestation_type,
            signature,
            timestamp: env.ledger().timestamp(),
            notes,
        };

        let mut attestations: Vec<Attestation> = env
            .storage()
            .persistent()
            .get(&DataKey::Attestations(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        attestations.push_back(attestation.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Attestations(product_id.clone()), &attestations);

        env.events().publish(
            (Symbol::new(&env, "attestation_submitted"), product_id),
            attestation.clone(),
        );

        attestation
    }
    /// Return all attestations for a product (both product-level and event-level).
    pub fn get_attestations(env: Env, product_id: String) -> Vec<Attestation> {
        env.storage()
            .persistent()
            .get(&DataKey::Attestations(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Return attestations for a specific event (filtered by target_id).
    pub fn get_event_attestations(
        env: Env,
        product_id: String,
        target_id: String,
    ) -> Vec<Attestation> {
        let all: Vec<Attestation> = env
            .storage()
            .persistent()
            .get(&DataKey::Attestations(product_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut filtered = Vec::new(&env);
        for i in 0..all.len() {
            let a = all.get(i).unwrap();
            if a.target_id == target_id {
                filtered.push_back(a);
            }
        }
        filtered
    }
}
