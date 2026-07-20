export type EventType = 'HARVEST' | 'PROCESSING' | 'SHIPPING' | 'RETAIL';
export type ProductStatus = 'active' | 'inactive';

// ── #479 Provenance-based pricing ─────────────────────────────────────────────

/** A single pricing adjustment rule keyed to a provenance score range. */
export interface PricingAdjustmentRule {
  /** Minimum provenance score percentage (0–100) for this rule to apply. */
  minScore: number;
  /** Maximum provenance score percentage (0–100) for this rule to apply. */
  maxScore: number;
  /** Multiplier applied to base price (e.g. 1.1 = +10%, 0.9 = -10%). */
  multiplier: number;
  /** Human-readable label for this tier (e.g. "Premium", "Standard"). */
  label: string;
}

/** Pricing metadata attached to a product. */
export interface ProductPricingMetadata {
  /** Base price in the smallest unit of the currency (e.g. cents). */
  basePrice: number;
  /** ISO 4217 currency code (e.g. "USD"). */
  currency: string;
  /** Ordered list of adjustment rules; first matching rule wins. */
  adjustmentRules: PricingAdjustmentRule[];
}

/** Result of applying provenance-based pricing to a product. */
export interface AdjustedPriceResult {
  basePrice: number;
  currency: string;
  adjustedPrice: number;
  appliedRule: PricingAdjustmentRule | null;
  provenanceScore: number;
}

// ── #478 Guardian handover ────────────────────────────────────────────────────

export type GuardianHandoverStatus = 'proposed' | 'accepted' | 'cancelled' | 'completed';

/** A pending guardian handover proposal. */
export interface GuardianHandoverProposal {
  productId: string;
  currentGuardian: string;
  proposedGuardian: string;
  proposedAt: number;
  status: GuardianHandoverStatus;
  /** Nonce used to prevent replay attacks. */
  nonce: number;
}

// ── #476 Event sequence / replay protection ───────────────────────────────────

/** Per-product event sequence state stored in KV. */
export interface ProductEventSequence {
  productId: string;
  /** Monotonically increasing sequence number; next event must use this value. */
  nextSeq: number;
  /** Timestamp of the last accepted event. */
  lastEventAt: number;
}

/** Conflict detected when two clients submit events with the same sequence number. */
export interface EventSequenceConflict {
  productId: string;
  expectedSeq: number;
  receivedSeq: number;
}

// ── #475 Async validation pipeline ───────────────────────────────────────────

export type ValidationStatus = 'pending' | 'passed' | 'failed' | 'skipped';

export interface EventValidationResult {
  eventStableId: string;
  productId: string;
  status: ValidationStatus;
  checks: ValidationCheck[];
  validatedAt?: number;
}

export interface ValidationCheck {
  name: string;
  status: ValidationStatus;
  message?: string;
}

export interface TemplateStage {
  label: string;
  eventType: EventType;
}

export type ActorRole = 'Producer' | 'Processor' | 'Shipper' | 'Retailer' | 'Any';

export interface OwnershipRecord {
  owner: string;
  transferredAt: number;
}

export interface ActorRoleAssignment {
  actor: string;
  role: ActorRole;
}

export interface AuthPolicy {
  threshold: number;
  roles: ActorRoleAssignment[];
}

// ── Lifecycle (#404) ──────────────────────────────────────────────────────────

export type LifecycleStage =
  | 'Registered'
  | 'Harvested'
  | 'Processing'
  | 'Shipping'
  | 'Retail'
  | 'Sold'
  | 'Recalled'
  | 'Deactivated';

// ── Certifications (#428) ─────────────────────────────────────────────────────

export interface Certification {
  id: string;
  productId: string;
  certType: string;
  issuer: string;
  issuedAt: number;
  revoked: boolean;
  revokedAt?: number;
}

// ── Assembly relationships ────────────────────────────────────────────────────

/** Parent-child product assembly relationship. */
export interface ProductAssembly {
  /** ID of the parent (assembled) product. */
  parentId: string;
  /** Ordered list of component product IDs. */
  componentIds: string[];
  /** Address of the actor who registered this assembly. */
  registeredBy: string;
  /** Unix ms timestamp when the assembly was registered. */
  registeredAt: number;
  /** Optional description of the assembly process. */
  description: string;
}

// ── Warranty ──────────────────────────────────────────────────────────────────

export type ClaimStatus = 'Pending' | 'Approved' | 'Rejected' | 'Resolved';

/** Warranty metadata stored on-chain for a product. */
export interface WarrantyInfo {
  /** ID of the product this warranty covers. */
  productId: string;
  /** Warranty duration in seconds from product registration. 0 = lifetime. */
  durationSeconds: number;
  /** Address of the actor who registered the warranty. */
  issuer: string;
  /** Unix ms timestamp when the warranty was registered. */
  issuedAt: number;
  /** Short human-readable warranty terms. */
  terms: string;
  /** Off-chain reference to the full warranty document (IPFS CID, URL, etc.). */
  termsRef: string;
  /** Whether this warranty has been voided. */
  voided: boolean;
  /** Unix ms timestamp when the warranty was voided (0 if not voided). */
  voidedAt: number;
}

/** A warranty claim filed against a product. */
export interface WarrantyClaim {
  /** Stable unique identifier for this claim. */
  claimId: string;
  /** ID of the product the claim is filed against. */
  productId: string;
  /** Address of the claimant. */
  claimant: string;
  /** Unix ms timestamp when the claim was filed. */
  filedAt: number;
  /** Description of the issue. */
  description: string;
  /** Off-chain proof reference (IPFS CID, URL, etc.). */
  proofRef: string;
  /** Current status of the claim. */
  status: ClaimStatus;
  /** Unix ms timestamp when the claim status was last updated. */
  updatedAt: number;
}

// ── Product ───────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  origin: string;
  owner: string;
  timestamp: number;
  active?: boolean;
  authorizedActors: string[];
  ownershipHistory?: OwnershipRecord[];
  /** Unix seconds expiration timestamp. 0 = not set. (#406) */
  expirationTimestamp?: number;
  /** Whether the product has been marked as spoiled. (#406) */
  spoiled?: boolean;
  /** true while an on-chain transaction is in-flight */
  pending?: boolean;
  hazardous?: boolean;
  hazardClassification?: string;
  /** Whether this product has been recalled (#393) */
  recalled?: boolean;
  /** Reason provided when the product was recalled (#393) */
  recallReason?: string;
  /** Ledger timestamp when the product was recalled; 0 if never recalled (#393) */
  recallTimestamp?: number;
  /** Schema version of this record (#392) */
  schemaVersion?: number;
  /** Off-chain image URL stored in product metadata (#112) */
  imageUrl?: string;
  /** Taxonomy category ID (#425) */
  category?: string;
  /** Taxonomy subcategory ID (#425) */
  subcategory?: string;
  /** On-chain certifications attached to this product (#428) */
  certifications?: Certification[];
  /** Number of signatures required for events (0 or 1 = immediate, >1 = multi-sig) */
  requiredSignatures?: number;
  /** Provenance-based pricing metadata (#479) */
  pricing?: ProductPricingMetadata;
  /** Assembly relationship — present if this product is assembled from components. */
  assembly?: ProductAssembly;
  /** Warranty metadata — present if a warranty has been registered. */
  warranty?: WarrantyInfo;
  /** Warranty claims filed against this product. */
  warrantyClaims?: WarrantyClaim[];
}

// ── Batch (#405) ──────────────────────────────────────────────────────────────

export interface Batch {
  id: string;
  name: string;
  owner: string;
  productIds: string[];
  timestamp: number;
  active: boolean;
  status?: ProductStatus;
  authorizedActors: string[];
  ownershipHistory?: OwnershipRecord[];
  lifecycleStage?: LifecycleStage;
  /** true while an on-chain transaction is in-flight (#49) */
  pending?: boolean;
  requiredSignatures?: number;
}

// ── Tracking events ───────────────────────────────────────────────────────────

export interface TrackingEvent {
  productId: string;
  location: string;
  actor: string;
  timestamp: number;
  eventType: EventType;
  metadata: string;
  stableId?: string;
  pending?: boolean;
  /** Whether this event has been archived (excluded from active timeline). */
  archived?: boolean;
  /** Monotonic sequence number for replay protection (#476) */
  seq?: number;
  /** Async validation status for this event (#475) */
  validationStatus?: ValidationStatus;
  /** Schema version of this record (#392) */
  schemaVersion?: number;
  /** SHA-256 commitment hash of the private metadata blob (#391) */
  metadataCommitment?: string;
  /** Whether the metadata for this event is stored privately off-chain (#391) */
  privateMetadata?: boolean;
}

// ── Pending events (#394) ─────────────────────────────────────────────────────

/** Pending event awaiting multi-party approval (#394) */
export interface PendingEvent {
  pendingEventId: number;
  productId: string;
  event: TrackingEvent;
  approvals: string[];
  requiredSignatures: number;
  createdAt: number;
  expiration?: number;
}

// ── Transfer escrow (#396) ────────────────────────────────────────────────────

/** Pending ownership transfer escrow (#396) */
export interface TransferEscrow {
  productId: string;
  currentOwner: string;
  proposedOwner: string;
  requestedAt: number;
  disputed: boolean;
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface EventPage {
  events: TrackingEvent[];
  total: number;
  offset: number;
  limit: number;
  /** Stable deterministic event ID — SHA-256 hex (#386) */
  stableId?: string;
  /** true while an on-chain transaction is in-flight (#49) */
  pending?: boolean;
  /** Schema version of this record (#392) */
  schemaVersion?: number;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotificationType =
  | 'TRACKING_EVENT'
  | 'APPROVAL_PENDING'
  | 'APPROVAL_FINALIZED'
  | 'APPROVAL_REJECTED'
  | 'OWNERSHIP_CHANGED'
  | 'PRODUCT_RECALLED'
  | 'CONTRACT_ERROR';

export interface Notification {
  id: string;
  productId: string;
  productName: string;
  eventType: EventType;
  location: string;
  actor: string;
  timestamp: number;
  read: boolean;
  notificationType: NotificationType;
  message?: string;
}

// ── Misc ──────────────────────────────────────────────────────────────────────

export interface TransactionResult {
  hash: string;
  status: 'success' | 'failed' | 'pending';
  fee: string;
  timestamp: number;
}

export interface ContractError {
  code: number;
  message: string;
}

export interface EventFilter {
  eventType?: EventType | null;
  actor?: string | null;
  fromTimestamp?: number | null;
  toTimestamp?: number | null;
}

export interface Rating {
  id: string;
  productId: string;
  walletAddress: string;
  stars: number;
  comment: string | null;
  timestamp: number;
}

/** An off-chain document anchored on-chain by its SHA-256 hash. (#460) */
export interface DocumentAnchor {
  productId: string;
  label: string;
  /** Hex-encoded SHA-256 digest (64 chars). */
  hash: string;
  anchoredBy: string;
  anchoredAt: number;
}

// ── Archival types ────────────────────────────────────────────────────────────

/** An archived tracking event — removed from the active timeline but retained for audit. */
export interface ArchivedEvent {
  event: TrackingEvent;
  archivedBy: string;
  archivedAt: number;
  reason: string;
}

// ── Certification registry types ──────────────────────────────────────────────

/** A trusted third-party certification issuer registered on-chain. */
export interface CertificationIssuer {
  issuerAddress: string;
  name: string;
  certTypes: string[];
  registeredAt: number;
  active: boolean;
}

/** A certification registry record linking a product to an external certificate. */
export interface CertificationRegistryRecord {
  id: string;
  productId: string;
  issuerAddress: string;
  externalCertId: string;
  certType: string;
  documentHash: string;
  issuedAt: number;
  revoked: boolean;
  revokedAt: number;
}

/** Result of verifying a certification registry record. */
export interface CertificationVerificationResult {
  valid: boolean;
  record: CertificationRegistryRecord;
  issuer?: CertificationIssuer;
}

// ── Auditor registry ──────────────────────────────────────────────────────────

export interface Auditor {
  address: string;
  name: string;
  active: boolean;
  registeredAt: number;
}

// ── Attestations ──────────────────────────────────────────────────────────────

export interface Attestation {
  id: string;
  productId: string;
  /** Event stable ID this attestation targets; empty string = product-level. */
  targetId: string;
  auditor: string;
  attestationType: string;
  signature: string;
  timestamp: number;
  notes?: string;
}

// ── Batch with recall status ──────────────────────────────────────────────────

export interface BatchWithRecall {
  id: string;
  name: string;
  owner: string;
  productIds: string[];
  timestamp: number;
  recalled: boolean;
  recallReason: string;
  recallTimestamp: number;
}

// ── Paginated response ────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

// ── Delegation (#delegation) ──────────────────────────────────────────────────

/** An actor delegation granting a delegatee authority to act on a product. */
export interface Delegation {
  delegationId: number;
  productId: string;
  delegator: string;
  delegatee: string;
  expiresAt: number;
  revoked: boolean;
  createdAt: number;
}

// ── Sustainability metadata ───────────────────────────────────────────────────

/** Sustainability metrics associated with a product or event. */
export interface SustainabilityMetadata {
  /** Carbon footprint in kg CO2 equivalent */
  carbon_footprint?: number;
  /** Certification level: none | bronze | silver | gold | platinum */
  certification_level?: string;
  /** List of sustainable practices applied */
  sustainable_practices?: string[];
  /** Percentage of energy from renewable sources (0–100) */
  renewable_energy_pct?: number;
  /** Whether recyclable packaging is used */
  recyclable_packaging?: boolean;
  // Aliases kept for backwards compatibility
  carbonFootprint?: number;
  energySource?: string;
  recyclable?: boolean;
  certifications?: string[];
  notes?: string;
}

// ── Webhook ───────────────────────────────────────────────────────────────────

/** A registered webhook subscription. */
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  createdAt: number;
}
