#![cfg(test)]

    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_reject_event_with_reason() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SupplyLinkContract);
        let client = SupplyLinkContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let actor = Address::generate(&env);
        let product_id = String::from_str(&env, "test-product-001");
        let name = String::from_str(&env, "Test Product");
        let origin = String::from_str(&env, "Test Origin");
        let location = String::from_str(&env, "Test Location");
        let event_type = String::from_str(&env, "HARVEST");
        let metadata = String::from_str(&env, "{}");
        let reason = String::from_str(&env, "Invalid metadata format");

        env.mock_all_auths();

        // Register product with multi-sig
        client.register_product(&product_id, &name, &origin, &owner, &2, &String::from_str(&env, "other"), &String::from_str(&env, "general"));
        client.add_authorized_actor(&product_id, &actor, &0);

        // Add pending event
        client.add_tracking_event(&product_id, &actor, &location, &event_type, &metadata);

        // Verify pending event exists
        let pending = client.get_pending_events(&product_id);
        assert_eq!(pending.len(), 1);

        // Reject with reason
        let result = client.reject_event(&product_id, &0, &owner, &reason, &1);
        assert_eq!(result, true);

        // Verify pending event was removed
        let pending = client.get_pending_events(&product_id);
        assert_eq!(pending.len(), 0);
    }

    #[test]
    fn test_reject_event_with_empty_reason() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SupplyLinkContract);
        let client = SupplyLinkContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let actor = Address::generate(&env);
        let product_id = String::from_str(&env, "test-product-002");
        let name = String::from_str(&env, "Test Product");
        let origin = String::from_str(&env, "Test Origin");
        let location = String::from_str(&env, "Test Location");
        let event_type = String::from_str(&env, "HARVEST");
        let metadata = String::from_str(&env, "{}");
        let reason = String::from_str(&env, "");

        env.mock_all_auths();

        // Register product with multi-sig
        client.register_product(&product_id, &name, &origin, &owner, &2, &String::from_str(&env, "other"), &String::from_str(&env, "general"));
        client.add_authorized_actor(&product_id, &actor, &0);

        // Add pending event
        client.add_tracking_event(&product_id, &actor, &location, &event_type, &metadata);

        // Reject with empty reason (should work)
        let result = client.reject_event(&product_id, &0, &owner, &reason, &1);
        assert_eq!(result, true);
    }

    #[test]
    #[should_panic(expected = "rejection reason too long")]
    fn test_reject_event_reason_too_long() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SupplyLinkContract);
        let client = SupplyLinkContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let actor = Address::generate(&env);
        let product_id = String::from_str(&env, "test-product-003");
        let name = String::from_str(&env, "Test Product");
        let origin = String::from_str(&env, "Test Origin");
        let location = String::from_str(&env, "Test Location");
        let event_type = String::from_str(&env, "HARVEST");
        let metadata = String::from_str(&env, "{}");
        
        // Create a reason longer than 256 characters
        let long_reason = String::from_str(&env, &"x".repeat(257));

        env.mock_all_auths();

        // Register product with multi-sig
        client.register_product(&product_id, &name, &origin, &owner, &2, &String::from_str(&env, "other"), &String::from_str(&env, "general"));
        client.add_authorized_actor(&product_id, &actor, &0);

        // Add pending event
        client.add_tracking_event(&product_id, &actor, &location, &event_type, &metadata);

        // Try to reject with too long reason - should panic
        client.reject_event(&product_id, &0, &owner, &long_reason, &1);
    }

    #[test]
    fn test_reject_event_max_length_reason() {
        let env = Env::default();
        let contract_id = env.register_contract(None, SupplyLinkContract);
        let client = SupplyLinkContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let actor = Address::generate(&env);
        let product_id = String::from_str(&env, "test-product-004");
        let name = String::from_str(&env, "Test Product");
        let origin = String::from_str(&env, "Test Origin");
        let location = String::from_str(&env, "Test Location");
        let event_type = String::from_str(&env, "HARVEST");
        let metadata = String::from_str(&env, "{}");
        
        // Create a reason exactly 256 characters (should work)
        let max_reason = String::from_str(&env, &"x".repeat(256));

        env.mock_all_auths();

        // Register product with multi-sig
        client.register_product(&product_id, &name, &origin, &owner, &2, &String::from_str(&env, "other"), &String::from_str(&env, "general"));
        client.add_authorized_actor(&product_id, &actor, &0);

        // Add pending event
        client.add_tracking_event(&product_id, &actor, &location, &event_type, &metadata);

        // Reject with max length reason (should work)
        let result = client.reject_event(&product_id, &0, &owner, &max_reason, &1);
        assert_eq!(result, true);
    }
