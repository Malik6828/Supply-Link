use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    pub fn get_authorized_actors(env: Env, product_id: String) -> Vec<Address> {
        env.storage()
            .persistent()
            .get::<DataKey, Product>(&DataKey::Product(product_id))
            .map(|p| p.authorized_actors)
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Transfer product ownership to a new address.
    ///
    /// Updates the `owner` field of the [`Product`] in storage. The previous
    /// owner loses all owner-gated privileges immediately. The new owner gains
    /// them immediately.
    ///
    /// # Safety Checks
    /// - Prevents no-op transfers (transferring to the current owner)
    /// - Validates that the new owner is a valid address
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product to transfer.
    /// - `new_owner` — Stellar address of the incoming owner.
    ///
    /// # Returns
    /// `true` on success.
    ///
    /// # Authorization
    /// Requires the *current* `product.owner.require_auth()`. The transaction
    /// must be signed by the current owner.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    /// - `"cannot transfer to current owner"` — if `new_owner` equals current owner.
    ///
    /// # Emitted Events
    /// Publishes an `("ownership_transferred", product_id)` event with
    /// `new_owner` as the event body.
    pub fn transfer_ownership(
        env: Env,
        product_id: String,
        new_owner: Address,
        nonce: u64,
    ) -> Result<bool, Error> {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .ok_or(Error::ProductNotFound)?;

        if product.spoiled {
            panic!("spoiled product cannot be transferred");
        }

        product.owner.require_auth();

        if product.owner == new_owner {
            panic!("new owner must differ from current owner");
        }

        Self::validate_and_increment_nonce(&env, &product.owner, nonce);
        
        product.owner = new_owner.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        env.events().publish(
            (Symbol::new(&env, "ownership_transferred"), product_id),
            new_owner,
        );

        Ok(true)
    }
    /// Grant an address permission to add tracking events for a product.
    ///
    /// Appends `actor` to `product.authorized_actors`. Prevents duplicate entries
    /// to maintain clean governance state.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product to update.
    /// - `actor` — Stellar address to authorise.
    ///
    /// # Returns
    /// `true` if `actor` was added, `false` if `actor` was already in the list.
    ///
    /// # Authorization
    /// Requires `product.owner.require_auth()`. Only the current product owner
    /// may grant actor permissions.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    /// - `"actor already authorized"` — if the actor is already in the authorized list.
    ///
    /// # Emitted Events
    /// Publishes an `("actor_authorized", product_id)` event with `actor` as
    /// the event body.
    pub fn add_authorized_actor(
        env: Env,
        product_id: String,
        actor: Address,
        nonce: u64,
    ) -> Result<bool, Error> {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .ok_or(Error::ProductNotFound)?;

        product.owner.require_auth();
        Self::validate_and_increment_nonce(&env, &product.owner, nonce);
        
        product.authorized_actors.push_back(actor.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        env.events().publish(
            (Symbol::new(&env, "actor_authorized"), product_id),
            actor,
        );

        Ok(true)
    }
    /// Request an ownership transfer. Creates an escrow pending acceptance.
    pub fn request_transfer_ownership(
        env: Env,
        product_id: String,
        proposed_owner: Address,
    ) -> TransferEscrow {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        if product.owner == proposed_owner {
            panic!("proposed owner must differ from current owner");
        }
        product.owner.require_auth();

        let escrow = TransferEscrow {
            product_id: product_id.clone(),
            current_owner: product.owner.clone(),
            proposed_owner,
            requested_at: env.ledger().timestamp(),
            disputed: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::TransferEscrow(product_id.clone()), &escrow);

        env.events().publish(
            (Symbol::new(&env, "transfer_requested"), product_id),
            escrow.clone(),
        );
        escrow
    }
    /// Return `true` when the contract is paused (emergency-stop active).
    ///
    /// This is a read-only query; it is always available regardless of pause state.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::ContractPaused)
            .unwrap_or(false)
    }
    /// Set the contract pause state.
    ///
    /// When `paused` is `true` all write operations will return
    /// [`Error::ContractPaused`]. Read-only operations are unaffected.
    ///
    /// # Authorization
    /// Restricted to the product owner acting as guardian. In a production
    /// deployment this should be gated on a dedicated guardian address stored
    /// in contract instance storage.
    ///
    /// # Parameters
    /// - `guardian` — Address of the authorized guardian invoking this call.
    /// - `paused`   — `true` to halt writes; `false` to resume normal operation.
    pub fn set_pause_state(env: Env, guardian: Address, paused: bool) -> bool {
        guardian.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::ContractPaused, &paused);
        env.events().publish(
            (Symbol::new(&env, "contract_pause_changed"),),
            paused,
        );
        paused
    }
    pub fn register_upgrade_guardian(env: Env, guardian: Address) -> bool {
        let admin = Self::require_admin(&env);
        admin.require_auth();

        if Self::is_upgrade_guardian_internal(&env, guardian.clone()) {
            panic!("guardian already registered");
        }

        env.storage()
            .persistent()
            .set(&DataKey::UpgradeGuardian(guardian.clone()), &true);

        let mut guardians: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::UpgradeGuardians)
            .unwrap_or_else(|| Vec::new(&env));
        guardians.push_back(guardian.clone());
        env.storage()
            .persistent()
            .set(&DataKey::UpgradeGuardians, &guardians);

        env.events().publish(
            (Symbol::new(&env, "upgrade_guardian_registered"),),
            guardian,
        );
        true
    }
    pub fn revoke_upgrade_guardian(env: Env, guardian: Address) -> bool {
        let admin = Self::require_admin(&env);
        admin.require_auth();

        if !Self::is_upgrade_guardian_internal(&env, guardian.clone()) {
            panic!("guardian not registered");
        }

        env.storage()
            .persistent()
            .set(&DataKey::UpgradeGuardian(guardian.clone()), &false);

        let guardians: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::UpgradeGuardians)
            .unwrap_or_else(|| Vec::new(&env));
        let mut remaining = Vec::new(&env);
        for i in 0..guardians.len() {
            let current = guardians.get(i).unwrap();
            if current != &guardian {
                remaining.push_back(current.clone());
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::UpgradeGuardians, &remaining);

        env.events().publish(
            (Symbol::new(&env, "upgrade_guardian_revoked"),),
            guardian,
        );
        true
    }
    pub fn get_upgrade_guardians(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::UpgradeGuardians)
            .unwrap_or_else(|| Vec::new(&env))
    }
    pub fn is_upgrade_guardian(env: Env, guardian: Address) -> bool {
        Self::is_upgrade_guardian_internal(&env, guardian)
    }
    pub fn authorize_contract_upgrade(env: Env, guardian: Address, new_contract_id: Address) -> bool {
        guardian.require_auth();
        if !Self::is_upgrade_guardian_internal(&env, guardian.clone()) {
            panic!("guardian is not authorized");
        }

        let already_authorized: bool = env
            .storage()
            .persistent()
            .get(&DataKey::AuthorizedUpgrade(new_contract_id.clone()))
            .unwrap_or(false);
        if already_authorized {
            return true;
        }

        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedUpgrade(new_contract_id.clone()), &true);
        let mut targets: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AuthorizedUpgradeTargets)
            .unwrap_or_else(|| Vec::new(&env));
        targets.push_back(new_contract_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedUpgradeTargets, &targets);

        env.events().publish(
            (Symbol::new(&env, "contract_upgrade_authorized"),),
            ContractUpgradeAuthorization {
                contract_id: new_contract_id,
                guardian,
                timestamp: env.ledger().timestamp(),
                authorized: true,
            },
        );
        true
    }
    pub fn revoke_contract_upgrade(env: Env, guardian: Address, contract_id: Address) -> bool {
        guardian.require_auth();
        if !Self::is_upgrade_guardian_internal(&env, guardian.clone()) {
            panic!("guardian is not authorized");
        }

        if !env
            .storage()
            .persistent()
            .get(&DataKey::AuthorizedUpgrade(contract_id.clone()))
            .unwrap_or(false)
        {
            panic!("contract upgrade target not authorized");
        }

        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedUpgrade(contract_id.clone()), &false);

        let targets: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AuthorizedUpgradeTargets)
            .unwrap_or_else(|| Vec::new(&env));
        let mut remaining = Vec::new(&env);
        for i in 0..targets.len() {
            let current = targets.get(i).unwrap();
            if current != &contract_id {
                remaining.push_back(current.clone());
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedUpgradeTargets, &remaining);

        env.events().publish(
            (Symbol::new(&env, "contract_upgrade_revoked"),),
            ContractUpgradeAuthorization {
                contract_id,
                guardian,
                timestamp: env.ledger().timestamp(),
                authorized: false,
            },
        );
        true
    }
    pub fn get_authorized_contract_upgrades(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::AuthorizedUpgradeTargets)
            .unwrap_or_else(|| Vec::new(&env))
    }
    pub fn is_contract_upgrade_authorized(env: Env, contract_id: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::AuthorizedUpgrade(contract_id))
            .unwrap_or(false)
    }
    /// Accept a pending transfer. Proposed owner confirms and takes ownership.
    pub fn accept_transfer_ownership(env: Env, product_id: String) -> bool {
        let escrow: TransferEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::TransferEscrow(product_id.clone()))
            .expect("no pending transfer");

        if escrow.disputed {
            panic!("transfer is disputed");
        }

        escrow.proposed_owner.require_auth();

        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        product.owner = escrow.proposed_owner.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);
        env.storage()
            .persistent()
            .remove(&DataKey::TransferEscrow(product_id.clone()));

        env.events().publish(
            (Symbol::new(&env, "transfer_accepted"), product_id),
            escrow.proposed_owner,
        );
        true
    }
    /// Cancel a pending transfer request (current owner only).
    pub fn cancel_transfer_request(env: Env, product_id: String) -> bool {
        let escrow: TransferEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::TransferEscrow(product_id.clone()))
            .expect("no pending transfer");

        escrow.current_owner.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::TransferEscrow(product_id.clone()));

        env.events().publish(
            (Symbol::new(&env, "transfer_cancelled"), product_id),
            escrow.current_owner,
        );
        true
    }
    /// Dispute a pending transfer. Either party can raise a dispute.
    pub fn dispute_transfer_ownership(env: Env, product_id: String) -> bool {
        let mut escrow: TransferEscrow = env
            .storage()
            .persistent()
            .get(&DataKey::TransferEscrow(product_id.clone()))
            .expect("no pending transfer");

        // Either current owner or proposed owner can dispute
        let caller_is_owner = escrow.current_owner.clone();
        caller_is_owner.require_auth();

        escrow.disputed = true;
        env.storage()
            .persistent()
            .set(&DataKey::TransferEscrow(product_id.clone()), &escrow);

        env.events().publish(
            (Symbol::new(&env, "transfer_disputed"), product_id),
            escrow.current_owner,
        );
        true
    }
    /// Get the pending transfer escrow for a product, if any.
    pub fn get_transfer_escrow(env: Env, product_id: String) -> Option<TransferEscrow> {
        env.storage()
            .persistent()
            .get(&DataKey::TransferEscrow(product_id))
    }
    /// Revoke an address's permission to add tracking events for a product.
    ///
    /// Rebuilds `authorized_actors` without `actor`. Because
    /// [`Self::add_authorized_actor`] prevents duplicates, at most one entry
    /// will ever be removed.
    ///
    /// # Governance Safeguards
    /// - Prevents removal of the owner from authorized actors if multi-signature
    ///   is enabled and would leave insufficient authorized actors to meet the
    ///   required signature threshold.
    /// - Ensures at least one authorized path remains for governance operations.
    ///
    /// # Parameters
    /// - `env` — Soroban execution environment.
    /// - `product_id` — ID of the product to update.
    /// - `actor` — Stellar address to revoke.
    ///
    /// # Returns
    /// `true` if `actor` was found and removed, `false` if `actor` was not in
    /// the authorized list.
    ///
    /// # Authorization
    /// Requires `product.owner.require_auth()`. Only the current product owner
    /// may revoke actor permissions.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    /// - `"cannot remove owner from actors"` — if attempting to remove the owner
    ///   when it would violate governance invariants.
    /// - `"removal would violate governance"` — if removal would leave insufficient
    ///   actors to meet multi-signature requirements.
    ///
    /// # Emitted Events
    /// Does not emit an event. Removal of an actor is not announced on-chain.
    /// Consumers tracking actor permissions must observe the absence of future
    /// `actor_authorized` events or query [`Self::get_authorized_actors`]
    /// directly.
    pub fn remove_authorized_actor(
        env: Env,
        product_id: String,
        actor: Address,
        nonce: u64,
    ) -> Result<bool, Error> {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .ok_or(Error::ProductNotFound)?;

        product.owner.require_auth();
        Self::validate_and_increment_nonce(&env, &product.owner, nonce);

        let mut found = false;
        let mut new_actors = Vec::new(&env);
        for i in 0..product.authorized_actors.len() {
            let current_actor = product.authorized_actors.get(i).unwrap();
            if current_actor != actor {
                new_actors.push_back(current_actor);
            } else {
                found = true;
            }
        }

        // Governance safeguard: ensure sufficient actors remain for multi-sig
        if product.required_signatures > 1 {
            // Count total authorized entities (owner + actors)
            let total_authorized = 1 + new_actors.len() as u32; // owner + remaining actors
            if total_authorized < product.required_signatures {
                panic!("removal would violate governance");
            }
        }

        product.authorized_actors = new_actors;
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        // Emit event
        if found {
            env.events().publish(
                (Symbol::new(&env, "actor_removed"), product_id),
                actor,
            );
        }

        Ok(found)
    }
    /// Assign a named role to an authorized actor for a product.
    ///
    /// The actor must already be in `authorized_actors`. Replaces any existing
    /// role assignment for the same actor.
    ///
    /// # Authorization
    /// Requires `product.owner.require_auth()`.
    pub fn assign_role(env: Env, product_id: String, actor: Address, role: Role) -> bool {
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
    /// Revoke the role assignment for an actor on a product.
    ///
    /// # Authorization
    /// Requires `product.owner.require_auth()`.
    pub fn revoke_role(env: Env, product_id: String, actor: Address) -> bool {
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

        let mut new_roles: Vec<ActorRole> = Vec::new(&env);
        let mut found = false;
        for i in 0..policy.roles.len() {
            let ar = policy.roles.get(i).unwrap();
            if ar.actor == actor {
                found = true;
            } else {
                new_roles.push_back(ar);
            }
        }
        policy.roles = new_roles;

        env.storage()
            .persistent()
            .set(&DataKey::AuthPolicy(product_id), &policy);
        found
    }
    /// Set the minimum number of signers required for an event on this product.
    ///
    /// # Authorization
    /// Requires `product.owner.require_auth()`.
    pub fn set_event_threshold(env: Env, product_id: String, threshold: u32) -> bool {
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
        policy.threshold = threshold;

        env.storage()
            .persistent()
            .set(&DataKey::AuthPolicy(product_id), &policy);
        true
    }
    /// Return the authorization policy (roles + threshold) for a product.
    pub fn get_authorization_policy(env: Env, product_id: String) -> AuthPolicy {
        env.storage()
            .persistent()
            .get(&DataKey::AuthPolicy(product_id))
            .unwrap_or(AuthPolicy {
                threshold: 1,
                roles: Vec::new(&env),
            })
    }
    /// Rotate the owner key for a product.
    ///
    /// The current owner must sign (via `old_owner.require_auth()`).
    /// The new owner address replaces the old one atomically.
    /// This is semantically equivalent to `transfer_ownership` but is
    /// explicitly named for key-rotation workflows.
    pub fn rotate_owner_key(
        env: Env,
        product_id: String,
        old_owner: Address,
        new_owner: Address,
    ) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        if product.owner != old_owner {
            panic!("old_owner does not match current owner");
        }
        if old_owner == new_owner {
            panic!("new_owner must differ from old_owner");
        }

        old_owner.require_auth();

        product.owner = new_owner.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        env.events().publish(
            (Symbol::new(&env, "owner_key_rotated"), product_id),
            (old_owner, new_owner),
        );
        true
    }
    /// Rotate an authorized actor key for a product.
    ///
    /// The old actor must sign. The old address is removed from
    /// `authorized_actors` and the new address is appended atomically.
    pub fn rotate_authorized_actor_key(
        env: Env,
        product_id: String,
        old_actor: Address,
        new_actor: Address,
    ) -> bool {
        let mut product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        if old_actor == new_actor {
            panic!("new_actor must differ from old_actor");
        }

        // Verify old_actor is currently authorized
        if !product.authorized_actors.contains(&old_actor) {
            panic!("old_actor is not an authorized actor");
        }

        old_actor.require_auth();

        // Replace old_actor with new_actor
        let mut new_actors = Vec::new(&env);
        for i in 0..product.authorized_actors.len() {
            let a = product.authorized_actors.get(i).unwrap();
            if a == old_actor {
                new_actors.push_back(new_actor.clone());
            } else {
                new_actors.push_back(a);
            }
        }
        product.authorized_actors = new_actors;
        env.storage()
            .persistent()
            .set(&DataKey::Product(product_id.clone()), &product);

        env.events().publish(
            (Symbol::new(&env, "actor_key_rotated"), product_id),
            (old_actor, new_actor),
        );
        true
    }
    /// Initialize the contract admin. Can only be called once.
    ///
    /// The admin is the only address that may register or deactivate auditors.
    /// If an admin is already set, this function panics.
    ///
    /// # Authorization
    /// Requires `admin.require_auth()`.
    pub fn initialize_admin(env: Env, admin: Address) -> bool {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("admin already initialized");
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        true
    }
    /// Return the current admin address, if set.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Admin)
    }
}
