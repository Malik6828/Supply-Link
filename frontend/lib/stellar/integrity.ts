/**
 * Event integrity verification for Supply-Link product histories.
 *
 * The smart contract maintains a SHA-256 hash chain over all finalized tracking
 * events for each product (see `get_provenance_root` in the contract). This
 * module lets the frontend re-derive the expected root from a locally-held list
 * of events and compare it against the on-chain value, proving the list has not
 * been tampered with.
 *
 * Hash chain algorithm (matches the contract's `compute_next_provenance_root`):
 *
 *   state_0 = [0x00 × 32]                              (zero root, no events)
 *   state_n = SHA-256(
 *     state_{n-1}              (32 bytes)
 *     SHA-256(event_type UTF-8)(32 bytes)
 *     SHA-256(location UTF-8)  (32 bytes)
 *     SHA-256(metadata UTF-8)  (32 bytes)
 *     SHA-256(product_id UTF-8)(32 bytes)
 *     timestamp                (8 bytes, big-endian u64)
 *     schema_version           (4 bytes, big-endian u32)
 *   )
 *
 * Any insertion, deletion, or field-level modification of a finalized event
 * will change the re-derived root and fail the equality check.
 */

import { Contract, rpc, TransactionBuilder, BASE_FEE, scValToNative } from '@stellar/stellar-sdk';
import { NETWORK_PASSPHRASE, RPC_URL, CONTRACT_ID } from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrackingEventData {
  product_id: string;
  event_type: string;
  location: string;
  metadata: string;
  timestamp: number | bigint;
  schema_version: number;
  actor: string;
}

export interface IntegrityResult {
  valid: boolean;
  onChainRoot: string;
  computedRoot: string;
  eventCount: number;
  error?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const enc = new TextEncoder();

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const buf = (await crypto.subtle.digest('SHA-256', data)) as ArrayBuffer;
  return new Uint8Array(buf);
}

function u64ToBeBytes(value: number | bigint): Uint8Array {
  const n = BigInt(value);
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number((n >> BigInt((7 - i) * 8)) & BigInt(0xff));
  }
  // Write from MSB to LSB
  const be = new Uint8Array(8);
  let tmp = n;
  for (let i = 7; i >= 0; i--) {
    be[i] = Number(tmp & BigInt(0xff));
    tmp >>= BigInt(8);
  }
  return be;
}

function u32ToBeBytes(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function concat(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const buf = new ArrayBuffer(total);
  const out = new Uint8Array(buf);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Core hash chain computation ───────────────────────────────────────────────

/**
 * Compute the provenance root for a list of finalized events, matching the
 * algorithm used by `compute_next_provenance_root` in the smart contract.
 *
 * Starts from a zero root (all bytes 0x00) and chains each event in order.
 *
 * @param events  Ordered list of finalized tracking events (oldest first).
 * @returns       32-byte provenance root as a hex string.
 */
export async function computeProvenanceRoot(events: TrackingEventData[]): Promise<string> {
  let root: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(32)); // zero root

  for (const event of events) {
    const etHash = await sha256Bytes(enc.encode(event.event_type));
    const locHash = await sha256Bytes(enc.encode(event.location));
    const metaHash = await sha256Bytes(enc.encode(event.metadata));
    const pidHash = await sha256Bytes(enc.encode(event.product_id));

    const input = concat(
      root,
      etHash,
      locHash,
      metaHash,
      pidHash,
      u64ToBeBytes(event.timestamp),
      u32ToBeBytes(event.schema_version),
    );

    root = await sha256Bytes(input);
  }

  return toHex(root);
}

// ── Contract read helpers ─────────────────────────────────────────────────────

const server = new rpc.Server(RPC_URL);

async function readContractValue(method: string, args: unknown[], callerAddress: string) {
  const account = await server.getAccount(callerAddress);
  const contract = new Contract(CONTRACT_ID);
  const { nativeToScVal } = await import('@stellar/stellar-sdk');

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args.map((a) => nativeToScVal(a))))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(simulated)) {
    return scValToNative(simulated.result!.retval);
  }
  throw new Error(`Contract read failed for ${method}: ${simulated.error}`);
}

/**
 * Fetch the on-chain provenance root for a product.
 *
 * Returns the root as a lowercase hex string (64 chars). Returns the all-zero
 * string if no events have been finalized yet.
 */
export async function fetchOnChainProvenanceRoot(
  productId: string,
  callerAddress: string,
): Promise<string> {
  const rawRoot = await readContractValue('get_provenance_root', [productId], callerAddress);
  // The contract returns BytesN<32>; scValToNative gives us a Buffer/Uint8Array.
  if (rawRoot instanceof Uint8Array || Buffer.isBuffer(rawRoot)) {
    return toHex(new Uint8Array(rawRoot));
  }
  // Fallback: already a hex string or array-like
  if (typeof rawRoot === 'string') return rawRoot;
  if (Array.isArray(rawRoot)) return toHex(new Uint8Array(rawRoot));
  return '0'.repeat(64);
}

/**
 * Fetch all finalized tracking events for a product.
 */
export async function fetchTrackingEvents(
  productId: string,
  callerAddress: string,
): Promise<TrackingEventData[]> {
  const events = await readContractValue('get_tracking_events', [productId], callerAddress);
  return Array.isArray(events) ? events : [];
}

// ── Public verification API ───────────────────────────────────────────────────

/**
 * Verify the integrity of a product's event history.
 *
 * Fetches both the on-chain events and the on-chain provenance root, then
 * re-derives the expected root from the events. A `valid: true` result means
 * the event list exactly matches what was committed on-chain. Any tampered,
 * reordered, or missing event will produce a `valid: false` result.
 *
 * @param productId      Product identifier.
 * @param callerAddress  Caller's Stellar address (required by the RPC).
 * @returns              IntegrityResult with validity flag and both roots.
 */
export async function verifyProductIntegrity(
  productId: string,
  callerAddress: string,
): Promise<IntegrityResult> {
  try {
    const [events, onChainRoot] = await Promise.all([
      fetchTrackingEvents(productId, callerAddress),
      fetchOnChainProvenanceRoot(productId, callerAddress),
    ]);

    const computedRoot = await computeProvenanceRoot(events);

    return {
      valid: computedRoot === onChainRoot,
      onChainRoot,
      computedRoot,
      eventCount: events.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      onChainRoot: '',
      computedRoot: '',
      eventCount: 0,
      error: msg,
    };
  }
}
