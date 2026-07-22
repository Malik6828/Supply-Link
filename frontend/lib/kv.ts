/**
 * KV store abstraction.
 * - Dev / test: in-memory Map (process-scoped, resets on restart)
 * - Production: Vercel KV (Redis-backed, set via KV_REST_API_URL + KV_REST_API_TOKEN)
 */

import { memGet, memSet, memDel, memKeysByPrefix } from '@/lib/store/memoryStore';

export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * List the keys currently stored under `prefix`.
   *
   * On Vercel KV this is backed by a `SCAN MATCH <prefix>*`; on the in-memory
   * backend it filters the shared map. Used by the repository helper to
   * implement namespaced `list()` / `all()`.
   */
  listByPrefix(prefix: string): Promise<string[]>;
}

// ── In-memory (dev) ──────────────────────────────────────────────────────────
// Delegates to the shared process-wide backend so the async KVStore and the
// synchronous repository collections observe the same state in dev/test.

const inMemoryKV: KVStore = {
  async get(key) {
    return memGet<string>(key);
  },
  async set(key, value, ttlSeconds) {
    memSet(key, value, ttlSeconds);
  },
  async del(key) {
    memDel(key);
  },
  async listByPrefix(prefix) {
    return memKeysByPrefix(prefix);
  },
};

// ── Vercel KV (prod) ─────────────────────────────────────────────────────────

function makeVercelKV(): KVStore {
  // Lazy import so the package is only required when env vars are present.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { kv } = require('@vercel/kv') as typeof import('@vercel/kv');
  return {
    async get(key) {
      return kv.get<string>(key);
    },
    async set(key, value, ttlSeconds) {
      await kv.set(key, value, { ex: ttlSeconds });
    },
    async del(key) {
      await kv.del(key);
    },
    async listByPrefix(prefix) {
      const keys: string[] = [];
      let cursor = 0;
      // SCAN in batches until the cursor wraps back to 0.
      do {
        const [next, batch] = await kv.scan(cursor, { match: `${prefix}*` });
        keys.push(...batch);
        cursor = typeof next === 'string' ? Number(next) : next;
      } while (cursor !== 0);
      return keys;
    },
  };
}

// ── Export the right implementation ──────────────────────────────────────────

export const kvStore: KVStore =
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN ? makeVercelKV() : inMemoryKV;

// ── Typed JSON helpers ───────────────────────────────────────────────────────
// Thin wrappers that centralize (de)serialization so every service stops
// hand-rolling `JSON.parse` / `JSON.stringify` around `kvStore`.

/** No-expiry sentinel for `setJSON` — Vercel KV interprets a 0 TTL as "no expiry". */
const NO_TTL_SECONDS = 0;

/** Read and parse a JSON value. Returns `null` when the key is absent. */
export async function getJSON<T>(key: string): Promise<T | null> {
  const raw = await kvStore.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

/** Serialize and store a JSON value with an optional TTL (seconds). */
export async function setJSON<T>(
  key: string,
  value: T,
  ttlSeconds: number = NO_TTL_SECONDS,
): Promise<void> {
  await kvStore.set(key, JSON.stringify(value), ttlSeconds);
}

/** List the keys currently stored under `prefix`. */
export async function listByPrefix(prefix: string): Promise<string[]> {
  return kvStore.listByPrefix(prefix);
}

// ── Namespaced key builders ──────────────────────────────────────────────────

/** Separator between a namespace and the record id in a KV key. */
export const NAMESPACE_SEPARATOR = ':';

/**
 * Build a fully-qualified key for `id` within `namespace`
 * (e.g. `namespaceKey('revocation', 'rev-1')` → `"revocation:rev-1"`).
 */
export function namespaceKey(namespace: string, id: string): string {
  return `${namespace}${NAMESPACE_SEPARATOR}${id}`;
}

/**
 * Build the key prefix that matches every record in `namespace`
 * (e.g. `namespacePrefix('revocation')` → `"revocation:"`).
 */
export function namespacePrefix(namespace: string): string {
  return `${namespace}${NAMESPACE_SEPARATOR}`;
}
