use soroban_sdk::{contracttype, Address, String};

#[contracttype]
pub enum DataKey {
    Product(String),
    Events(String),
    /// Batch entity keyed by batch ID. (#405)
    Batch(String),
    /// Aggregate events recorded at the batch level. (#405)
    BatchEvents(String),
    /// Key for pending events awaiting multi-signature approval.
    /// The inner `String` is the product ID.
    PendingEvents(String),
    /// Key for the next stable pending event ID counter.
    /// The inner `String` is the product ID.
    /// Stores a `u64` used to generate unique identifiers for pending events.
    NextPendingId(String),
    /// Key for the global product registration counter.
    ProductCount,
    ProductIndex(u64),
    /// Recall history for a product: Vec<String> of recall reasons (#393).
    RecallHistory(String),
    /// Key for the authorization policy (roles + threshold) of a product.
    AuthPolicy(String),
    /// Key for actor nonce tracking. The inner `Address` is the actor address.
    ActorNonce(Address),
    /// Key for the compliance policy of a product. The inner `String` is the product ID.
    CompliancePolicy(String),
    /// Key for approval hops in the chain-of-custody. The inner `String` is the product ID. (#499)
    ApprovalHops(String),
    /// Key for origin attestations. The inner `String` is the product ID. (#500)
    OriginAttestations(String),
    /// Key for document anchors for a product. The inner `String` is the product ID. (#460)
    DocumentAnchors(String),
    /// Key for product ID aliases. The inner `String` is the alias. (#508)
    ProductIdAlias(String),
    /// Key for provenance score metadata. The inner `String` is the product ID. (#507)
    ProvenanceScore(String),
    /// Archived events for a product — events flagged as archived but retained for audit. (archival)
    ArchivedEvents(String),
    /// Certification registry issuers — trusted third-party certification bodies. (cert-registry)
    CertificationIssuers,
    /// Per-issuer certification records keyed by issuer address. (cert-registry)
    IssuerCertifications(Address),
    /// Certification registry records for a product. (cert-registry)
    CertRegistryRecords(String),
    /// On-chain product certifications (#428). The inner `String` is the product ID.
    Certifications(String),
    /// Event-level certifications (#505). The inner `String` is the product ID.
    EventCertifications(String),
    /// Provenance notarizations for a product (#504). The inner `String` is the product ID.
    ProvenanceNotarizations(String),
    /// Registered certifier by ID (#505). The inner `String` is the certifier ID.
    Certifier(String),
    /// List of all certifier IDs (#505).
    CertifierIds,
    /// Index of certifier IDs (alternate key). The inner `String` is the certifier ID.
    CertifierIndex(String),
    /// Pending ownership transfer escrow. The inner `String` is the product ID.
    TransferEscrow(String),
    /// Anomaly reports for a product. The inner `String` is the product ID.
    AnomalyReports(String),
    /// Event timestamp certifications. The inner `String` is the product ID.
    EventTimestampCerts(String),
    /// Single pending event by ID (alternate lookup). The inner `String` is the product ID.
    PendingEvent(String),
    /// Provenance root hash for a product. The inner `String` is the product ID.
    ProvenanceRoot(String),
    // ── #403: Event indexing ──────────────────────────────────────────────────
    /// Index of stable_ids for events by actor address.
    EventsByActor(Address),
    /// Index of stable_ids for events by location string.
    EventsByLocation(String),
    /// Index of stable_ids for events by event_type string.
    EventsByType(String),
    // ── #402: Signer proof ────────────────────────────────────────────────────
    /// Signer proof record keyed by event stable_id.
    SignerProof(String),
    // ── #401: Event-hash deduplication ───────────────────────────────────────
    /// Marks a stable_id as already recorded (replay protection).
    EventHashSeen(String),
    // ── #400: Audit snapshots ─────────────────────────────────────────────────
    /// Snapshots for a product. The inner `String` is the product ID.
    Snapshots(String),
    // ── Gas optimisation: per-event keyed storage (O(1) writes) ──────────────
    /// Individual tracking event keyed by (product_id, index). Replaces the
    /// unbounded `Events(String)` Vec for all new writes. Reading a page of N
    /// events requires N storage reads but each write is O(1) rather than O(n).
    EventEntry(String, u32),
    /// Per-product event counter — the next index to write to.
    EventCount(String),
    /// Contract administrator address.
    Admin,
    /// Attestations for a product. The inner `String` is the product ID.
    Attestations(String),
    /// Registered auditor record. The inner `Address` is the auditor address.
    Auditor(Address),
    /// Whether a given contract ID is authorized as an upgrade target.
    AuthorizedUpgrade(Address),
    /// List of all authorized upgrade target contract IDs.
    AuthorizedUpgradeTargets,
    /// Recall history for a batch: Vec<String> of recall reasons.
    BatchRecallHistory(String),
    /// Whether the contract is currently paused (emergency stop).
    ContractPaused,
    /// Whether a given address is a registered upgrade guardian.
    UpgradeGuardian(Address),
    /// List of all registered upgrade guardian addresses.
    UpgradeGuardians,
}

// ── Contract ─────────────────────────────────────────────────────────────────
