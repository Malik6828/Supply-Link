use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Create a new batch/lot grouping.
    pub fn create_batch(
        env: Env,
        id: String,
        name: String,
        owner: Address,
    ) -> Batch {
        owner.require_auth();
        let batch = Batch {
            id: id.clone(),
            name,
            owner,
            product_ids: Vec::new(&env),
            timestamp: env.ledger().timestamp(),
            recalled: false,
            recall_reason: String::from_str(&env, ""),
            recall_timestamp: 0,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Batch(id.clone()), &batch);

        env.events().publish(
            (Symbol::new(&env, "batch_created"), id),
            batch.clone(),
        );
        batch
    }
    /// Recall an entire batch and propagate the recall to all contained products.
    ///
    /// Sets `batch.recalled = true` and calls `recall_product` for every
    /// product ID in `batch.product_ids`. Products that are already recalled
    /// are skipped (idempotent). Only the batch owner may trigger a batch recall.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `batch_id` — ID of the batch to recall.
    /// - `reason` — Human-readable recall reason (max 256 bytes).
    ///
    /// # Returns
    /// The number of products that were newly recalled (already-recalled
    /// products are not counted).
    ///
    /// # Authorization
    /// Requires `batch.owner.require_auth()`.
    ///
    /// # Panics
    /// - `"batch not found"` — if `batch_id` is not registered.
    ///
    /// # Emitted Events
    /// - `("batch_recalled", batch_id)` with the updated `Batch` as body.
    /// - `("product_recalled", product_id)` for each newly recalled product.
    pub fn recall_batch(
        env: Env,
        batch_id: String,
        reason: String,
    ) -> u32 {
        let mut batch: Batch = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id.clone()))
            .expect("batch not found");

        batch.owner.require_auth();

        if reason.len() > 256 {
            panic!("recall reason too long");
        }

        batch.recalled = true;
        batch.recall_reason = reason.clone();
        batch.recall_timestamp = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id.clone()), &batch);

        // Append to batch recall history
        let mut history: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::BatchRecallHistory(batch_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        history.push_back(reason.clone());
        env.storage()
            .persistent()
            .set(&DataKey::BatchRecallHistory(batch_id.clone()), &history);

        // Propagate recall to all contained products
        let mut newly_recalled: u32 = 0;
        for i in 0..batch.product_ids.len() {
            let product_id = batch.product_ids.get(i).unwrap();
            let product_opt: Option<crate::Product> = env
                .storage()
                .persistent()
                .get(&DataKey::Product(product_id.clone()));

            if let Some(mut product) = product_opt {
                if !product.recalled {
                    product.recalled = true;
                    product.recall_reason = reason.clone();
                    product.recall_timestamp = env.ledger().timestamp();
                    env.storage()
                        .persistent()
                        .set(&DataKey::Product(product_id.clone()), &product);

                    // Append to product recall history
                    let mut prod_history: Vec<String> = env
                        .storage()
                        .persistent()
                        .get(&DataKey::RecallHistory(product_id.clone()))
                        .unwrap_or_else(|| Vec::new(&env));
                    prod_history.push_back(reason.clone());
                    env.storage()
                        .persistent()
                        .set(&DataKey::RecallHistory(product_id.clone()), &prod_history);

                    env.events().publish(
                        (Symbol::new(&env, "product_recalled"), product_id),
                        true,
                    );
                    newly_recalled += 1;
                }
            }
        }

        env.events().publish(
            (Symbol::new(&env, "batch_recalled"), batch_id),
            batch,
        );

        newly_recalled
    }
    /// Lift a recall from a batch. Does NOT automatically unrecall contained products.
    ///
    /// # Authorization
    /// Requires `batch.owner.require_auth()`.
    pub fn unrecall_batch(env: Env, batch_id: String) -> bool {
        let mut batch: Batch = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id.clone()))
            .expect("batch not found");

        batch.owner.require_auth();

        batch.recalled = false;
        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id.clone()), &batch);

        env.events().publish(
            (Symbol::new(&env, "batch_unrecalled"), batch_id),
            false,
        );
        true
    }
    /// Return recall information for a batch: (recalled, reason, timestamp).
    pub fn get_batch_recall_info(env: Env, batch_id: String) -> (bool, String, u64) {
        let batch: Batch = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id))
            .expect("batch not found");
        (batch.recalled, batch.recall_reason, batch.recall_timestamp)
    }
    /// Return the full recall history for a batch.
    pub fn get_batch_recall_history(env: Env, batch_id: String) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::BatchRecallHistory(batch_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Add a product to a batch (batch owner-only).
    pub fn add_product_to_batch(
        env: Env,
        batch_id: String,
        product_id: String,
    ) -> bool {
        let mut batch: Batch = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id.clone()))
            .expect("batch not found");

        // Verify product exists
        if !env.storage().persistent().has(&DataKey::Product(product_id.clone())) {
            panic!("product not found");
        }

        batch.owner.require_auth();
        batch.product_ids.push_back(product_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Batch(batch_id.clone()), &batch);

        env.events().publish(
            (Symbol::new(&env, "product_added_to_batch"), batch_id),
            product_id,
        );
        true
    }
    /// Record an aggregate event against a batch (batch owner-only).
    /// The event is stored at the batch level and does NOT appear in
    /// individual product event logs.
    pub fn record_batch_event(
        env: Env,
        batch_id: String,
        caller: Address,
        location: String,
        event_type: String,
        metadata: String,
    ) -> TrackingEvent {
        let batch: Batch = env
            .storage()
            .persistent()
            .get(&DataKey::Batch(batch_id.clone()))
            .expect("batch not found");

        if batch.owner != caller {
            panic!("caller is not the batch owner");
        }
        caller.require_auth();

        let batch_event_timestamp = env.ledger().timestamp();
        let stable_id = compute_stable_id(&env, &batch_id, &caller, &event_type, batch_event_timestamp, &metadata);
        let event = TrackingEvent {
            schema_version: EVENT_SCHEMA_VERSION,
            product_id: batch_id.clone(),
            location,
            actor: caller,
            timestamp: batch_event_timestamp,
            event_type,
            metadata,
            metadata_commitment: String::from_str(&env, ""),
            private_metadata: false,
            stable_id,
        };

        let mut events: Vec<TrackingEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::BatchEvents(batch_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        events.push_back(event.clone());
        env.storage()
            .persistent()
            .set(&DataKey::BatchEvents(batch_id), &events);

        event
    }
    /// Get all events recorded at the batch level.
    pub fn get_batch_events(env: Env, batch_id: String) -> Vec<TrackingEvent> {
        env.storage()
            .persistent()
            .get(&DataKey::BatchEvents(batch_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Get a batch by ID.
    pub fn get_batch(env: Env, id: String) -> Batch {
        env.storage()
            .persistent()
            .get(&DataKey::Batch(id))
            .expect("batch not found")
    }
}
