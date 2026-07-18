use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Register a new product on-chain.
    ///
    /// Creates a [`Product`] entry in persistent storage and initialises the
    /// global product counter and index mapping used by
    /// [`Self::list_products`].
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment (injected by the runtime).
    /// - `id` — Caller-supplied unique product identifier. Must not already
    ///   exist; duplicate IDs are rejected with `"product already exists"`.
    /// - `name` — Human-readable product name.
    /// - `origin` — Geographic or organisational origin of the product.
    /// - `owner` — Stellar address that will own the product. This address
    ///   must sign the transaction.
    /// - `required_signatures` — Number of approvals required for events (0 or 1 = immediate, >1 = multi-sig).
    ///
    /// # Returns
    /// The newly created [`Product`] struct.
    ///
    /// # Authorization
    /// Requires `owner.require_auth()`. The transaction must be signed by
    /// `owner`.
    ///
    /// # Warning
    /// If a product with `id` already exists it will be **silently overwritten**
    /// with the new `name`, `origin`, `owner`, and `required_signatures`. The
    /// previous product's data is lost. Additionally, the global
    /// `ProductCount` and `ProductIndex` are incremented unconditionally, so a
    /// duplicate registration creates a ghost index entry pointing to the same
    /// `id`. Callers should use [`Self::product_exists`] to guard against
    /// accidental overwrites.
    ///
    /// # Panics
    /// - `"product already exists"` — if a product with `id` is already registered.
    ///   `product_count` and index mappings are NOT modified on rejection.
    ///
    /// # Emitted Events
    /// Publishes a `("product_registered", id)` event with the [`Product`]
    /// struct as the event body.
    pub fn register_product(
        env: Env,
        id: String,
        name: String,
        origin: String,
        owner: Address,
        required_signatures: u32,
        category: String,
        subcategory: String,
    ) -> Product {
        // Duplicate guard — must come before auth to avoid leaking state on
        // duplicate attempts and to keep counter/index consistent.
        if env.storage().persistent().has(&DataKey::Product(id.clone())) {
            panic!("product already exists");
        }

        // Emergency stop: reject writes when contract is paused.
        if env.storage().persistent().get(&DataKey::ContractPaused).unwrap_or(false) {
            panic!("contract is paused");
        }

        owner.require_auth();
        // Issue #311: enforce size limits.
        assert_len(&id,          MAX_ID_LEN,     "id");
        assert_len(&name,        MAX_NAME_LEN,   "name");
        assert_len(&origin,      MAX_ORIGIN_LEN, "origin");
        assert_len(&category,    64,             "category");
        assert_len(&subcategory, 64,             "subcategory");
        let product = Product {
            id: id.clone(),
            name,
            origin,
            owner,
            timestamp: env.ledger().timestamp(),
            authorized_actors: Vec::new(&env),
            recalled: false,
            recall_reason: String::from_str(&env, ""),
            recall_timestamp: 0,
            schema_version: SCHEMA_VERSION,
            expiration_timestamp: 0,
            spoiled: false,
            required_signatures,
            active: true,
            category,
            subcategory,
            hazardous: false,
            hazard_classification: String::from_str(&env, ""),
            lifecycle_stage: LifecycleStage::Registered,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Product(id.clone()), &product);

        let count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ProductCount)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::ProductCount, &(count + 1));
        env.storage()
            .persistent()
            .set(&DataKey::ProductIndex(count), &id);

        env.events().publish(
            (Symbol::new(&env, "product_registered"), id.clone()),
            product.clone(),
        );

        product
    }
    /// Batch-register up to 10 products in a single transaction (#389).
    pub fn register_products_batch(
        env: Env,
        owner: Address,
        ids: Vec<String>,
        names: Vec<String>,
        origins: Vec<String>,
    ) -> Vec<Product> {
        owner.require_auth();
        // Increased from 10 → 50; each write is O(1) so the per-call CPU budget
        // scales linearly and stays well under Soroban limits at this size.
        if ids.len() > 50 {
            panic!("batch size exceeds maximum of 50");
        }
        if ids.len() != names.len() || ids.len() != origins.len() {
            panic!("ids, names, and origins must have equal length");
        }
        let mut products = Vec::new(&env);
        // Read ProductCount once before the loop (not per iteration).
        let mut count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ProductCount)
            .unwrap_or(0);
        for i in 0..ids.len() {
            let id = ids.get(i).unwrap();
            let name = names.get(i).unwrap();
            let origin = origins.get(i).unwrap();
            let product = Product {
                id: id.clone(),
                name,
                origin,
                owner: owner.clone(),
                timestamp: env.ledger().timestamp(),
                authorized_actors: Vec::new(&env),
                recalled: false,
                recall_reason: String::from_str(&env, ""),
                recall_timestamp: 0,
                schema_version: SCHEMA_VERSION,
                expiration_timestamp: 0,
                spoiled: false,
                required_signatures: 1,
                active: true,
                category: String::from_str(&env, ""),
                subcategory: String::from_str(&env, ""),
                hazardous: false,
                hazard_classification: String::from_str(&env, ""),
                lifecycle_stage: LifecycleStage::Registered,
            };
            env.storage()
                .persistent()
                .set(&DataKey::Product(id.clone()), &product);
            env.storage()
                .persistent()
                .set(&DataKey::ProductIndex(count), &id);
            count += 1;
            products.push_back(product);
        }
        // Single ProductCount write after the loop.
        env.storage()
            .persistent()
            .set(&DataKey::ProductCount, &count);
        products
    }
    /// Recall a product. Owner-only. Sets recalled=true and records the reason.
    pub fn recall_product(env: Env, product_id: String, reason: String) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        product.owner.require_auth();

        product.recalled = true;
        product.recall_reason = reason.clone();
        product.recall_timestamp = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        // Append to recall history
        let mut history: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::RecallHistory(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        history.push_back(reason);
        env.storage()
            .persistent()
            .set(&DataKey::RecallHistory(product_id.clone()), &history);

        env.events().publish(
            (Symbol::new(&env, "product_recalled"), product_id),
            product.recalled,
        );

        true
    }
    /// Set hazard classification for a product (#454)
    pub fn set_hazard_status(env: Env, product_id: String, hazardous: bool, classification: String) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        product.owner.require_auth();

        product.hazardous = hazardous;
        product.hazard_classification = classification;

        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id), &product);

        true
    }
    /// Lift a recall from a product. Owner-only. Sets recalled=false.
    pub fn unrecall_product(env: Env, product_id: String) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        product.owner.require_auth();

        product.recalled = false;

        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        env.events().publish(
            (Symbol::new(&env, "product_unrecalled"), product_id),
            product.recalled,
        );

        true
    }
    /// Return recall information for a product: (recalled, reason, timestamp).
    pub fn get_recall_info(env: Env, product_id: String) -> (bool, String, u64) {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id))
            .expect("product not found");
        (product.recalled, product.recall_reason, product.recall_timestamp)
    }
    /// Return the full recall history (all reasons) for a product (#393).
    pub fn get_recall_history(env: Env, product_id: String) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::RecallHistory(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Retrieve a product by its ID.
    ///
    /// # Returns
    /// The [`Product`] struct stored under `id`.
    ///
    /// # Errors
    /// - [`Error::ProductNotFound`] — if no product with `id` is registered.
    pub fn get_product(env: Env, id: String) -> Result<Product, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Product(id))
            .ok_or(Error::ProductNotFound)
    }
    /// Check whether a product ID is registered.
    ///
    /// Useful for pre-flight checks before calling functions that panic on
    /// unknown IDs.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `id` — The product ID to check.
    ///
    /// # Returns
    /// `true` if a product with `id` exists in storage, `false` otherwise.
    ///
    /// # Authorization
    /// None — this is a read-only function.
    ///
    /// # Panics
    /// Does not panic.
    pub fn product_exists(env: Env, id: String) -> bool {
        env.storage().persistent().has(&DataKey::Product(id))
    }
    pub fn get_product_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::ProductCount)
            .unwrap_or(0)
    }
    /// Get the current lifecycle stage of a product.
    pub fn get_lifecycle_stage(env: Env, product_id: String) -> LifecycleStage {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id))
            .expect("product not found");

        product.lifecycle_stage
    }
    /// Register an alias for a product ID that maps to a canonical ID.
    /// Prevents duplicate canonical mappings.
    pub fn register_product_alias(
        env: Env,
        canonical_id: String,
        alias: String,
        creator: Address,
    ) -> ProductIdAlias {
        creator.require_auth();

        // Verify canonical product exists
        if !env.storage().persistent().has(&DataKey::Product(canonical_id.clone())) {
            panic!("canonical product not found");
        }

        // Prevent duplicate canonical mappings
        if env.storage().persistent().has(&DataKey::ProductIdAlias(alias.clone())) {
            panic!("alias already exists");
        }

        let alias_entry = ProductIdAlias {
            canonical_id: canonical_id.clone(),
            alias: alias.clone(),
            created_by: creator,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::ProductIdAlias(alias.clone()), &alias_entry);

        env.events().publish(
            (Symbol::new(&env, "alias_registered"), alias),
            alias_entry.clone(),
        );

        alias_entry
    }
    /// Resolve a product ID (canonical or alias) to its canonical ID.
    pub fn resolve_product_id(env: Env, id: String) -> String {
        // Check if it's an alias
        if let Some(alias_entry) = env
            .storage()
            .persistent()
            .get::<_, ProductIdAlias>(&DataKey::ProductIdAlias(id.clone()))
        {
            return alias_entry.canonical_id;
        }
        // Otherwise return the ID as-is (assume it's canonical)
        id
    }
    /// Get all aliases for a canonical product ID.
    pub fn get_product_aliases(env: Env, canonical_id: String) -> Vec<String> {
        // Note: This is a simplified implementation. In production, you'd maintain
        // a reverse index mapping canonical IDs to their aliases.
        Vec::new(&env)
    }
    /// Record or update provenance score metadata for a product.
    /// Persists across contract upgrades.
    pub fn set_provenance_score(
        env: Env,
        product_id: String,
        score: u32,
        verified_event_count: u32,
    ) -> ProvenanceScoreMetadata {
        // Verify product exists
        if !env.storage().persistent().has(&DataKey::Product(product_id.clone())) {
            panic!("product not found");
        }

        if score > 100 {
            panic!("score must be between 0 and 100");
        }

        let metadata = ProvenanceScoreMetadata {
            product_id: product_id.clone(),
            score,
            last_calculated_at: env.ledger().timestamp(),
            verified_event_count,
            schema_version: SCHEMA_VERSION,
        };

        env.storage()
            .persistent()
            .set(&DataKey::ProvenanceScore(product_id.clone()), &metadata);

        env.events().publish(
            (Symbol::new(&env, "provenance_score_updated"), product_id),
            metadata.clone(),
        );

        metadata
    }
    /// Retrieve provenance score metadata for a product.
    pub fn get_provenance_score(env: Env, product_id: String) -> Option<ProvenanceScoreMetadata> {
        env.storage()
            .persistent()
            .get(&DataKey::ProvenanceScore(product_id))
    }
    /// Get provenance score history (returns current score if available).
    pub fn get_provenance_score_history(env: Env, product_id: String) -> Vec<ProvenanceScoreMetadata> {
        let mut history = Vec::new(&env);
        if let Some(metadata) = env
            .storage()
            .persistent()
            .get::<_, ProvenanceScoreMetadata>(&DataKey::ProvenanceScore(product_id))
        {
            history.push_back(metadata);
        }
        history
    }
    /// Update the mutable metadata fields of a product.
    ///
    /// Only `name` and `origin` can be changed. The `id`, `owner`,
    /// `timestamp`, `authorized_actors`, and `required_signatures` fields are
    /// immutable through this function.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product to update.
    /// - `name` — New human-readable product name.
    /// - `origin` — New origin string.
    ///
    /// # Returns
    /// The updated [`Product`] struct.
    ///
    /// # Authorization
    /// Requires `product.owner.require_auth()`. Only the current product owner
    /// may update metadata.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    ///
    /// # Emitted Events
    /// Publishes a `("product_updated", product_id)` event with the updated
    /// [`Product`] struct as the event body.
    pub fn update_product_metadata(
        env: Env,
        product_id: String,
        name: String,
        origin: String,
    ) -> Result<Product, Error> {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .ok_or(Error::ProductNotFound)?;

        product.owner.require_auth();
        // Issue #311: enforce size limits on update.
        assert_len(&name,   MAX_NAME_LEN,   "name");
        assert_len(&origin, MAX_ORIGIN_LEN, "origin");

        product.name = name;
        product.origin = origin;

        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        env.events().publish(
            (Symbol::new(&env, "product_updated"), product_id),
            product.clone(),
        );

        Ok(product)
    }
    /// Deactivate a product (owner-only). Idempotent.
    pub fn deactivate_product(env: Env, product_id: String) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");
        product.owner.require_auth();
        product.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id), &product);
        true
    }
    /// Reactivate a previously deactivated product (owner-only). Idempotent.
    pub fn reactivate_product(env: Env, product_id: String) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");
        product.owner.require_auth();
        product.active = true;
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id), &product);
        true
    }
    /// Set or update the expiration timestamp for a product (owner-only).
    /// Pass 0 to clear the expiration.
    pub fn update_expiration(
        env: Env,
        product_id: String,
        expiration_timestamp: u64,
    ) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");
        product.owner.require_auth();
        product.expiration_timestamp = expiration_timestamp;
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        env.events().publish(
            (Symbol::new(&env, "expiration_updated"), product_id),
            expiration_timestamp,
        );
        true
    }
    /// Returns true if the product has an expiration set and the ledger
    /// timestamp has passed it.
    pub fn is_expired(env: Env, product_id: String) -> bool {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id))
            .expect("product not found");
        product.expiration_timestamp > 0
            && env.ledger().timestamp() >= product.expiration_timestamp
    }
    /// Mark a product as spoiled (owner-only). Records a SPOILED event.
    /// Spoiled products cannot receive new tracking events or be transferred.
    pub fn mark_spoiled(
        env: Env,
        product_id: String,
        reason: String,
    ) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");
        product.owner.require_auth();

        if product.spoiled {
            return true; // idempotent
        }

        product.spoiled = true;
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        // Record a SPOILED event in the event log
        let spoiled_timestamp = env.ledger().timestamp();
        let spoiled_event_type = String::from_str(&env, "SPOILED");
        let stable_id = compute_stable_id(&env, &product_id, &product.owner, &spoiled_event_type, spoiled_timestamp, &reason);
        let event = TrackingEvent {
            schema_version: EVENT_SCHEMA_VERSION,
            product_id: product_id.clone(),
            location: String::from_str(&env, "N/A"),
            actor: product.owner.clone(),
            timestamp: spoiled_timestamp,
            event_type: spoiled_event_type,
            metadata: reason.clone(),
            metadata_commitment: String::from_str(&env, ""),
            private_metadata: false,
            stable_id,
        };
        let mut events: Vec<TrackingEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::Events(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        events.push_back(event);
        env.storage()
            .persistent()
            .set(&DataKey::Events(product_id.clone()), &events);

        env.events().publish(
            (Symbol::new(&env, "product_spoiled"), product_id),
            reason,
        );
        true
    }
}
