/**
 * Revocation Registry Service.
 *
 * Tracks revoked certificates and attestations. Records are persisted through
 * the shared KV repository (`createCollection`) so they survive across
 * serverless invocations when a KV backend is configured, falling back to the
 * shared in-memory backend in dev/test. In production this would additionally
 * be reconciled with on-chain storage (Soroban contract).
 * The service exposes CRUD helpers and query support used by the UI and
 * verification logic.
 */

import { createCollection } from '@/lib/store';

export type RevocationType = 'certification' | 'attestation' | 'registry_record';

export interface RevocationEntry {
  /** Unique revocation record ID. */
  id: string;
  /** The ID of the certificate / attestation being revoked. */
  subjectId: string;
  /** Human-readable type of the revoked credential. */
  type: RevocationType;
  /** Product this credential was issued for. */
  productId: string;
  /** Address / identifier of the issuer who performed the revocation. */
  revokedBy: string;
  /** Unix ms timestamp of revocation. */
  revokedAt: number;
  /** Optional reason for revocation. */
  reason?: string;
  /** Whether this revocation has been superseded (e.g. re-issued). */
  superseded: boolean;
}

export interface RevocationCheckResult {
  revoked: boolean;
  entry?: RevocationEntry;
}

// ── Persistent store (shared KV repository) ───────────────────────────────────

const revocationStore = createCollection<RevocationEntry>('revocation');

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Record a new revocation. Idempotent — returns existing entry if the
 * subjectId has already been revoked.
 */
export function revokeCredential(params: {
  subjectId: string;
  type: RevocationType;
  productId: string;
  revokedBy: string;
  reason?: string;
}): RevocationEntry {
  // Idempotency: return existing entry if already revoked
  const existing = findBySubjectId(params.subjectId);
  if (existing && !existing.superseded) return existing;

  const id = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: RevocationEntry = {
    id,
    subjectId: params.subjectId,
    type: params.type,
    productId: params.productId,
    revokedBy: params.revokedBy,
    revokedAt: Date.now(),
    reason: params.reason,
    superseded: false,
  };

  revocationStore.set(id, entry);
  return entry;
}

/** Check whether a credential (by subjectId) has been revoked. */
export function checkRevocation(subjectId: string): RevocationCheckResult {
  const entry = findBySubjectId(subjectId);
  if (!entry || entry.superseded) return { revoked: false };
  return { revoked: true, entry };
}

/** List all revocations, optionally filtered by productId or type. */
export function listRevocations(filters?: {
  productId?: string;
  type?: RevocationType;
}): RevocationEntry[] {
  let entries = revocationStore.all().filter((e) => !e.superseded);

  if (filters?.productId) {
    entries = entries.filter((e) => e.productId === filters.productId);
  }
  if (filters?.type) {
    entries = entries.filter((e) => e.type === filters.type);
  }

  return entries.sort((a, b) => b.revokedAt - a.revokedAt);
}

/** Get a single revocation entry by its record ID. */
export function getRevocationById(id: string): RevocationEntry | null {
  return revocationStore.get(id) ?? null;
}

/**
 * Mark a revocation as superseded (e.g. when a new credential is re-issued
 * after the original was revoked in error).
 */
export function supersede(id: string): RevocationEntry | null {
  const entry = revocationStore.get(id);
  if (!entry) return null;
  entry.superseded = true;
  revocationStore.set(id, entry);
  return entry;
}

/** Batch-check multiple subject IDs. Returns a map of subjectId → result. */
export function batchCheckRevocation(subjectIds: string[]): Record<string, RevocationCheckResult> {
  return Object.fromEntries(subjectIds.map((id) => [id, checkRevocation(id)]));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function findBySubjectId(subjectId: string): RevocationEntry | undefined {
  return revocationStore.all().find((e) => e.subjectId === subjectId && !e.superseded);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function getRevocationStats(): {
  total: number;
  certifications: number;
  attestations: number;
  registryRecords: number;
} {
  const active = revocationStore.all().filter((e) => !e.superseded);
  return {
    total: active.length,
    certifications: active.filter((e) => e.type === 'certification').length,
    attestations: active.filter((e) => e.type === 'attestation').length,
    registryRecords: active.filter((e) => e.type === 'registry_record').length,
  };
}
