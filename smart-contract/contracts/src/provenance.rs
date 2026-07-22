use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Notarize a product's provenance proof.
    /// Only authorized notaries can issue notarizations.
    pub fn notarize_provenance(
        env: Env,
        product_id: String,
        proof_hash: String,
        notary: Address,
        expires_at: u64,
    ) -> ProvenanceNotarization {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        let is_owner = product.owner == notary;
        let is_actor = product.authorized_actors.contains(&notary);
        if !is_owner && !is_actor {
            panic!("notary is not authorized");
        }
        notary.require_auth();

        // Proof hash should be 64 chars (SHA-256 hex)
        if proof_hash.len() != 64 {
            panic!("proof_hash must be a 64-char hex-encoded SHA-256 digest");
        }

        let notarization_id = format_notarization_id(&env, &product_id);
        let now = env.ledger().timestamp();

        let notarization = ProvenanceNotarization {
            id: notarization_id.clone(),
            product_id: product_id.clone(),
            proof_hash,
            notary,
            notarized_at: now,
            expires_at,
            revoked: false,
        };

        let mut notarizations: Vec<ProvenanceNotarization> = env
            .storage()
            .persistent()
            .get(&DataKey::ProvenanceNotarizations(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        notarizations.push_back(notarization.clone());
        env.storage()
            .persistent()
            .set(&DataKey::ProvenanceNotarizations(product_id.clone()), &notarizations);

        env.events().publish(
            (Symbol::new(&env, "provenance_notarized"), product_id),
            notarization.clone(),
        );

        notarization
    }
    /// Get all provenance notarizations for a product.
    pub fn get_provenance_notarizations(env: Env, product_id: String) -> Vec<ProvenanceNotarization> {
        env.storage()
            .persistent()
            .get(&DataKey::ProvenanceNotarizations(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Revoke a provenance notarization.
    pub fn revoke_provenance_notarization(
        env: Env,
        product_id: String,
        notarization_id: String,
    ) -> bool {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        product.owner.require_auth();

        let mut notarizations: Vec<ProvenanceNotarization> = env
            .storage()
            .persistent()
            .get(&DataKey::ProvenanceNotarizations(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        for i in 0..notarizations.len() {
            let mut notarization = notarizations.get(i).unwrap().clone();
            if notarization.id == notarization_id {
                notarization.revoked = true;
                notarizations.set(i, notarization);
                found = true;
                break;
            }
        }

        if found {
            env.storage()
                .persistent()
                .set(&DataKey::ProvenanceNotarizations(product_id.clone()), &notarizations);
            env.events().publish(
                (Symbol::new(&env, "provenance_notarization_revoked"), product_id),
                notarization_id,
            );
        }

        found
    }
}
