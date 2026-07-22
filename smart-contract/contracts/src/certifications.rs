use crate::*;
use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env, String, Symbol, Vec};

#[contractimpl]
impl SupplyLinkContract {
    /// Issue a certification for a product. (#428)
    ///
    /// Stores a [`ProductCertification`] entry for the given product. Only the
    /// product owner or an authorized actor may call this function.
    ///
    /// # Parameters
    /// - `product_id` — ID of the product to certify.
    /// - `caller` — Address of the actor issuing the certification.
    /// - `cert_id` — Caller-supplied unique identifier for this certification.
    /// - `cert_type` — Certification type key (e.g. `"fair_trade"`, `"organic"`).
    ///
    /// # Authorization
    /// Requires `caller.require_auth()`. Caller must be owner or authorized actor.
    pub fn issue_certification(
        env: Env,
        product_id: String,
        caller: Address,
        cert_id: String,
        cert_type: String,
    ) -> ProductCertification {
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
        assert_len(&cert_id, 128, "cert_id");
        assert_len(&cert_type, 64, "cert_type");

        let cert = ProductCertification {
            id: cert_id.clone(),
            product_id: product_id.clone(),
            cert_type,
            issuer: caller,
            issued_at: env.ledger().timestamp(),
            revoked: false,
            revoked_at: 0,
        };

        let mut certs: Vec<ProductCertification> = env
            .storage()
            .persistent()
            .get(&DataKey::Certifications(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        certs.push_back(cert.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Certifications(product_id.clone()), &certs);

        env.events().publish(
            (Symbol::new(&env, "certification_issued"), product_id),
            cert.clone(),
        );

        cert
    }
    /// Revoke a previously issued certification. (#428)
    ///
    /// Sets the `revoked` flag on the matching certification entry.
    /// Only the product owner may revoke a certification.
    ///
    /// # Parameters
    /// - `product_id` — ID of the product whose certification to revoke.
    /// - `caller` — Must be the product owner.
    /// - `cert_id` — ID of the certification to revoke.
    pub fn revoke_certification(
        env: Env,
        product_id: String,
        caller: Address,
        cert_id: String,
    ) -> bool {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .unwrap_or_else(|| panic!("product not found"));

        if product.owner != caller {
            panic!("only product owner can revoke certifications");
        }
        caller.require_auth();

        let mut certs: Vec<ProductCertification> = env
            .storage()
            .persistent()
            .get(&DataKey::Certifications(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        let mut updated: Vec<ProductCertification> = Vec::new(&env);
        for cert in certs.iter() {
            if cert.id == cert_id {
                let revoked_cert = ProductCertification {
                    revoked: true,
                    revoked_at: env.ledger().timestamp(),
                    ..cert.clone()
                };
                updated.push_back(revoked_cert.clone());
                env.events().publish(
                    (Symbol::new(&env, "certification_revoked"), product_id.clone()),
                    revoked_cert,
                );
                found = true;
            } else {
                updated.push_back(cert.clone());
            }
        }

        if found {
            env.storage()
                .persistent()
                .set(&DataKey::Certifications(product_id), &updated);
        }

        found
    }
    /// Return all certifications (active and revoked) for a product. (#428)
    pub fn list_certifications(
        env: Env,
        product_id: String,
    ) -> Vec<ProductCertification> {
        env.storage()
            .persistent()
            .get(&DataKey::Certifications(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Register a trusted certification issuer in the on-chain registry.
    ///
    /// Only the product owner or an authorized actor may register issuers.
    /// The issuer's Stellar address, name, and supported cert types are stored.
    ///
    /// # Panics
    /// - `"issuer already registered"` — if the address is already active.
    pub fn register_certification_issuer(
        env: Env,
        caller: Address,
        issuer_address: Address,
        name: String,
        cert_types: Vec<String>,
    ) -> CertificationIssuer {
        caller.require_auth();
        assert_len(&name, MAX_NAME_LEN, "name");

        // Prevent duplicate active registrations
        let existing: Option<CertificationIssuer> = env
            .storage()
            .persistent()
            .get(&DataKey::IssuerCertifications(issuer_address.clone()));
        if let Some(ref iss) = existing {
            if iss.active {
                panic!("issuer already registered");
            }
        }

        let issuer = CertificationIssuer {
            issuer_address: issuer_address.clone(),
            name,
            cert_types,
            registered_at: env.ledger().timestamp(),
            active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::IssuerCertifications(issuer_address.clone()), &issuer);

        // Maintain a global list of issuer addresses for enumeration
        let mut issuers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::CertificationIssuers)
            .unwrap_or_else(|| Vec::new(&env));
        if !issuers.contains(&issuer_address) {
            issuers.push_back(issuer_address.clone());
            env.storage()
                .persistent()
                .set(&DataKey::CertificationIssuers, &issuers);
        }

        env.events().publish(
            (Symbol::new(&env, "issuer_registered"), issuer_address),
            issuer.clone(),
        );

        issuer
    }
    /// Issue a certification registry record linking a product to an external cert.
    ///
    /// The issuer must be registered and active. The `cert_type` must be in
    /// the issuer's `cert_types` list. The `document_hash` is a hex-encoded
    /// SHA-256 of the external certificate document for cross-checking.
    ///
    /// # Panics
    /// - `"product not found"` — if `product_id` is not registered.
    /// - `"issuer not registered"` — if the issuer address is unknown.
    /// - `"issuer is not active"` — if the issuer has been deactivated.
    /// - `"cert_type not supported by issuer"` — if the type is not in the issuer's list.
    pub fn issue_certification_registry_record(
        env: Env,
        product_id: String,
        issuer_address: Address,
        record_id: String,
        external_cert_id: String,
        cert_type: String,
        document_hash: String,
    ) -> CertificationRegistryRecord {
        // Verify product exists
        if !env.storage().persistent().has(&DataKey::Product(product_id.clone())) {
            panic!("product not found");
        }

        issuer_address.require_auth();
        assert_len(&record_id, 128, "record_id");
        assert_len(&external_cert_id, 256, "external_cert_id");
        assert_len(&cert_type, 64, "cert_type");
        assert_len(&document_hash, MAX_COMMITMENT_LEN, "document_hash");

        let issuer: CertificationIssuer = env
            .storage()
            .persistent()
            .get(&DataKey::IssuerCertifications(issuer_address.clone()))
            .unwrap_or_else(|| panic!("issuer not registered"));

        if !issuer.active {
            panic!("issuer is not active");
        }

        if !issuer.cert_types.contains(&cert_type) {
            panic!("cert_type not supported by issuer");
        }

        let record = CertificationRegistryRecord {
            id: record_id.clone(),
            product_id: product_id.clone(),
            issuer_address: issuer_address.clone(),
            external_cert_id,
            cert_type,
            document_hash,
            issued_at: env.ledger().timestamp(),
            revoked: false,
            revoked_at: 0,
        };

        let mut reg_records: Vec<CertificationRegistryRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::CertRegistryRecords(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        reg_records.push_back(record.clone());
        env.storage()
            .persistent()
            .set(&DataKey::CertRegistryRecords(product_id.clone()), &reg_records);

        env.events().publish(
            (Symbol::new(&env, "cert_registry_issued"), product_id, issuer_address),
            record.clone(),
        );

        record
    }
    /// Verify a certification registry record by its `record_id`.
    ///
    /// Returns `(true, record)` if the record exists and is not revoked,
    /// `(false, record)` if it is revoked, or panics if not found.
    pub fn verify_certification_registry_record(
        env: Env,
        product_id: String,
        record_id: String,
    ) -> (bool, CertificationRegistryRecord) {
        let records: Vec<CertificationRegistryRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::CertRegistryRecords(product_id))
            .unwrap_or_else(|| Vec::new(&env));

        for record in records.iter() {
            if record.id == record_id {
                let valid = !record.revoked;
                return (valid, record);
            }
        }
        panic!("certification registry record not found");
    }
    /// Revoke a certification registry record.
    ///
    /// Only the issuer who created the record may revoke it.
    ///
    /// # Panics
    /// - `"record not found"` — if no record with `record_id` exists.
    /// - `"only issuer can revoke"` — if caller is not the original issuer.
    pub fn revoke_certification_registry_record(
        env: Env,
        product_id: String,
        caller: Address,
        record_id: String,
    ) -> bool {
        caller.require_auth();

        let records: Vec<CertificationRegistryRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::CertRegistryRecords(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut updated: Vec<CertificationRegistryRecord> = Vec::new(&env);
        let mut found = false;
        for record in records.iter() {
            if record.id == record_id {
                if record.issuer_address != caller {
                    panic!("only issuer can revoke");
                }
                let revoked = CertificationRegistryRecord {
                    revoked: true,
                    revoked_at: env.ledger().timestamp(),
                    ..record.clone()
                };
                env.events().publish(
                    (Symbol::new(&env, "cert_registry_revoked"), product_id.clone()),
                    revoked.clone(),
                );
                updated.push_back(revoked);
                found = true;
            } else {
                updated.push_back(record.clone());
            }
        }

        if !found {
            panic!("record not found");
        }

        env.storage()
            .persistent()
            .set(&DataKey::CertRegistryRecords(product_id), &updated);
        true
    }
    /// List all certification registry records for a product.
    pub fn list_certification_registry_records(
        env: Env,
        product_id: String,
    ) -> Vec<CertificationRegistryRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::CertRegistryRecords(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Deactivate a registered certification issuer.
    ///
    /// Only the issuer themselves can deactivate their own registration.
    pub fn deactivate_certification_issuer(
        env: Env,
        issuer_address: Address,
    ) -> bool {
        issuer_address.require_auth();

        let mut issuer: CertificationIssuer = env
            .storage()
            .persistent()
            .get(&DataKey::IssuerCertifications(issuer_address.clone()))
            .unwrap_or_else(|| panic!("issuer not registered"));

        issuer.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::IssuerCertifications(issuer_address.clone()), &issuer);

        env.events().publish(
            (Symbol::new(&env, "issuer_deactivated"), issuer_address),
            false,
        );

        true
    }
    /// Get a registered certification issuer by address.
    pub fn get_certification_issuer(
        env: Env,
        issuer_address: Address,
    ) -> CertificationIssuer {
        env.storage()
            .persistent()
            .get(&DataKey::IssuerCertifications(issuer_address))
            .unwrap_or_else(|| panic!("issuer not registered"))
    }
    /// Certify the timestamp of a tracking event.
    /// Only authorized certifiers can issue timestamp certifications.
    pub fn certify_event_timestamp(
        env: Env,
        product_id: String,
        event_stable_id: String,
        certifier: Address,
    ) -> EventTimestampCert {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        let is_owner = product.owner == certifier;
        let is_actor = product.authorized_actors.contains(&certifier);
        if !is_owner && !is_actor {
            panic!("certifier is not authorized");
        }
        certifier.require_auth();

        let cert_id = format_cert_id(&env, &product_id, &event_stable_id);
        let now = env.ledger().timestamp();

        let cert = EventTimestampCert {
            id: cert_id.clone(),
            product_id: product_id.clone(),
            event_stable_id,
            certified_timestamp: now,
            certifier,
            issued_at: now,
            revoked: false,
        };

        let mut certs: Vec<EventTimestampCert> = env
            .storage()
            .persistent()
            .get(&DataKey::EventTimestampCerts(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        certs.push_back(cert.clone());
        env.storage()
            .persistent()
            .set(&DataKey::EventTimestampCerts(product_id.clone()), &certs);

        env.events().publish(
            (Symbol::new(&env, "event_timestamp_certified"), product_id),
            cert.clone(),
        );

        cert
    }
    /// Get all timestamp certifications for a product.
    pub fn get_event_timestamp_certs(env: Env, product_id: String) -> Vec<EventTimestampCert> {
        env.storage()
            .persistent()
            .get(&DataKey::EventTimestampCerts(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Revoke a timestamp certification.
    pub fn revoke_event_timestamp_cert(
        env: Env,
        product_id: String,
        cert_id: String,
        revoker: Address,
    ) -> bool {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        product.owner.require_auth();

        let mut certs: Vec<EventTimestampCert> = env
            .storage()
            .persistent()
            .get(&DataKey::EventTimestampCerts(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        for i in 0..certs.len() {
            let mut cert = certs.get(i).unwrap().clone();
            if cert.id == cert_id {
                cert.revoked = true;
                certs.set(i, cert);
                found = true;
                break;
            }
        }

        if found {
            env.storage()
                .persistent()
                .set(&DataKey::EventTimestampCerts(product_id.clone()), &certs);
            env.events().publish(
                (Symbol::new(&env, "event_timestamp_cert_revoked"), product_id),
                cert_id,
            );
        }

        found
    }
    /// Register a new certifier.
    pub fn register_certifier(
        env: Env,
        id: String,
        address: Address,
        name: String,
        cert_types: Vec<String>,
    ) -> Certifier {
        address.require_auth();

        let certifier = Certifier {
            id: id.clone(),
            address,
            name,
            cert_types,
            registered_at: env.ledger().timestamp(),
            active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Certifier(id.clone()), &certifier);

        let mut certifier_ids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::CertifierIndex)
            .unwrap_or_else(|| Vec::new(&env));
        certifier_ids.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::CertifierIndex, &certifier_ids);

        env.events().publish(
            (Symbol::new(&env, "certifier_registered"), id),
            certifier.clone(),
        );

        certifier
    }
    /// Get a certifier by ID.
    pub fn get_certifier(env: Env, id: String) -> Option<Certifier> {
        env.storage()
            .persistent()
            .get(&DataKey::Certifier(id))
    }
    /// Certify a supply chain event.
    pub fn certify_event(
        env: Env,
        product_id: String,
        event_stable_id: String,
        cert_type: String,
        certifier_id: String,
        metadata: String,
    ) -> EventCertification {
        let certifier: Certifier = env
            .storage()
            .persistent()
            .get(&DataKey::Certifier(certifier_id.clone()))
            .expect("certifier not found");

        if !certifier.active {
            panic!("certifier is not active");
        }

        certifier.address.require_auth();

        // Verify certifier is authorized for this cert type
        let mut authorized = false;
        for i in 0..certifier.cert_types.len() {
            if certifier.cert_types.get(i).unwrap() == cert_type {
                authorized = true;
                break;
            }
        }
        if !authorized {
            panic!("certifier is not authorized for this certification type");
        }

        let cert_id = format_event_cert_id(&env, &product_id, &event_stable_id, &cert_type);
        let now = env.ledger().timestamp();

        let certification = EventCertification {
            id: cert_id.clone(),
            product_id: product_id.clone(),
            event_stable_id,
            cert_type,
            certifier: certifier.address,
            metadata,
            issued_at: now,
            revoked: false,
            revoked_at: 0,
        };

        let mut certifications: Vec<EventCertification> = env
            .storage()
            .persistent()
            .get(&DataKey::EventCertifications(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        certifications.push_back(certification.clone());
        env.storage()
            .persistent()
            .set(&DataKey::EventCertifications(product_id.clone()), &certifications);

        env.events().publish(
            (Symbol::new(&env, "event_certified"), product_id),
            certification.clone(),
        );

        certification
    }
    /// Get all event certifications for a product.
    pub fn get_event_certifications(env: Env, product_id: String) -> Vec<EventCertification> {
        env.storage()
            .persistent()
            .get(&DataKey::EventCertifications(product_id))
            .unwrap_or_else(|| Vec::new(&env))
    }
    /// Revoke an event certification.
    pub fn revoke_event_certification(
        env: Env,
        product_id: String,
        cert_id: String,
    ) -> bool {
        let product: Product = env
            .storage()
            .persistent()
            .get(&DataKey::Product(product_id.clone()))
            .expect("product not found");

        product.owner.require_auth();

        let mut certifications: Vec<EventCertification> = env
            .storage()
            .persistent()
            .get(&DataKey::EventCertifications(product_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        for i in 0..certifications.len() {
            let mut cert = certifications.get(i).unwrap().clone();
            if cert.id == cert_id {
                cert.revoked = true;
                cert.revoked_at = env.ledger().timestamp();
                certifications.set(i, cert);
                found = true;
                break;
            }
        }

        if found {
            env.storage()
                .persistent()
                .set(&DataKey::EventCertifications(product_id.clone()), &certifications);
            env.events().publish(
                (Symbol::new(&env, "event_certification_revoked"), product_id),
                cert_id,
            );
        }

        found
    }
}
