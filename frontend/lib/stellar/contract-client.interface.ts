import type {
  Product,
  TrackingEvent,
  EventFilter,
  EventPage,
  AuthPolicy,
  Delegation,
  ProductAssembly,
  WarrantyInfo,
  WarrantyClaim,
  ClaimStatus,
} from '@/lib/types';

export interface ContractClientConfig {
  /** Mode switch: if true, uses MockContractClient; if false, uses LiveContractClient */
  useMock?: boolean;
  /** Soroban RPC URL */
  rpcUrl?: string;
  /** Stellar network passphrase */
  networkPassphrase?: string;
  /** Contract ID */
  contractId?: string;
}

export interface ContractClient {
  // ── Product Operations ───────────────────────────────────────────────────
  registerProduct(
    productId: string,
    name: string,
    origin: string,
    owner: string,
    callerAddress: string,
    description?: string,
  ): Promise<string>;

  getProduct(productId: string, callerAddress?: string): Promise<Product | null>;

  listProducts(
    page?: number,
    pageSize?: number,
    callerAddress?: string,
  ): Promise<{ products: Product[]; total: number }>;

  getProductCount(callerAddress?: string): Promise<number>;

  deactivateProduct(productId: string, callerAddress: string): Promise<string>;

  transferOwnership(productId: string, newOwner: string, callerAddress: string): Promise<string>;

  addAuthorizedActor(productId: string, actor: string, callerAddress: string): Promise<string>;

  removeAuthorizedActor(productId: string, actor: string, callerAddress: string): Promise<string>;

  // ── Event Operations & Provenance ─────────────────────────────────────────
  addTrackingEvent(
    productId: string,
    location: string,
    eventType: string,
    metadata: string,
    callerAddress: string,
  ): Promise<string>;

  getTrackingEvents(productId: string, callerAddress?: string): Promise<TrackingEvent[]>;

  fetchEventPage(
    productId: string,
    offset: number,
    limit?: number,
    filter?: EventFilter,
  ): Promise<EventPage>;

  fetchAllEvents(
    productId: string,
    filter?: EventFilter,
    pageSize?: number,
  ): Promise<TrackingEvent[]>;

  fetchProvenancePath(productId: string): Promise<TrackingEvent[]>;

  fetchAuthPolicy(productId: string): Promise<AuthPolicy>;

  getNonce(actor: string, callerAddress?: string): Promise<number>;

  approveEvent(
    productId: string,
    pendingEventId: number,
    approver: string,
    callerAddress: string,
  ): Promise<string>;

  rejectEvent(
    productId: string,
    pendingEventId: number,
    rejector: string,
    reason: string,
    callerAddress: string,
  ): Promise<string>;

  getPendingEvents(productId: string, callerAddress?: string): Promise<unknown[]>;

  getProvenanceRoot(productId: string, callerAddress?: string): Promise<Uint8Array>;

  // ── Governance & Upgrades ─────────────────────────────────────────────────
  registerUpgradeGuardian(guardian: string, callerAddress: string): Promise<string>;

  revokeUpgradeGuardian(guardian: string, callerAddress: string): Promise<string>;

  authorizeContractUpgrade(contractId: string, callerAddress: string): Promise<string>;

  revokeContractUpgrade(contractId: string, callerAddress: string): Promise<string>;

  getUpgradeGuardians(callerAddress?: string): Promise<string[]>;

  getAuthorizedContractUpgrades(callerAddress?: string): Promise<string[]>;

  isContractUpgradeAuthorized(contractId: string, callerAddress?: string): Promise<boolean>;

  validateContractUpgradeTarget(contractId: string, callerAddress?: string): Promise<boolean>;

  // ── Document Hash Anchoring ────────────────────────────────────────────────
  anchorDocumentHash(
    productId: string,
    label: string,
    hash: string,
    callerAddress: string,
  ): Promise<string>;

  verifyDocumentHash(productId: string, hash: string, callerAddress?: string): Promise<boolean>;

  getDocumentAnchors(productId: string, callerAddress?: string): Promise<unknown[]>;

  // ── Event Indexing & Audit Proofs ─────────────────────────────────────────
  listEventsByActor(
    actor: string,
    offset: number,
    limit: number,
    callerAddress?: string,
  ): Promise<string[]>;

  listEventsByLocation(
    location: string,
    offset: number,
    limit: number,
    callerAddress?: string,
  ): Promise<string[]>;

  listEventsByType(
    eventType: string,
    offset: number,
    limit: number,
    callerAddress?: string,
  ): Promise<string[]>;

  getSignerProof(
    eventStableId: string,
    callerAddress?: string,
  ): Promise<{ signer: string; payloadHash: string; timestamp: number } | null>;

  isEventReplayed(stableId: string, callerAddress?: string): Promise<boolean>;

  snapshotProductState(
    productId: string,
    snapshotHash: string,
    callerAddress: string,
  ): Promise<string>;

  getSnapshots(productId: string, callerAddress?: string): Promise<unknown[]>;

  // ── Delegation Operations ─────────────────────────────────────────────────
  delegateActorAuthority(
    productId: string,
    delegatee: string,
    expiresAt: number,
    callerAddress: string,
  ): Promise<string>;

  revokeDelegate(productId: string, delegationId: number, callerAddress: string): Promise<string>;

  getActiveDelegations(productId: string): Promise<Delegation[]>;

  // ── Assembly Operations ───────────────────────────────────────────────────
  registerAssembly(
    parentId: string,
    componentIds: string[],
    description: string,
    callerAddress: string,
  ): Promise<string>;

  getAssembly(parentId: string): Promise<ProductAssembly | null>;

  getParentsOfComponent(componentId: string, candidateParentIds: string[]): Promise<string[]>;

  // ── Warranty Operations ───────────────────────────────────────────────────
  registerWarranty(
    productId: string,
    durationSeconds: number,
    terms: string,
    termsRef: string,
    callerAddress: string,
  ): Promise<string>;

  getWarranty(productId: string): Promise<WarrantyInfo | null>;

  voidWarranty(productId: string, callerAddress: string): Promise<string>;

  isWarrantyActive(productId: string): Promise<boolean>;

  fileWarrantyClaim(
    productId: string,
    claimId: string,
    description: string,
    proofRef: string,
    callerAddress: string,
  ): Promise<string>;

  listWarrantyClaims(productId: string): Promise<WarrantyClaim[]>;

  updateClaimStatus(
    productId: string,
    claimId: string,
    newStatus: ClaimStatus,
    callerAddress: string,
  ): Promise<string>;
}
