import {
  Contract,
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
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
import type { ContractClient, ContractClientConfig } from './contract-client.interface';
import { signTransaction, NETWORK_PASSPHRASE, RPC_URL, CONTRACT_ID } from './client';
import { withContractRetry, withContractWriteRetry } from '@/lib/resilience';
import { recordDependency, recordOperation } from '@/lib/api/metrics';
import { normalizeProduct, normalizeTrackingEvent } from './schema';
import { applyFilter } from './mock-contract-client';

interface ContractInvocationParams {
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[];
  callerAddress: string;
}

function toAddressOrScVal(arg: unknown) {
  if (arg instanceof Address) return arg;
  if (typeof arg === 'string' && Address.isValid(arg)) {
    return new Address(arg);
  }
  return nativeToScVal(arg);
}

export class LiveContractClient implements ContractClient {
  private server: rpc.Server;
  private networkPassphrase: string;
  private contractId: string;

  constructor(config?: ContractClientConfig) {
    const url = config?.rpcUrl || RPC_URL;
    this.server = new rpc.Server(url);
    this.networkPassphrase = config?.networkPassphrase || NETWORK_PASSPHRASE;
    this.contractId = config?.contractId || CONTRACT_ID;
  }

  // ── Internal Helpers ───────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildAndSimulate(params: ContractInvocationParams): Promise<any> {
    const account = await this.server.getAccount(
      params.callerAddress || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    );
    const contract = new Contract(this.contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(params.method, ...params.args.map((arg) => toAddressOrScVal(arg))),
      )
      .setTimeout(30)
      .build();

    return this.server.simulateTransaction(tx);
  }

  private async buildSignAndSubmit(params: ContractInvocationParams): Promise<string> {
    const account = await this.server.getAccount(params.callerAddress);
    const contract = new Contract(this.contractId);

    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(params.method, ...params.args.map((arg) => toAddressOrScVal(arg))),
      )
      .setTimeout(30)
      .build();

    const simulated = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationSuccess(simulated)) {
      tx = rpc.assembleTransaction(tx, simulated).build();
    } else {
      throw new Error(`Simulation failed: ${simulated.error}`);
    }

    const signed = await signTransaction(tx.toXDR(), { networkPassphrase: this.networkPassphrase });
    const signedTx = TransactionBuilder.fromXDR(signed.signedTxXdr, this.networkPassphrase);

    const result = await this.server.sendTransaction(signedTx);
    return result.hash;
  }

  private async executeRead<T>(
    method: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any[],
    callerAddress: string = '',
    opName?: string,
    transform?: (val: unknown) => T,
  ): Promise<T> {
    return withContractRetry(async () => {
      const simulated = await this.buildAndSimulate({ method, args, callerAddress });
      if (rpc.Api.isSimulationSuccess(simulated)) {
        recordDependency('soroban-rpc', true);
        if (opName) recordOperation(opName, 'success');
        const raw = scValToNative(simulated.result!.retval);
        return transform ? transform(raw) : (raw as T);
      }
      throw new Error(`Failed to execute read method ${method}: ${simulated.error}`);
    }).catch((err) => {
      recordDependency('soroban-rpc', false);
      if (opName) recordOperation(opName, 'failure');
      throw err;
    });
  }

  private async executeWrite(
    method: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any[],
    callerAddress: string,
    opName?: string,
  ): Promise<string> {
    return withContractWriteRetry(() => this.buildSignAndSubmit({ method, args, callerAddress }))
      .then((hash) => {
        recordDependency('soroban-rpc', true);
        if (opName) recordOperation(opName, 'success');
        return hash;
      })
      .catch((err) => {
        recordDependency('soroban-rpc', false);
        if (opName) recordOperation(opName, 'failure');
        throw err;
      });
  }

  // ── Product Operations ───────────────────────────────────────────────────

  async registerProduct(
    productId: string,
    name: string,
    origin: string,
    owner: string,
    callerAddress: string,
    _description?: string,
  ): Promise<string> {
    return this.executeWrite(
      'register_product',
      [productId, name, origin, owner],
      callerAddress,
      'product.register',
    );
  }

  async getProduct(productId: string, callerAddress: string = ''): Promise<Product | null> {
    return this.executeRead('get_product', [productId], callerAddress, 'product.verify', (raw) =>
      raw ? normalizeProduct(raw) : null,
    );
  }

  async listProducts(
    page: number = 0,
    pageSize: number = 20,
    callerAddress: string = '',
  ): Promise<{ products: Product[]; total: number }> {
    return this.executeRead('list_products', [page, pageSize], callerAddress, undefined, (raw) => {
      const list = Array.isArray(raw) ? raw.map(normalizeProduct) : [];
      return { products: list, total: list.length };
    });
  }

  async getProductCount(callerAddress: string = ''): Promise<number> {
    return this.executeRead('get_product_count', [], callerAddress, undefined, (raw) =>
      Number(raw ?? 0),
    );
  }

  async deactivateProduct(productId: string, callerAddress: string): Promise<string> {
    return this.executeWrite('deactivate_product', [productId], callerAddress);
  }

  async transferOwnership(
    productId: string,
    newOwner: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite('transfer_ownership', [productId, newOwner], callerAddress);
  }

  async addAuthorizedActor(
    productId: string,
    actor: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite('add_authorized_actor', [productId, actor], callerAddress);
  }

  async removeAuthorizedActor(
    productId: string,
    actor: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite('remove_authorized_actor', [productId, actor], callerAddress);
  }

  // ── Event Operations & Provenance ─────────────────────────────────────────

  async addTrackingEvent(
    productId: string,
    location: string,
    eventType: string,
    metadata: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite(
      'add_tracking_event',
      [productId, location, eventType, metadata],
      callerAddress,
      'event.create',
    );
  }

  async getTrackingEvents(productId: string, callerAddress: string = ''): Promise<TrackingEvent[]> {
    return this.executeRead(
      'get_tracking_events',
      [productId],
      callerAddress,
      'event.fetch',
      (raw) => (Array.isArray(raw) ? raw.map(normalizeTrackingEvent) : []),
    );
  }

  async fetchEventPage(
    productId: string,
    offset: number,
    limit: number = 20,
    filter?: EventFilter,
  ): Promise<EventPage> {
    const all = await this.getTrackingEvents(productId);
    const total = all.length;
    const rawPage = all.slice(offset, offset + limit);
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

  async fetchAuthPolicy(productId: string): Promise<AuthPolicy> {
    return this.executeRead('get_authorization_policy', [productId], '', undefined, (raw) => {
      if (typeof raw === 'object' && raw !== null) {
        const r = raw as Record<string, unknown>;
        return {
          threshold: typeof r.threshold === 'number' ? r.threshold : 1,
          roles: Array.isArray(r.roles) ? r.roles.map(String) : [],
        };
      }
      return { threshold: 1, roles: [] };
    });
  }

  async getNonce(actor: string, callerAddress: string = ''): Promise<number> {
    return this.executeRead('get_nonce', [actor], callerAddress, undefined, (raw) =>
      Number(raw ?? 0),
    );
  }

  async approveEvent(
    productId: string,
    pendingEventId: number,
    approver: string,
    callerAddress: string,
  ): Promise<string> {
    const nonce = await this.getNonce(approver, callerAddress);
    return this.executeWrite(
      'approve_event',
      [productId, pendingEventId, approver, nonce],
      callerAddress,
    );
  }

  async rejectEvent(
    productId: string,
    pendingEventId: number,
    rejector: string,
    reason: string,
    callerAddress: string,
  ): Promise<string> {
    const nonce = await this.getNonce(rejector, callerAddress);
    return this.executeWrite(
      'reject_event',
      [productId, pendingEventId, rejector, reason, nonce],
      callerAddress,
    );
  }

  async getPendingEvents(productId: string, callerAddress: string = ''): Promise<unknown[]> {
    return this.executeRead('get_pending_events', [productId], callerAddress, undefined, (raw) =>
      Array.isArray(raw) ? raw : [],
    );
  }

  async getProvenanceRoot(productId: string, callerAddress: string = ''): Promise<Uint8Array> {
    return this.executeRead('get_provenance_root', [productId], callerAddress, undefined, (raw) => {
      if (raw instanceof Uint8Array) return raw;
      if (Buffer.isBuffer(raw)) return new Uint8Array(raw);
      if (Array.isArray(raw)) return new Uint8Array(raw);
      return new Uint8Array(32);
    });
  }

  // ── Governance & Upgrades ─────────────────────────────────────────────────

  async registerUpgradeGuardian(guardian: string, callerAddress: string): Promise<string> {
    return this.executeWrite('register_upgrade_guardian', [guardian], callerAddress);
  }

  async revokeUpgradeGuardian(guardian: string, callerAddress: string): Promise<string> {
    return this.executeWrite('revoke_upgrade_guardian', [guardian], callerAddress);
  }

  async authorizeContractUpgrade(contractId: string, callerAddress: string): Promise<string> {
    return this.executeWrite('authorize_contract_upgrade', [contractId], callerAddress);
  }

  async revokeContractUpgrade(contractId: string, callerAddress: string): Promise<string> {
    return this.executeWrite('revoke_contract_upgrade', [contractId], callerAddress);
  }

  async getUpgradeGuardians(callerAddress: string = ''): Promise<string[]> {
    return this.executeRead('get_upgrade_guardians', [], callerAddress, undefined, (raw) =>
      Array.isArray(raw) ? raw.map(String) : [],
    );
  }

  async getAuthorizedContractUpgrades(callerAddress: string = ''): Promise<string[]> {
    return this.executeRead(
      'get_authorized_contract_upgrades',
      [],
      callerAddress,
      undefined,
      (raw) => (Array.isArray(raw) ? raw.map(String) : []),
    );
  }

  async isContractUpgradeAuthorized(
    contractId: string,
    callerAddress: string = '',
  ): Promise<boolean> {
    return this.executeRead(
      'is_contract_upgrade_authorized',
      [contractId],
      callerAddress,
      undefined,
      (raw) => Boolean(raw),
    );
  }

  async validateContractUpgradeTarget(
    contractId: string,
    callerAddress: string = '',
  ): Promise<boolean> {
    return this.isContractUpgradeAuthorized(contractId, callerAddress);
  }

  // ── Document Hash Anchoring ────────────────────────────────────────────────

  async anchorDocumentHash(
    productId: string,
    label: string,
    hash: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite(
      'anchor_document_hash',
      [productId, label, hash, callerAddress],
      callerAddress,
      'document.anchor',
    );
  }

  async verifyDocumentHash(
    productId: string,
    hash: string,
    callerAddress: string = '',
  ): Promise<boolean> {
    return this.executeRead(
      'verify_document_hash',
      [productId, hash],
      callerAddress,
      undefined,
      (raw) => Boolean(raw),
    );
  }

  async getDocumentAnchors(productId: string, callerAddress: string = ''): Promise<unknown[]> {
    return this.executeRead('get_document_anchors', [productId], callerAddress, undefined, (raw) =>
      Array.isArray(raw) ? raw : [],
    );
  }

  // ── Event Indexing & Audit Proofs ─────────────────────────────────────────

  async listEventsByActor(
    actor: string,
    offset: number,
    limit: number,
    callerAddress: string = '',
  ): Promise<string[]> {
    return this.executeRead(
      'list_events_by_actor',
      [actor, offset, limit],
      callerAddress,
      undefined,
      (raw) => (Array.isArray(raw) ? raw.map(String) : []),
    );
  }

  async listEventsByLocation(
    location: string,
    offset: number,
    limit: number,
    callerAddress: string = '',
  ): Promise<string[]> {
    return this.executeRead(
      'list_events_by_location',
      [location, offset, limit],
      callerAddress,
      undefined,
      (raw) => (Array.isArray(raw) ? raw.map(String) : []),
    );
  }

  async listEventsByType(
    eventType: string,
    offset: number,
    limit: number,
    callerAddress: string = '',
  ): Promise<string[]> {
    return this.executeRead(
      'list_events_by_type',
      [eventType, offset, limit],
      callerAddress,
      undefined,
      (raw) => (Array.isArray(raw) ? raw.map(String) : []),
    );
  }

  async getSignerProof(
    eventStableId: string,
    callerAddress: string = '',
  ): Promise<{ signer: string; payloadHash: string; timestamp: number } | null> {
    return this.executeRead(
      'get_signer_proof',
      [eventStableId],
      callerAddress,
      undefined,
      (raw) => {
        if (!raw) return null;
        const r = raw as Record<string, unknown>;
        return {
          signer: String(r['signer'] ?? ''),
          payloadHash: String(r['payload_hash'] ?? r['payloadHash'] ?? ''),
          timestamp: Number(r['timestamp'] ?? 0),
        };
      },
    );
  }

  async isEventReplayed(stableId: string, callerAddress: string = ''): Promise<boolean> {
    return this.executeRead('is_event_replayed', [stableId], callerAddress, undefined, (raw) =>
      Boolean(raw),
    );
  }

  async snapshotProductState(
    productId: string,
    snapshotHash: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite(
      'snapshot_product_state',
      [productId, snapshotHash],
      callerAddress,
      'snapshot.create',
    );
  }

  async getSnapshots(productId: string, callerAddress: string = ''): Promise<unknown[]> {
    return this.executeRead('get_snapshots', [productId], callerAddress, undefined, (raw) =>
      Array.isArray(raw) ? raw : [],
    );
  }

  // ── Delegation Operations ─────────────────────────────────────────────────

  async delegateActorAuthority(
    productId: string,
    delegatee: string,
    expiresAt: number,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite(
      'delegate_actor_authority',
      [productId, delegatee, expiresAt],
      callerAddress,
    );
  }

  async revokeDelegate(
    productId: string,
    delegationId: number,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite('revoke_delegate', [productId, delegationId], callerAddress);
  }

  async getActiveDelegations(productId: string): Promise<Delegation[]> {
    return this.executeRead('get_active_delegations', [productId], '', undefined, (raw) =>
      Array.isArray(raw) ? (raw as Delegation[]) : [],
    );
  }

  // ── Assembly Operations ───────────────────────────────────────────────────

  async registerAssembly(
    parentId: string,
    componentIds: string[],
    description: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite(
      'register_assembly',
      [parentId, componentIds, description],
      callerAddress,
    );
  }

  async getAssembly(parentId: string): Promise<ProductAssembly | null> {
    return this.executeRead('get_assembly', [parentId], '', undefined, (raw) =>
      raw ? (raw as ProductAssembly) : null,
    );
  }

  async getParentsOfComponent(
    componentId: string,
    candidateParentIds: string[],
  ): Promise<string[]> {
    return this.executeRead(
      'get_parents_of_component',
      [componentId, candidateParentIds],
      '',
      undefined,
      (raw) => (Array.isArray(raw) ? raw.map(String) : []),
    );
  }

  // ── Warranty Operations ───────────────────────────────────────────────────

  async registerWarranty(
    productId: string,
    durationSeconds: number,
    terms: string,
    termsRef: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite(
      'register_warranty',
      [productId, durationSeconds, terms, termsRef],
      callerAddress,
    );
  }

  async getWarranty(productId: string): Promise<WarrantyInfo | null> {
    return this.executeRead('get_warranty', [productId], '', undefined, (raw) =>
      raw ? (raw as WarrantyInfo) : null,
    );
  }

  async voidWarranty(productId: string, callerAddress: string): Promise<string> {
    return this.executeWrite('void_warranty', [productId], callerAddress);
  }

  async isWarrantyActive(productId: string): Promise<boolean> {
    return this.executeRead('is_warranty_active', [productId], '', undefined, (raw) =>
      Boolean(raw),
    );
  }

  async fileWarrantyClaim(
    productId: string,
    claimId: string,
    description: string,
    proofRef: string,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite(
      'file_warranty_claim',
      [productId, claimId, description, proofRef],
      callerAddress,
    );
  }

  async listWarrantyClaims(productId: string): Promise<WarrantyClaim[]> {
    return this.executeRead('list_warranty_claims', [productId], '', undefined, (raw) =>
      Array.isArray(raw) ? (raw as WarrantyClaim[]) : [],
    );
  }

  async updateClaimStatus(
    productId: string,
    claimId: string,
    newStatus: ClaimStatus,
    callerAddress: string,
  ): Promise<string> {
    return this.executeWrite('update_claim_status', [productId, claimId, newStatus], callerAddress);
  }
}
