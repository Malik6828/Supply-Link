use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

/// Typed contract errors for frontend mapping (#390).
#[contracterror]
#[derive(Clone, Copy, PartialEq, Debug)]
#[repr(u32)]
pub enum ContractError {
    ProductNotFound        = 1,
    ProductAlreadyExists   = 2,
    UnauthorizedActor      = 3,
    OwnershipMismatch      = 4,
    InvalidEventPayload    = 5,
    ProductRecalled        = 6,
    SelfTransferNotAllowed = 7,
}
// ── Error types ──────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Error {
    ProductNotFound = 1,
    NotAuthorized = 2,
    ApproverNotAuthorized = 3,
    NoPendingEvents = 4,
    OwnerOnly = 5,
    PendingEventExpired = 6,
    InvalidNonce = 7,
    ComplianceViolation = 8,
    /// Contract is paused; write operations are not permitted.
    ContractPaused = 9,
}

// ── Compliance rule types ─────────────────────────────────────────────────────
pub const COMPLIANCE_REQUIRED_ORDER: u32 = 0;
pub const COMPLIANCE_MANDATORY_INSPECTION: u32 = 1;
pub const COMPLIANCE_MAX_TIME_BETWEEN_STAGES: u32 = 2;

/// A single compliance rule constraining event sequencing for a product.
#[contracttype]
#[derive(Clone)]
pub struct ComplianceRule {
    /// Rule kind: 0=RequiredOrder, 1=MandatoryInspection, 2=MaxTimeBetweenStages.
    pub rule_type: u32,
    /// Preceding stage that must have occurred (for types 0 and 1).
    pub from_stage: String,
    /// Stage this rule guards (the event type being submitted).
    pub to_stage: String,
    /// Max seconds allowed between from_stage and to_stage (for type 2).
    pub max_seconds: u64,
}

/// Per-product compliance policy: a collection of rules enforced on every event.
#[contracttype]
#[derive(Clone)]
pub struct CompliancePolicy {
    pub product_id: String,
    pub rules: Vec<ComplianceRule>,
}

// ── Data models ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum LifecycleStage {
    Registered,
    Harvested,
    Processed,
    Shipped,
    Delivered,
    Retail,
}

#[contracttype]
#[derive(Clone)]
pub struct Product {
    /// Caller-supplied unique identifier for this product (e.g. `"batch-2024-001"`).
    /// Must be unique across all registered products; duplicate IDs are rejected
    /// with `"product already exists"` and leave existing state unchanged.
    pub id: String,
    pub name: String,
    pub origin: String,
    pub owner: Address,
    pub timestamp: u64,
    pub authorized_actors: Vec<Address>,
    /// Whether this product has been recalled (#393).
    pub recalled: bool,
    /// Reason provided when the product was recalled (#393).
    pub recall_reason: String,
    /// Ledger timestamp when the product was recalled; 0 if never recalled (#393).
    pub recall_timestamp: u64,
    /// Schema version of this record (#392).
    pub schema_version: u32,
    /// Expiration timestamp; 0 if the product does not expire.
    pub expiration_timestamp: u64,
    /// Whether the product has been marked spoiled.
    pub spoiled: bool,
    /// Number of signatures required to approve events for this product.
    /// If 0 or 1, events are recorded immediately. If > 1, events are staged
    /// as pending until the required number of approvals are received.
    pub required_signatures: u32,
    /// Lifecycle state of the product. `true` indicates the product is active
    /// and can receive tracking events. `false` indicates the product has been
    /// deactivated and is read-only. Defaults to `true` on registration.
    pub active: bool,
    /// Taxonomy category ID for this product (e.g. `"agricultural"`). (#425)
    /// Must be a recognised category from the controlled vocabulary.
    pub category: String,
    /// Taxonomy subcategory ID within `category` (e.g. `"coffee"`). (#425)
    pub subcategory: String,
    /// Hazard status (#454)
    pub hazardous: bool,
    pub hazard_classification: String,
    /// Current lifecycle stage (#404)
    pub lifecycle_stage: LifecycleStage,
}

/// A product certification issued by an authorised actor. (#428)
///
/// Certifications are stored as a `Vec<ProductCertification>` under
/// [`DataKey::Certifications`] keyed by `product_id`. Each entry carries
/// the issuer address, a string certification type from the controlled
/// vocabulary (e.g. `"fair_trade"`, `"organic"`), and a revocation flag.
#[contracttype]
#[derive(Clone)]
pub struct ProductCertification {
    /// Stable unique identifier for this certification entry.
    pub id: String,
    /// ID of the product this certification belongs to.
    pub product_id: String,
    /// Certification type key (e.g. `"fair_trade"`, `"organic"`, `"iso_9001"`).
    pub cert_type: String,
    /// Stellar address of the actor who issued this certification.
    /// Must be the product owner or an authorized actor at issuance time.
    pub issuer: Address,
    /// Ledger timestamp when the certification was issued.
    pub issued_at: u64,
    /// `true` if this certification has been revoked; `false` otherwise.
    pub revoked: bool,
    /// Ledger timestamp when the certification was revoked (0 if not revoked).
    pub revoked_at: u64,
}

/// A single supply-chain event recorded against a [`Product`].
///
/// Events are append-only. Once written they cannot be modified or deleted,
/// providing an immutable audit trail. All events for a product are stored
/// together under [`DataKey::Events`].
///
/// # Schema versioning
/// The `schema_version` field carries [`EVENT_SCHEMA_VERSION`] at write time.
/// Indexers and backend services must read this field first and dispatch to the
/// appropriate parser before accessing any other fields. The version is also
/// encoded as the **fourth topic slot** (index 3) in every emitted event so
/// consumers can filter by version without deserialising the payload.
/// Topic layout: `(event_name, product_id, event_type, schema_version)`.
///
/// # Storage
/// Stored as a `Vec<TrackingEvent>` under [`DataKey::Events`] keyed by
/// `product_id`. Storage type is `persistent`.
#[contracttype]
#[derive(Clone)]
pub struct TrackingEvent {
    /// Schema version of this event payload. Always set to
    /// [`EVENT_SCHEMA_VERSION`] at write time. Consumers must check this field
    /// before parsing any other fields.
    pub schema_version: u32,
    /// ID of the [`Product`] this event belongs to.
    pub product_id: String,
    pub location: String,
    pub actor: Address,
    pub timestamp: u64,
    pub event_type: String,
    /// Arbitrary JSON string carrying stage-specific metadata
    /// (e.g. `{"temperature":"4°C","humidity":"60%"}`). The contract stores
    /// this opaquely; consumers are responsible for parsing it.
    ///
    /// For privacy-preserving events (see `private_metadata`) this field is an
    /// **empty string**: the plaintext is never written on-chain. The encrypted
    /// payload lives off-chain and only its hash is recorded in
    /// `metadata_commitment`.
    pub metadata: String,
    /// Hex-encoded hash of the off-chain encrypted payload, present when
    /// `private_metadata` is `true`.
    pub metadata_commitment: String,
    /// `true` if this event's plaintext metadata was withheld on-chain (issue #409).
    pub private_metadata: bool,
    /// Stable deterministic event ID — a hex-encoded SHA-256 hash of the
    /// canonical fields: `product_id|actor|event_type|timestamp|metadata`.
    /// Invariant across contract upgrades; suitable for deep links and QR payloads.
    pub stable_id: String,
}

// ── Role types (#387) ─────────────────────────────────────────────────────────

/// Named role for an authorized actor.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum Role {
    /// Can harvest/originate events.
    Producer,
    /// Can add processing events.
    Processor,
    /// Can add shipping events.
    Shipper,
    /// Can add retail events.
    Retailer,
    /// Can add any event type.
    Any,
}

/// Binds an actor address to a named role.
#[contracttype]
#[derive(Clone)]
pub struct ActorRole {
    pub actor: Address,
    pub role: Role,
}

/// Authorization policy for a product.
#[contracttype]
#[derive(Clone)]
pub struct AuthPolicy {
    /// Minimum number of distinct authorized actors that must sign an event
    /// for high-risk event types. 1 = single-signer (default).
    pub threshold: u32,
    /// Role assignments for this product's authorized actors.
    pub roles: Vec<ActorRole>,
}

/// A pending event awaiting multi-signature approval.
///
/// For high-value products, events are staged until the required number of
/// authorized actors have approved them.
///
/// Each pending event has a stable identifier (`pending_event_id`) that remains
/// unchanged even if other pending events in the queue are removed or approved.
/// This prevents client mistakes from index-based references that shift after
/// queue mutations.
#[contracttype]
#[derive(Clone)]
pub struct PendingEvent {
    /// Stable unique identifier for this pending event within its product.
    /// Generated at creation time and immutable. Used for deterministic targeting
    /// in approve/reject operations to avoid index-based race conditions.
    pub pending_event_id: u64,
    /// ID of the product this event is for.
    pub product_id: String,
    /// The event data awaiting approval.
    pub event: TrackingEvent,
    /// Addresses that have approved this event.
    pub approvals: Vec<Address>,
    /// Number of approvals required before the event is finalized.
    pub required_signatures: u32,
    /// Timestamp when the pending event was created.
    pub created_at: u64,
    /// Timestamp when this pending event expires (issue #314).
    pub expiration: u64,
}

/// Event rejection data with optional reason context.
///
/// Emitted when a pending event is rejected, providing audit trail
/// and optional explanation for the rejection decision.
#[contracttype]
#[derive(Clone)]
pub struct EventRejection {
    /// The product ID the rejected event was for.
    pub product_id: String,
    /// The rejected event data.
    pub event: TrackingEvent,
    /// Address of the actor who rejected the event.
    pub rejector: Address,
    /// Optional reason for rejection (max 256 characters).
    pub reason: String,
    /// Timestamp of the rejection.
    pub timestamp: u64,
    pub event_type: String, // HARVEST | PROCESSING | SHIPPING | RETAIL | SPOILED | EXPIRED
    pub metadata: String,   // JSON string
}

/// A batch/lot grouping multiple product IDs together. (#405)
#[contracttype]
#[derive(Clone)]
pub struct Batch {
    pub id: String,
    pub name: String,
    pub owner: Address,
    pub product_ids: Vec<String>,
    pub timestamp: u64,
    /// Whether this batch has been recalled.
    pub recalled: bool,
    /// Reason provided when the batch was recalled.
    pub recall_reason: String,
    /// Ledger timestamp when the batch was recalled; 0 if never recalled.
    pub recall_timestamp: u64,
}

// ── Auditor registry (#auditor) ───────────────────────────────────────────────

/// A registered auditor who can sign attestations for events and products.
///
/// Auditors are identified by their Stellar address. Only registered auditors
/// may submit attestations. Registration is permissioned — only the contract
/// admin (first caller of `initialize_admin`) may register auditors.
#[contracttype]
#[derive(Clone)]
pub struct Auditor {
    /// Stellar address of the auditor.
    pub address: Address,
    /// Human-readable name of the auditing organisation.
    pub name: String,
    /// Whether this auditor registration is currently active.
    pub active: bool,
    /// Ledger timestamp when the auditor was registered.
    pub registered_at: u64,
}

/// A contract upgrade authorization record that is emitted whenever an upgrade
/// target is approved or revoked by an upgrade guardian.
#[contracttype]
#[derive(Clone)]
pub struct ContractUpgradeAuthorization {
    /// The approved contract address.
    pub contract_id: Address,
    /// Guardian address that approved or revoked the upgrade.
    pub guardian: Address,
    /// Ledger timestamp when the action occurred.
    pub timestamp: u64,
    /// Whether the contract address was authorized (`true`) or revoked (`false`).
    pub authorized: bool,
}

/// A signed attestation from a registered auditor for a product event or product.
///
/// Attestations are append-only. The `signature` field carries a hex-encoded
/// Ed25519 signature over the canonical payload:
/// `product_id|target_id|attestation_type|timestamp` (UTF-8 bytes, pipe-separated).
///
/// Consumers verify the signature by:
/// 1. Reconstructing the canonical payload string.
/// 2. Fetching the auditor's public key (their Stellar address).
/// 3. Verifying the Ed25519 signature.
#[contracttype]
#[derive(Clone)]
pub struct Attestation {
    /// Stable unique identifier for this attestation.
    pub id: String,
    /// ID of the product this attestation is for.
    pub product_id: String,
    /// ID of the specific event being attested (stable_id), or empty string
    /// if the attestation is at the product level.
    pub target_id: String,
    /// Stellar address of the auditor who signed this attestation.
    pub auditor: Address,
    /// Attestation type (e.g. `"quality_check"`, `"compliance_verified"`,
    /// `"safety_approved"`, `"origin_verified"`).
    pub attestation_type: String,
    /// Hex-encoded Ed25519 signature over the canonical payload.
    pub signature: String,
    /// Ledger timestamp when the attestation was submitted.
    pub timestamp: u64,
    /// Optional human-readable notes from the auditor (max 1024 bytes).
    pub notes: String,
}

/// An approval hop in the chain-of-custody for a product. (#499)
/// Records each actor's approval as the product moves through the supply chain.
#[contracttype]
#[derive(Clone)]
pub struct ApprovalHop {
    /// ID of the product being approved.
    pub product_id: String,
    /// Address of the actor approving the product.
    pub approver: Address,
    /// Type of approval (e.g., "RECEIVED", "INSPECTED", "SHIPPED").
    pub approval_type: String,
    /// Timestamp when the approval was recorded.
    pub timestamp: u64,
    /// Optional JSON metadata about the approval.
    pub metadata: String,
}

/// An origin attestation for a product. (#500)
/// Proves where goods came from with cryptographic proof.
#[contracttype]
#[derive(Clone)]
pub struct OriginAttestation {
    /// ID of the product being attested.
    pub product_id: String,
    /// Address of the actor attesting to the origin.
    pub attester: Address,
    /// Description of the origin (e.g., "Ethiopian highlands, Yirgacheffe region").
    pub origin_claim: String,
    /// Cryptographic hash of supporting documentation.
    pub proof_hash: String,
    /// Timestamp when the attestation was recorded.
    pub timestamp: u64,
    /// Whether this attestation has been verified.
    pub verified: bool,
}

/// An off-chain document anchored on-chain by its SHA-256 hash. (#460)
///
/// Callers compute the SHA-256 hash of the document bytes off-chain and submit
/// it here. The contract stores the hash alongside a human-readable label and
/// the anchoring actor's address. Anyone can later call `verify_document_hash`
/// to check whether a given hash matches the stored anchor.
#[contracttype]
#[derive(Clone)]
pub struct DocumentAnchor {
    /// Product this document belongs to.
    pub product_id: String,
    /// Human-readable label for the document (e.g. `"Certificate of Origin"`).
    pub label: String,
    /// Hex-encoded SHA-256 hash of the document bytes (64 chars).
    pub hash: String,
    /// Stellar address of the actor who anchored the document.
    pub anchored_by: Address,
    /// Ledger timestamp when the anchor was recorded.
    pub anchored_at: u64,
}

/// Product identifier alias mapping for canonicalization (#508).
/// Maps external/alternative identifiers to the canonical product ID.
#[contracttype]
#[derive(Clone)]
pub struct ProductIdAlias {
    /// The canonical product ID this alias maps to.
    pub canonical_id: String,
    /// The external/alternative identifier.
    pub alias: String,
    /// Stellar address of the actor who created this alias.
    pub created_by: Address,
    /// Ledger timestamp when the alias was created.
    pub created_at: u64,
}

/// Provenance score metadata for tracking across upgrades (#507).
#[contracttype]
#[derive(Clone)]
pub struct ProvenanceScoreMetadata {
    /// Product ID this score belongs to.
    pub product_id: String,
    /// Current provenance score (0-100).
    pub score: u32,
    /// Timestamp of last score calculation.
    pub last_calculated_at: u64,
    /// Number of verified events contributing to this score.
    pub verified_event_count: u32,
    /// Schema version for score calculation semantics.
    pub schema_version: u32,
}

/// Archival record wrapping a [`TrackingEvent`] with retention metadata.
///
/// Archived events are moved out of the active `Events` list into a separate
/// `ArchivedEvents` store. The original event data and its `stable_id` are
/// preserved verbatim so integrity proofs remain valid. Archived events do
/// **not** appear in `get_tracking_events` / `list_tracking_events` but are
/// fully queryable via `list_archived_events`.
#[contracttype]
#[derive(Clone)]
pub struct ArchivedEvent {
    /// The original tracking event — unchanged, integrity preserved.
    pub event: TrackingEvent,
    /// Stellar address of the actor who archived this event.
    pub archived_by: Address,
    /// Ledger timestamp when the event was archived.
    pub archived_at: u64,
    /// Optional human-readable reason for archival (e.g. "retention policy").
    pub reason: String,
}

/// A trusted certification issuer registered in the on-chain certification registry.
///
/// Third-party agencies (e.g. ISO bodies, fair-trade organisations) are
/// registered here. Products can then reference a `cert_registry_ref` that
/// points to an issuer + external certificate ID, and anyone can call
/// `verify_certification_registry_ref` to confirm the reference is valid.
#[contracttype]
#[derive(Clone)]
pub struct CertificationIssuer {
    /// Stellar address of the issuing organisation's on-chain identity.
    pub issuer_address: Address,
    /// Human-readable name of the issuing organisation.
    pub name: String,
    /// Certification types this issuer is authorised to issue (e.g. `"organic"`, `"iso_9001"`).
    pub cert_types: Vec<String>,
    /// Ledger timestamp when this issuer was registered.
    pub registered_at: u64,
    /// Whether this issuer is currently active.
    pub active: bool,
}

/// A certification registry record linking a product certification to an external issuer.
///
/// Stores the issuer address, the external certificate ID (as issued by the
/// third-party body), and a cross-check hash so consumers can verify the
/// reference without trusting the on-chain string alone.
#[contracttype]
#[derive(Clone)]
pub struct CertificationRegistryRecord {
    /// Unique ID for this registry record.
    pub id: String,
    /// ID of the product this record belongs to.
    pub product_id: String,
    /// Stellar address of the registered issuer.
    pub issuer_address: Address,
    /// External certificate identifier as issued by the third-party body.
    pub external_cert_id: String,
    /// Certification type (must match one of the issuer's `cert_types`).
    pub cert_type: String,
    /// Hex-encoded SHA-256 hash of the external certificate document for cross-checking.
    pub document_hash: String,
    /// Ledger timestamp when this record was created.
    pub issued_at: u64,
    /// Whether this registry record has been revoked.
    pub revoked: bool,
    /// Ledger timestamp when revoked (0 if not revoked).
    pub revoked_at: u64,
}

// ── Storage keys ─────────────────────────────────────────────────────────────

/// Signer proof for a tracking event (#402).
///
/// Stores the actor address and a deterministic payload hash that external
/// clients can verify without trusting the application.
#[contracttype]
#[derive(Clone)]
pub struct SignerProof {
    /// Stable event ID this proof belongs to.
    pub event_stable_id: String,
    /// Address of the actor who submitted the event.
    pub signer: Address,
    /// SHA-256 hex hash of `product_id|actor|event_type|timestamp|metadata`.
    pub payload_hash: String,
    /// Ledger timestamp when the proof was recorded.
    pub timestamp: u64,
}

/// An immutable audit snapshot of a product's state (#400).
#[contracttype]
#[derive(Clone)]
pub struct AuditSnapshot {
    /// Unique snapshot ID (hex-encoded SHA-256 of product_id + timestamp).
    pub id: String,
    /// Product ID this snapshot covers.
    pub product_id: String,
    /// SHA-256 hex hash of the serialised product state + event list.
    pub snapshot_hash: String,
    /// Address of the owner who created the snapshot.
    pub created_by: Address,
    /// Ledger timestamp when the snapshot was created.
    pub timestamp: u64,
    /// Number of events included in the snapshot.
    pub event_count: u32,
}

/// Pending ownership transfer escrow (#396)
#[contracttype]
#[derive(Clone)]
pub struct TransferEscrow {
    pub product_id: String,
    pub current_owner: Address,
    pub proposed_owner: Address,
    pub requested_at: u64,
    pub disputed: bool,
}

/// A registered third-party certifier (#505).
#[contracttype]
#[derive(Clone)]
pub struct Certifier {
    pub id: String,
    pub address: Address,
    pub name: String,
    pub cert_types: Vec<String>,
    pub registered_at: u64,
    pub active: bool,
}

/// An event-level certification issued by a registered certifier (#505).
#[contracttype]
#[derive(Clone)]
pub struct EventCertification {
    pub id: String,
    pub product_id: String,
    pub event_stable_id: String,
    pub cert_type: String,
    pub certifier: Address,
    pub metadata: String,
    pub issued_at: u64,
    pub revoked: bool,
    pub revoked_at: u64,
}

/// A timestamp certification for a tracking event (#503).
#[contracttype]
#[derive(Clone)]
pub struct EventTimestampCert {
    pub id: String,
    pub product_id: String,
    pub event_stable_id: String,
    pub certified_timestamp: u64,
    pub certifier: Address,
    pub issued_at: u64,
    pub revoked: bool,
}

/// A notarization of a product's provenance proof (#504).
#[contracttype]
#[derive(Clone)]
pub struct ProvenanceNotarization {
    pub id: String,
    pub product_id: String,
    pub proof_hash: String,
    pub notary: Address,
    pub notarized_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
}

/// An anomaly report for a product's supply chain (#506).
#[contracttype]
#[derive(Clone)]
pub struct AnomalyReport {
    pub id: String,
    pub product_id: String,
    pub anomaly_type: String,
    pub severity: u32,
    pub description: String,
    pub suggested_actions: String,
    pub detected_at: u64,
    pub reviewed: bool,
    pub reviewed_by: Address,
    pub reviewed_at: u64,
}
