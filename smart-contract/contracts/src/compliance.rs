use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Store or replace the compliance policy for a product.
    ///
    /// Only the product owner may call this function. Each rule in the policy
    /// is enforced on every subsequent `add_tracking_event` call.
    pub fn set_compliance_policy(
        env: Env,
        product_id: String,
        rules: Vec<ComplianceRule>,
    ) -> Result<CompliancePolicy, Error> {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .ok_or(Error::ProductNotFound)?;

        product.owner.require_auth();

        let policy = CompliancePolicy {
            product_id: product_id.clone(),
            rules,
        };

        env.storage()
            .persistent()
            .set(&DataKey::CompliancePolicy(product_id.clone()), &policy);

        env.events().publish(
            (Symbol::new(&env, "compliance_policy_set"), product_id),
            policy.clone(),
        );

        Ok(policy)
    }
    /// Retrieve the compliance policy for a product, if one has been set.
    pub fn get_compliance_policy(env: Env, product_id: String) -> Option<CompliancePolicy> {
        env.storage()
            .persistent()
            .get(&DataKey::CompliancePolicy(product_id))
    }
    fn check_compliance(
        env: &Env,
        product_id: &String,
        event_type: &String,
        current_time: u64,
    ) -> Result<(), Error> {
        let policy: CompliancePolicy = match env
            .storage()
            .persistent()
            .get(&DataKey::CompliancePolicy(product_id.clone()))
        {
            Some(p) => p,
            None => return Ok(()),
        };

        let events: Vec<TrackingEvent> = env
            .storage()
            .persistent()
            .get(&DataKey::Events(product_id.clone()))
            .unwrap_or_else(|| Vec::new(env));

        for i in 0..policy.rules.len() {
            let rule = policy.rules.get(i).unwrap();

            if rule.to_stage != *event_type {
                continue;
            }

            if rule.rule_type == COMPLIANCE_REQUIRED_ORDER
                || rule.rule_type == COMPLIANCE_MANDATORY_INSPECTION
            {
                let mut found = false;
                for j in 0..events.len() {
                    if events.get(j).unwrap().event_type == rule.from_stage {
                        found = true;
                        break;
                    }
                }
                if !found {
                    return Err(Error::ComplianceViolation);
                }
            } else if rule.rule_type == COMPLIANCE_MAX_TIME_BETWEEN_STAGES {
                let mut last_from_time: Option<u64> = None;
                for j in 0..events.len() {
                    let ev = events.get(j).unwrap();
                    if ev.event_type == rule.from_stage {
                        last_from_time = Some(ev.timestamp);
                    }
                }
                if let Some(last_time) = last_from_time {
                    if current_time > last_time + rule.max_seconds {
                        return Err(Error::ComplianceViolation);
                    }
                }
            }
        }

        Ok(())
    }
}
