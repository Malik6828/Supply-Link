use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Get pending events for a product.
    ///
    /// Returns all events awaiting multi-signature approval.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product.
    ///
    /// # Returns
    /// A `Vec<PendingEvent>` containing all pending events for the product.
    ///
    /// # Authorization
    /// None — this is a read-only function.
    ///
    /// # Panics
    /// Does not panic.
    pub fn get_pending_events(env: Env, product_id: String) -> Vec<PendingEvent> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingEvents(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Clean up expired pending events for a product.
    ///
    /// Removes all expired pending events from storage and emits a purge event
    /// for each removed entry (issue #314).
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product to clean up.
    ///
    /// # Returns
    /// Number of events purged.
    ///
    /// # Authorization
    /// None — this is a permissionless cleanup function.
    ///
    /// # Emitted Events
    /// Publishes `("pending_events_purged", product_id)` event with the count
    /// of purged events. Also publishes `("pending_event_purged", product_id)`
    /// for each individual removed event.
    pub fn cleanup_expired_events(env: Env, product_id: String) -> u32 {
        let mut pending: Vec<PendingEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingEvents(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let current_time = env.ledger().timestamp();
        let mut expired_count: u32 = 0;

        // Filter out expired events
        let mut valid_pending = Vec::new(&env);
        for i in 0..pending.len() {
            let event = pending.get(i).unwrap();
            if current_time <= event.expiration {
                valid_pending.push_back(event.clone());
            } else {
                expired_count += 1;

                // Emit event for each purged entry
                env.events().publish(
                    (Symbol::new(&env, "pending_event_purged"), product_id.clone()),
                    event.product_id.clone(),
                );
            }
        }

        if valid_pending.len() > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::PendingEvents(product_id.clone()), &valid_pending);
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::PendingEvents(product_id.clone()));
        }

        // Emit summary event
        env.events().publish(
            (Symbol::new(&env, "pending_events_purged"), product_id),
            expired_count,
        );

        expired_count
    }
    pub fn get_nonce(env: Env, actor: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::ActorNonce(actor))
            .unwrap_or(0)
    }
    /// Get the stable pending event ID for a pending event at a given index.
    ///
    /// This function is provided for backward compatibility with clients that
    /// currently use index-based references. It bridges index-based lookups to
    /// stable IDs.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product.
    /// - `event_index` — Zero-based index into the pending events queue.
    ///
    /// # Returns
    /// The stable `pending_event_id` of the event at that index, or panics if
    /// the index is out of bounds or no events exist.
    ///
    /// # Panics
    /// - `"no pending events"` — if there are no pending events.
    /// - `"event index out of bounds"` — if `event_index` is invalid.
    ///
    /// # Note
    /// This function should be called to convert existing index-based client code
    /// to use stable IDs. Direct index usage in approve_event/reject_event will
    /// no longer work; the stable ID must be obtained first.
    pub fn get_pending_event_id_at_index(
        env: Env,
        product_id: String,
        event_index: u32,
    ) -> u64 {
        let pending: Vec<PendingEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::PendingEvents(product_id))
            .ok_or_else(|| panic!("no pending events"))?;

        if event_index >= pending.len() as u32 {
            panic!("event index out of bounds");
        }

        pending.get(event_index).unwrap().pending_event_id
    }
    /// Archive a tracking event by its `stable_id`.
    ///
    /// Moves the matching event from the active `Events` list into the
    /// `ArchivedEvents` store. The event data is preserved verbatim so
    /// integrity proofs remain valid. Archived events are excluded from
    /// `get_tracking_events` and `list_tracking_events` but remain fully
    /// queryable via `list_archived_events`.
    ///
    /// # Authorization
    /// Requires `caller.require_auth()`. Caller must be the product owner or
    /// an authorized actor.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    /// - `"caller is not authorized"` — if caller lacks permission.
    /// - `"event not found"` — if no active event with `stable_id` exists.
    pub fn archive_tracking_event(
        env: Env,
        product_id: String,
        caller: Address,
        stable_id: String,
        reason: String,
    ) -> ArchivedEvent {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .unwrap_or_else(|| panic!("product not found"));

        let is_owner = product.owner == caller;
        let is_actor = product.authorized_actors.contains(&caller);
        if !is_owner && !is_actor {
            panic!("caller is not authorized");
        }
        caller.require_auth();

        let events: Vec<TrackingEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::Events(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        // Find and remove the event from the active list
        let mut remaining: Vec<TrackingEvent> = Vec::new(&env);
        let mut target: Option<TrackingEvent> = None;
        for ev in events.iter() {
            if ev.stable_id == stable_id && target.is_none() {
                target = Some(ev.clone());
            } else {
                remaining.push_back(ev.clone());
            }
        }

        let event = target.unwrap_or_else(|| panic!("event not found"));

        // Write back the active list without the archived event
        env.storage()
            .persistent()
            .set(&DataKey::Events(product_id.clone()), &remaining);

        let archived = ArchivedEvent {
            event: event.clone(),
            archived_by: caller,
            archived_at: env.ledger().timestamp(),
            reason,
        };

        // Append to the archived list
        let mut archived_list: Vec<ArchivedEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::ArchivedEvents(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        archived_list.push_back(archived.clone());
        env.storage()
            .persistent()
            .set(&DataKey::ArchivedEvents(product_id.clone()), &archived_list);

        env.events().publish(
            (Symbol::new(&env, "event_archived"), product_id),
            archived.clone(),
        );

        archived
    }
    /// Return all archived events for a product with optional pagination.
    ///
    /// Archived events are excluded from the active timeline but remain
    /// auditable here. Pass `offset=0, limit=0` to retrieve all records.
    pub fn list_archived_events(
        env: Env,
        product_id: String,
        offset: u32,
        limit: u32,
    ) -> Vec<ArchivedEvent> {
        let all: Vec<ArchivedEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::ArchivedEvents(product_id))
            .unwrap_or_else(|| Vec::new(&env));

        if limit == 0 {
            return all;
        }

        let mut page: Vec<ArchivedEvent> = Vec::new(&env);
        let start = offset as usize;
        let end = core::cmp::min(start + limit as usize, all.len() as usize);
        for i in start..end {
            if let Some(item) = all.get(i as u32) {
                page.push_back(item);
            }
        }
        page
    }
    /// List stable_ids of events submitted by a given actor, with pagination.
    pub fn list_events_by_actor(
        env: Env,
        actor: Address,
        offset: u32,
        limit: u32,
    ) -> Vec<String> {
        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::EventsByActor(actor))
            .unwrap_or_else(|| Vec::new(&env));
        paginate_string_vec(&env, &all, offset, limit)
    }
    /// List stable_ids of events recorded at a given location, with pagination.
    pub fn list_events_by_location(
        env: Env,
        location: String,
        offset: u32,
        limit: u32,
    ) -> Vec<String> {
        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::EventsByLocation(location))
            .unwrap_or_else(|| Vec::new(&env));
        paginate_string_vec(&env, &all, offset, limit)
    }
    /// List stable_ids of events of a given event_type, with pagination.
    pub fn list_events_by_type(
        env: Env,
        event_type: String,
        offset: u32,
        limit: u32,
    ) -> Vec<String> {
        let all: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::EventsByType(event_type))
            .unwrap_or_else(|| Vec::new(&env));
        paginate_string_vec(&env, &all, offset, limit)
    }
    /// Retrieve the signer proof for a given event stable_id.
    pub fn get_signer_proof(env: Env, event_stable_id: String) -> Option<SignerProof> {
        env.storage()
            .persistent()
            .get(&DataKey::SignerProof(event_stable_id))
    }
    /// Returns true if an event with this stable_id has already been recorded.
    pub fn is_event_replayed(env: Env, stable_id: String) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::EventHashSeen(stable_id))
            .unwrap_or(false)
    }
    /// Create an immutable audit snapshot of a product's current state.
    ///
    /// The caller supplies a `snapshot_hash` — a SHA-256 hex digest of the
    /// serialised product state + event list computed off-chain. The contract
    /// stores it with a timestamp so it can be verified later.
    ///
    /// # Authorization
    /// Requires `product.owner.require_auth()`.
    pub fn snapshot_product_state(
        env: Env,
        product_id: String,
        snapshot_hash: String,
    ) -> AuditSnapshot {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .unwrap_or_else(|| panic!("product not found"));

        product.owner.require_auth();
        assert_len(&snapshot_hash, 128, "snapshot_hash");

        let event_count: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<TrackingEvent>>(&DataKey::Events(product_id.clone()))
            .map(|v| v.len())
            .unwrap_or(0);

        let timestamp = env.ledger().timestamp();

        // Snapshot ID = SHA-256 of product_id + timestamp
        let snap_id = compute_stable_id(
            &env,
            &product_id,
            &product.owner,
            &String::from_str(&env, "SNAPSHOT"),
            timestamp,
            &snapshot_hash,
        );

        let snapshot = AuditSnapshot {
            id: snap_id.clone(),
            product_id: product_id.clone(),
            snapshot_hash,
            created_by: product.owner.clone(),
            timestamp,
            event_count,
        };

        let mut snaps: Vec<AuditSnapshot> = env
            .storage()
            .persistent()
            .get(&DataKey::Snapshots(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        snaps.push_back(snapshot.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Snapshots(product_id.clone()), &snaps);

        env.events().publish(
            (Symbol::new(&env, "snapshot_created"), product_id),
            snapshot.clone(),
        );

        snapshot
    }
    /// Retrieve all audit snapshots for a product.
    pub fn get_snapshots(env: Env, product_id: String) -> Vec<AuditSnapshot> {
        env.storage()
            .persistent()
            .get(&DataKey::Snapshots(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
}
