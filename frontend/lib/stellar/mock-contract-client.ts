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
import { MOCK_EVENTS, MOCK_PRODUCTS } from '@/lib/mock/products';
import type { ContractClient } from './contract-client.interface';
import { normalizeProduct, normalizeTrackingEvent } from './schema';

export function applyFilter(events: TrackingEvent[], filter?: EventFilter): TrackingEvent[] {
  if (!filter) return events;

  return events.filter((e) => {
    if (filter.eventType && e.eventType !== filter.eventType) return false;
    if (filter.actor && e.actor.toLowerCase() !== filter.actor.toLowerCase()) return false;
    if (filter.fromTimestamp && e.timestamp < filter.fromTimestamp) return false;
    if (filter.toTimestamp && e.timestamp > filter.toTimestamp) return false;
    return true;
  });
}

export class MockContractClient implements ContractClient {
  private products: Map<string, Product> = new Map();
  private events: Map<string, TrackingEvent[]> = new Map();
  private nonces: Map<string, number> = new Map();
  private guardians: Set<string> = new Set();
  private authorizedUpgrades: Set<string> = new Set();
  private documentAnchors: Map<string, Array<{ label: string; hash: string; timestamp: number }>> =
    new Map();
  private snapshots: Map<string, Array<{ snapshotHash: string; timestamp: number }>> = new Map();
  private delegations: Map<string, Delegation[]> = new Map();
  private assemblies: Map<string, ProductAssembly> = new Map();
  private warranties: Map<string, WarrantyInfo> = new Map();
  private claims: Map<string, WarrantyClaim[]> = new Map();

  constructor() {
    // Seed initial mock data
    for (const p of MOCK_PRODUCTS) {
      this.products.set(p.id, normalizeProduct(p));
    }

    const groupedEvents = new Map<string, TrackingEvent[]>();
    for (const e of MOCK_EVENTS) {
      const normalized = normalizeTrackingEvent(e);
      const list = groupedEvents.get(normalized.productId) || [];
      list.push(normalized);
      groupedEvents.set(normalized.productId, list);
    }

    for (const [pid, list] of groupedEvents.entries()) {
      this.events.set(pid, list);
    }
  }

  // ── Product Operations ───────────────────────────────────────────────────

  async registerProduct(
    productId: string,
    name: string,
    origin: string,
    owner: string,
    _callerAddress: string,
    _description?: string,
  ): Promise<string> {
    const newProduct: Product = {
      id: productId,
      name,
      origin,
      owner,
      timestamp: Date.now(),
      active: true,
      authorizedActors: [owner],
      recalled: false,
      recallReason: '',
      recallTimestamp: 0,
      schemaVersion: 1,
    };
    this.products.set(productId, newProduct);
    return `mock_tx_register_${productId}_${Date.now()}`;
  }

  async getProduct(productId: string, _callerAddress?: string): Promise<Product | null> {
    return this.products.get(productId) ?? null;
  }

  async listProducts(
    page: number = 0,
    pageSize: number = 20,
    _callerAddress?: string,
  ): Promise<{ products: Product[]; total: number }> {
    const all = Array.from(this.products.values());
    const total = all.length;
    const offset = page * pageSize;
    const products = all.slice(offset, offset + pageSize);
    return { products, total };
  }

  async getProductCount(_callerAddress?: string): Promise<number> {
    return this.products.size;
  }

  async deactivateProduct(productId: string, _callerAddress: string): Promise<string> {
    const product = this.products.get(productId);
    if (product) {
      product.active = false;
      this.products.set(productId, product);
    }
    return `mock_tx_deactivate_${productId}_${Date.now()}`;
  }

  async transferOwnership(
    productId: string,
    newOwner: string,
    _callerAddress: string,
  ): Promise<string> {
    const product = this.products.get(productId);
    if (product) {
      product.owner = newOwner;
      this.products.set(productId, product);
    }
    return `mock_tx_transfer_${productId}_${Date.now()}`;
  }

  async addAuthorizedActor(
    productId: string,
    actor: string,
    _callerAddress: string,
  ): Promise<string> {
    const product = this.products.get(productId);
    if (product) {
      if (!product.authorizedActors.includes(actor)) {
        product.authorizedActors.push(actor);
      }
    }
    return `mock_tx_add_actor_${productId}_${Date.now()}`;
  }

  async removeAuthorizedActor(
    productId: string,
    actor: string,
    _callerAddress: string,
  ): Promise<string> {
    const product = this.products.get(productId);
    if (product) {
      product.authorizedActors = product.authorizedActors.filter((a) => a !== actor);
    }
    return `mock_tx_remove_actor_${productId}_${Date.now()}`;
  }

  // ── Event Operations & Provenance ─────────────────────────────────────────

  async addTrackingEvent(
    productId: string,
    location: string,
    eventType: string,
    metadata: string,
    callerAddress: string,
  ): Promise<string> {
    const event: TrackingEvent = {
      productId,
      location,
      actor: callerAddress,
      timestamp: Date.now(),
      eventType: eventType as TrackingEvent['eventType'],
      metadata,
      schemaVersion: 1,
    };
    const list = this.events.get(productId) || [];
    list.push(event);
    this.events.set(productId, list);
    return `mock_tx_event_${productId}_${Date.now()}`;
  }

  async getTrackingEvents(productId: string, _callerAddress?: string): Promise<TrackingEvent[]> {
    return this.events.get(productId) || [];
  }

  async fetchEventPage(
    productId: string,
    offset: number,
    limit: number = 20,
    filter?: EventFilter,
  ): Promise<EventPage> {
    const allForProduct = this.events.get(productId) || [];
    const total = allForProduct.length;
    const rawPage = allForProduct.slice(offset, offset + limit);
    const filtered = applyFilter(rawPage, filter);

    return { events: filtered, total, offset, limit };
  }

  async fetchAllEvents(
    productId: string,
    filter?: EventFilter,
    pageSize: number = 20,
  ): Promise<TrackingEvent[]> {
    const first = await this.fetchEventPage(productId, 0, pageSize, filter);
    const total = first.total;
    const results: TrackingEvent[] = [...first.events];

    for (let offset = pageSize; offset < total; offset += pageSize) {
      const page = await this.fetchEventPage(productId, offset, pageSize, filter);
      results.push(...page.events);
    }

    return results;
  }

  async fetchProvenancePath(productId: string): Promise<TrackingEvent[]> {
    const events = await this.fetchAllEvents(productId);
    return [...events].sort((a, b) => a.timestamp - b.timestamp);
  }

  async fetchAuthPolicy(_productId: string): Promise<AuthPolicy> {
    return { threshold: 1, roles: [] };
  }

  async getNonce(actor: string, _callerAddress?: string): Promise<number> {
    return this.nonces.get(actor) || 0;
  }

  async approveEvent(
    productId: string,
    _pendingEventId: number,
    approver: string,
    _callerAddress: string,
  ): Promise<string> {
    const nonce = (this.nonces.get(approver) || 0) + 1;
    this.nonces.set(approver, nonce);
    return `mock_tx_approve_${productId}_${Date.now()}`;
  }

  async rejectEvent(
    productId: string,
    _pendingEventId: number,
    rejector: string,
    _reason: string,
    _callerAddress: string,
  ): Promise<string> {
    const nonce = (this.nonces.get(rejector) || 0) + 1;
    this.nonces.set(rejector, nonce);
    return `mock_tx_reject_${productId}_${Date.now()}`;
  }

  async getPendingEvents(_productId: string, _callerAddress?: string): Promise<unknown[]> {
    return [];
  }

  async getProvenanceRoot(productId: string, _callerAddress?: string): Promise<Uint8Array> {
    const root = new Uint8Array(32);
    for (let i = 0; i < 32; i++) root[i] = (productId.charCodeAt(i % productId.length) || 0) % 256;
    return root;
  }

  // ── Governance & Upgrades ─────────────────────────────────────────────────

  async registerUpgradeGuardian(guardian: string, _callerAddress: string): Promise<string> {
    this.guardians.add(guardian);
    return `mock_tx_register_guardian_${Date.now()}`;
  }

  async revokeUpgradeGuardian(guardian: string, _callerAddress: string): Promise<string> {
    this.guardians.delete(guardian);
    return `mock_tx_revoke_guardian_${Date.now()}`;
  }

  async authorizeContractUpgrade(contractId: string, _callerAddress: string): Promise<string> {
    this.authorizedUpgrades.add(contractId);
    return `mock_tx_authorize_upgrade_${Date.now()}`;
  }

  async revokeContractUpgrade(contractId: string, _callerAddress: string): Promise<string> {
    this.authorizedUpgrades.delete(contractId);
    return `mock_tx_revoke_upgrade_${Date.now()}`;
  }

  async getUpgradeGuardians(_callerAddress?: string): Promise<string[]> {
    return Array.from(this.guardians);
  }

  async getAuthorizedContractUpgrades(_callerAddress?: string): Promise<string[]> {
    return Array.from(this.authorizedUpgrades);
  }

  async isContractUpgradeAuthorized(contractId: string, _callerAddress?: string): Promise<boolean> {
    return this.authorizedUpgrades.has(contractId);
  }

  async validateContractUpgradeTarget(
    contractId: string,
    callerAddress?: string,
  ): Promise<boolean> {
    return this.isContractUpgradeAuthorized(contractId, callerAddress);
  }

  // ── Document Hash Anchoring ────────────────────────────────────────────────

  async anchorDocumentHash(
    productId: string,
    label: string,
    hash: string,
    _callerAddress: string,
  ): Promise<string> {
    const list = this.documentAnchors.get(productId) || [];
    list.push({ label, hash, timestamp: Date.now() });
    this.documentAnchors.set(productId, list);
    return `mock_tx_anchor_${productId}_${Date.now()}`;
  }

  async verifyDocumentHash(
    productId: string,
    hash: string,
    _callerAddress?: string,
  ): Promise<boolean> {
    const list = this.documentAnchors.get(productId) || [];
    return list.some((item) => item.hash === hash);
  }

  async getDocumentAnchors(productId: string, _callerAddress?: string): Promise<unknown[]> {
    return this.documentAnchors.get(productId) || [];
  }

  // ── Event Indexing & Audit Proofs ─────────────────────────────────────────

  async listEventsByActor(
    actor: string,
    offset: number,
    limit: number,
    _callerAddress?: string,
  ): Promise<string[]> {
    const matches: string[] = [];
    for (const list of this.events.values()) {
      for (const e of list) {
        if (e.actor.toLowerCase() === actor.toLowerCase()) {
          matches.push(e.productId);
        }
      }
    }
    return matches.slice(offset, offset + limit);
  }

  async listEventsByLocation(
    location: string,
    offset: number,
    limit: number,
    _callerAddress?: string,
  ): Promise<string[]> {
    const matches: string[] = [];
    for (const list of this.events.values()) {
      for (const e of list) {
        if (e.location.toLowerCase() === location.toLowerCase()) {
          matches.push(e.productId);
        }
      }
    }
    return matches.slice(offset, offset + limit);
  }

  async listEventsByType(
    eventType: string,
    offset: number,
    limit: number,
    _callerAddress?: string,
  ): Promise<string[]> {
    const matches: string[] = [];
    for (const list of this.events.values()) {
      for (const e of list) {
        if (e.eventType === eventType) {
          matches.push(e.productId);
        }
      }
    }
    return matches.slice(offset, offset + limit);
  }

  async getSignerProof(
    eventStableId: string,
    _callerAddress?: string,
  ): Promise<{ signer: string; payloadHash: string; timestamp: number } | null> {
    return {
      signer: 'GAB...MOCK_SIGNER',
      payloadHash: `0x${eventStableId}`,
      timestamp: Date.now(),
    };
  }

  async isEventReplayed(_stableId: string, _callerAddress?: string): Promise<boolean> {
    return false;
  }

  async snapshotProductState(
    productId: string,
    snapshotHash: string,
    _callerAddress: string,
  ): Promise<string> {
    const list = this.snapshots.get(productId) || [];
    list.push({ snapshotHash, timestamp: Date.now() });
    this.snapshots.set(productId, list);
    return `mock_tx_snapshot_${productId}_${Date.now()}`;
  }

  async getSnapshots(productId: string, _callerAddress?: string): Promise<unknown[]> {
    return this.snapshots.get(productId) || [];
  }

  // ── Delegation Operations ─────────────────────────────────────────────────

  async delegateActorAuthority(
    productId: string,
    delegatee: string,
    expiresAt: number,
    callerAddress: string,
  ): Promise<string> {
    const list = this.delegations.get(productId) || [];
    const newDelegation: Delegation = {
      id: list.length + 1,
      delegator: callerAddress,
      delegatee,
      expiresAt,
      active: true,
    };
    list.push(newDelegation);
    this.delegations.set(productId, list);
    return `mock_tx_delegate_${productId}_${Date.now()}`;
  }

  async revokeDelegate(
    productId: string,
    delegationId: number,
    _callerAddress: string,
  ): Promise<string> {
    const list = this.delegations.get(productId) || [];
    const item = list.find((d) => d.id === delegationId);
    if (item) item.active = false;
    return `mock_tx_revoke_delegate_${productId}_${Date.now()}`;
  }

  async getActiveDelegations(productId: string): Promise<Delegation[]> {
    const list = this.delegations.get(productId) || [];
    const now = Date.now();
    return list.filter((d) => d.active && d.expiresAt > now);
  }

  // ── Assembly Operations ───────────────────────────────────────────────────

  async registerAssembly(
    parentId: string,
    componentIds: string[],
    description: string,
    _callerAddress: string,
  ): Promise<string> {
    const assembly: ProductAssembly = {
      parentId,
      componentIds,
      createdAt: Date.now(),
      description,
    };
    this.assemblies.set(parentId, assembly);
    return `mock_tx_assembly_${parentId}_${Date.now()}`;
  }

  async getAssembly(parentId: string): Promise<ProductAssembly | null> {
    return this.assemblies.get(parentId) ?? null;
  }

  async getParentsOfComponent(
    componentId: string,
    candidateParentIds: string[],
  ): Promise<string[]> {
    const parents: string[] = [];
    for (const pid of candidateParentIds) {
      const ass = this.assemblies.get(pid);
      if (ass && ass.componentIds.includes(componentId)) {
        parents.push(pid);
      }
    }
    return parents;
  }

  // ── Warranty Operations ───────────────────────────────────────────────────

  async registerWarranty(
    productId: string,
    durationSeconds: number,
    terms: string,
    termsRef: string,
    _callerAddress: string,
  ): Promise<string> {
    const now = Date.now();
    const warranty: WarrantyInfo = {
      productId,
      durationSeconds,
      terms,
      termsRef,
      createdAt: now,
      expiresAt: now + durationSeconds * 1000,
      active: true,
      voided: false,
    };
    this.warranties.set(productId, warranty);
    return `mock_tx_warranty_${productId}_${Date.now()}`;
  }

  async getWarranty(productId: string): Promise<WarrantyInfo | null> {
    return this.warranties.get(productId) ?? null;
  }

  async voidWarranty(productId: string, _callerAddress: string): Promise<string> {
    const warranty = this.warranties.get(productId);
    if (warranty) {
      warranty.voided = true;
      warranty.active = false;
    }
    return `mock_tx_void_warranty_${productId}_${Date.now()}`;
  }

  async isWarrantyActive(productId: string): Promise<boolean> {
    const warranty = this.warranties.get(productId);
    if (!warranty) return false;
    return warranty.active && !warranty.voided && warranty.expiresAt > Date.now();
  }

  async fileWarrantyClaim(
    productId: string,
    claimId: string,
    description: string,
    proofRef: string,
    callerAddress: string,
  ): Promise<string> {
    const list = this.claims.get(productId) || [];
    const claim: WarrantyClaim = {
      claimId,
      productId,
      claimant: callerAddress,
      description,
      proofRef,
      createdAt: Date.now(),
      status: 'PENDING',
    };
    list.push(claim);
    this.claims.set(productId, list);
    return `mock_tx_claim_${claimId}_${Date.now()}`;
  }

  async listWarrantyClaims(productId: string): Promise<WarrantyClaim[]> {
    return this.claims.get(productId) || [];
  }

  async updateClaimStatus(
    productId: string,
    claimId: string,
    newStatus: ClaimStatus,
    _callerAddress: string,
  ): Promise<string> {
    const list = this.claims.get(productId) || [];
    const claim = list.find((c) => c.claimId === claimId);
    if (claim) {
      claim.status = newStatus;
    }
    return `mock_tx_claim_status_${claimId}_${Date.now()}`;
  }
}
