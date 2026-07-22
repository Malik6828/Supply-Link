use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Report an anomaly detected in a product's supply chain.
    pub fn report_anomaly(
        env: Env,
        product_id: String,
        anomaly_type: String,
        severity: u32,
        description: String,
        suggested_actions: String,
    ) -> AnomalyReport {
        let _product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        if severity < 1 || severity > 4 {
            panic!("severity must be between 1 and 4");
        }

        let report_id = format_anomaly_id(&env, &product_id);
        let now = env.ledger().timestamp();

        let report = AnomalyReport {
            id: report_id.clone(),
            product_id: product_id.clone(),
            anomaly_type,
            severity,
            description,
            suggested_actions,
            detected_at: now,
            reviewed: false,
            reviewed_by: Address::from_contract_id(&env, &env.current_contract_address()),
            reviewed_at: 0,
        };

        let mut reports: Vec<AnomalyReport> = env
            .storage()
            .persistent()
            .get(&DataKey::AnomalyReports(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        reports.push_back(report.clone());
        env.storage()
            .persistent()
            .set(&DataKey::AnomalyReports(product_id.clone()), &reports);

        env.events().publish(
            (Symbol::new(&env, "anomaly_reported"), product_id),
            report.clone(),
        );

        report
    }
    /// Get all anomaly reports for a product.
    pub fn get_anomaly_reports(env: Env, product_id: String) -> Vec<AnomalyReport> {
        env.storage()
            .persistent()
            .get(&DataKey::AnomalyReports(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Mark an anomaly report as reviewed by an analyst.
    pub fn review_anomaly(
        env: Env,
        product_id: String,
        report_id: String,
        analyst: Address,
    ) -> bool {
        analyst.require_auth();

        let mut reports: Vec<AnomalyReport> = env
            .storage()
            .persistent()
            .get(&DataKey::AnomalyReports(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        for i in 0..reports.len() {
            let mut report = reports.get(i).unwrap().clone();
            if report.id == report_id {
                report.reviewed = true;
                report.reviewed_by = analyst.clone();
                report.reviewed_at = env.ledger().timestamp();
                reports.set(i, report);
                found = true;
                break;
            }
        }

        if found {
            env.storage()
                .persistent()
                .set(&DataKey::AnomalyReports(product_id.clone()), &reports);
            env.events().publish(
                (Symbol::new(&env, "anomaly_reviewed"), product_id),
                report_id,
            );
        }

        found
    }
}
