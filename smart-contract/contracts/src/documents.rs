use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Anchor an off-chain document hash on-chain for a product.
    ///
    /// The caller computes the SHA-256 hash of the document bytes off-chain
    /// and submits the hex-encoded digest here. The contract stores it
    /// immutably so it can be verified later via [`Self::verify_document_hash`].
    ///
    /// # Parameters
    /// - `product_id` — ID of the product this document belongs to.
    /// - `label` — Human-readable document label (max 256 bytes).
    /// - `hash` — Hex-encoded SHA-256 digest of the document (64 chars).
    /// - `caller` — Address anchoring the document; must be owner or authorized actor.
    ///
    /// # Returns
    /// The newly created [`DocumentAnchor`].
    ///
    /// # Authorization
    /// Requires `caller.require_auth()`.
    pub fn anchor_document_hash(
        env: Env,
        product_id: String,
        label: String,
        hash: String,
        caller: Address,
    ) -> DocumentAnchor {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        let is_owner = product.owner == caller;
        let is_actor = product.authorized_actors.contains(&caller);
        if !is_owner && !is_actor {
            panic!("caller is not authorized");
        }
        caller.require_auth();

        assert_len(&label, MAX_NAME_LEN, "label");
        // SHA-256 hex digest is exactly 64 chars
        if hash.len() != 64 {
            panic!("hash must be a 64-char hex-encoded SHA-256 digest");
        }

        let anchor = DocumentAnchor {
            product_id: product_id.clone(),
            label,
            hash,
            anchored_by: caller,
            anchored_at: env.ledger().timestamp(),
        };

        let mut anchors: Vec<DocumentAnchor> = env
            .storage()
            .persistent()
            .get(&DataKey::DocumentAnchors(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        anchors.push_back(anchor.clone());
        env.storage()
            .persistent()
            .set(&DataKey::DocumentAnchors(product_id.clone()), &anchors);

        env.events().publish(
            (Symbol::new(&env, "document_anchored"), product_id),
            anchor.clone(),
        );

        anchor
    }
    /// Verify whether a given hash matches any anchored document for a product.
    ///
    /// # Parameters
    /// - `product_id` — ID of the product to check.
    /// - `hash` — Hex-encoded SHA-256 digest to look up.
    ///
    /// # Returns
    /// `true` if the hash matches an existing anchor; `false` otherwise.
    pub fn verify_document_hash(env: Env, product_id: String, hash: String) -> bool {
        let anchors: Vec<DocumentAnchor> = env
            .storage()
            .persistent()
            .get(&DataKey::DocumentAnchors(product_id))
            .unwrap_or_else(|| Vec::new(&env));

        for i in 0..anchors.len() {
            if anchors.get(i).unwrap().hash == hash {
                return true;
            }
        }
        false
    }
    /// Return all document anchors for a product.
    pub fn get_document_anchors(env: Env, product_id: String) -> Vec<DocumentAnchor> {
        env.storage()
            .persistent()
            .get(&DataKey::DocumentAnchors(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
}
