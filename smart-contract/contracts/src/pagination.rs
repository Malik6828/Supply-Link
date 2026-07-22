use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Paginated event retrieval — O(limit) storage reads.
    ///
    /// # Parameters
    /// - `offset` — zero-based starting index.
    /// - `limit`  — maximum number of events to return (capped at 100).
    pub fn get_tracking_events_page(
        env: Env,
        product_id: String,
        offset: u32,
        limit: u32,
    ) -> Vec<TrackingEvent> {
        let limit = limit.min(100);
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::EventCount(product_id.clone()))
            .unwrap_or(0u32);

        let mut result = Vec::new(&env);
        let end = (offset + limit).min(count);
        for i in offset..end {
            if let Some(event) = env
                .storage()
                .persistent()
                .get::<DataKey, TrackingEvent>(&DataKey::EventEntry(product_id.clone(), i))
            {
                result.push_back(event);
            }
        }
        result
    }
    pub fn list_products(env: Env, offset: u64, limit: u64) -> Vec<String> {
        let count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ProductCount)
            .unwrap_or(0);

        let mut products = Vec::new(&env);
        let end = core::cmp::min(offset + limit, count);

        for i in offset..end {
            if let Some(product_id) = env
                .storage()
                .persistent()
                .get::<DataKey, String>(&DataKey::ProductIndex(i))
            {
                products.push_back(product_id);
            }
        }

        products
    }
}
