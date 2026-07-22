/**
 * Shared delegation store.
 *
 * Persistence is backed by the shared KV repository (`createCollection`) so
 * records survive across serverless invocations when a KV backend is
 * configured, and fall back to the shared in-memory backend in dev/test.
 * In production, point `KV_REST_API_URL` / `KV_REST_API_TOKEN` at Vercel KV.
 */

import type { Delegation } from '@/lib/types';
import { createCollection } from '@/lib/store';

/** Delegations are grouped per product, so each record is a `Delegation[]`. */
const store = createCollection<Delegation[]>('delegation');

export const delegationStore = {
  list(productId: string): Delegation[] {
    return store.get(productId) ?? [];
  },
  add(delegation: Delegation): void {
    const existing = store.get(delegation.productId) ?? [];
    store.set(delegation.productId, [...existing, delegation]);
  },
  revoke(productId: string, delegationId: number): Delegation | null {
    const delegations = store.get(productId);
    if (!delegations) return null;
    const idx = delegations.findIndex((d) => d.delegationId === delegationId);
    if (idx === -1) return null;
    delegations[idx] = { ...delegations[idx], revoked: true };
    store.set(productId, delegations);
    return delegations[idx];
  },
  /** Clear all entries — for testing only. */
  _clear(): void {
    store.clear();
  },
};
