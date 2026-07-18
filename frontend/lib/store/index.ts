/**
 * Persistence layer entry point (Issue #579).
 *
 * Re-exports the repository helper and the KV JSON/namespace utilities so
 * services can import everything from `@/lib/store`, and exposes a test-only
 * reset hook.
 *
 * See `docs/persistence.md` for the full pattern and guidance on when to use
 * persistent storage vs. an in-process cache.
 */

import { memClear } from '@/lib/store/memoryStore';

export { createCollection } from '@/lib/store/collection';
export type { Collection } from '@/lib/store/collection';
export { kvStore, getJSON, setJSON, listByPrefix, namespaceKey, namespacePrefix } from '@/lib/kv';
export type { KVStore } from '@/lib/kv';

/**
 * Clear all in-memory persistence state.
 *
 * Test-only: a no-op unless `NODE_ENV === 'test'`, so it can never wipe a
 * real backend if accidentally called from application code. Use it in
 * `beforeEach` to isolate cases that share a collection namespace.
 */
export function __resetStores(): void {
  if (process.env.NODE_ENV !== 'test') return;
  memClear();
}
