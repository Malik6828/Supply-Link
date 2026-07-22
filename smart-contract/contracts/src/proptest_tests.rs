#![cfg(test)]
use crate::*;
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Env, String};

    /// Property 1: Registered product with one HARVEST event has count == 1
    #[cfg(test)]
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn prop_count_equals_n_events(product_id_str in "[a-z]{1,20}") {
            let env = Env::default();
            env.mock_all_auths();
            let contract_id = env.register_contract(None, SupplyLinkContract);
            let client = SupplyLinkContractClient::new(&env, &contract_id);
            let owner = soroban_sdk::Address::generate(&env);
            let product_id = String::from_str(&env, &product_id_str);

            client.register_product(
                &product_id,
                &String::from_str(&env, "Widget"),
                &String::from_str(&env, "Origin"),
                &owner,
                &1,
                &String::from_str(&env, "other"),
                &String::from_str(&env, "general"),
            );
            prop_assert_eq!(client.get_events_count(&product_id), 0);

            client.add_tracking_event(
                &product_id,
                &owner,
                &String::from_str(&env, "Farm"),
                &String::from_str(&env, "HARVEST"),
                &String::from_str(&env, "{}"),
            );
            prop_assert_eq!(client.get_events_count(&product_id), 1);
        }
    }
    /// Property 2: Unknown product returns 0
    #[cfg(test)]
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn prop_unknown_product_returns_zero(product_id_str in "[a-z]{1,20}") {
            let env = Env::default();
            let contract_id = env.register_contract(None, SupplyLinkContract);
            let client = SupplyLinkContractClient::new(&env, &contract_id);
            let product_id = String::from_str(&env, &product_id_str);
            prop_assert_eq!(client.get_events_count(&product_id), 0);
        }
    }
    /// Property 3: After HARVEST, count increments by one
    #[cfg(test)]
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn prop_add_increments_count(product_id_str in "[a-z]{1,20}") {
            let env = Env::default();
            env.mock_all_auths();
            let contract_id = env.register_contract(None, SupplyLinkContract);
            let client = SupplyLinkContractClient::new(&env, &contract_id);
            let owner = soroban_sdk::Address::generate(&env);
            let product_id = String::from_str(&env, &product_id_str);

            client.register_product(
                &product_id,
                &String::from_str(&env, "Widget"),
                &String::from_str(&env, "Origin"),
                &owner,
                &1,
                &String::from_str(&env, "other"),
                &String::from_str(&env, "general"),
            );
            let count_before = client.get_events_count(&product_id);
            client.add_tracking_event(
                &product_id,
                &owner,
                &String::from_str(&env, "Farm"),
                &String::from_str(&env, "HARVEST"),
                &String::from_str(&env, "{}"),
            );
            let count_after = client.get_events_count(&product_id);
            prop_assert_eq!(count_after, count_before + 1);
        }
    }
    /// Property 4: Count equals vec length
    #[cfg(test)]
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]
        #[test]
        fn prop_count_equals_vec_len(product_id_str in "[a-z]{1,20}") {
            let env = Env::default();
            env.mock_all_auths();
            let contract_id = env.register_contract(None, SupplyLinkContract);
            let client = SupplyLinkContractClient::new(&env, &contract_id);
            let owner = soroban_sdk::Address::generate(&env);
            let product_id = String::from_str(&env, &product_id_str);

            client.register_product(
                &product_id,
                &String::from_str(&env, "Widget"),
                &String::from_str(&env, "Origin"),
                &owner,
                &1,
                &String::from_str(&env, "other"),
                &String::from_str(&env, "general"),
            );
            client.add_tracking_event(
                &product_id,
                &owner,
                &String::from_str(&env, "Farm"),
                &String::from_str(&env, "HARVEST"),
                &String::from_str(&env, "{}"),
            );
            let count = client.get_events_count(&product_id);
            let events = client.get_tracking_events(&product_id);
            prop_assert_eq!(count, events.len());
        }
    }
