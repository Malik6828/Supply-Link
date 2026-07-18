/**
 * Shared in-memory backend for the persistence layer.
 *
 * A single process-wide store instance is used by BOTH the in-memory
 * `KVStore` implementation (see `lib/kv.ts`) and the synchronous repository
 * helper (`createCollection`, see `lib/store/collection.ts`). Sharing one
 * instance keeps dev/test state consistent no matter which entry point a
 * given service reaches it through, and lets `__resetStores()` clear
 * everything at once between test cases.
 *
 * Entries hold opaque values: `KVStore` writes serialized strings, while
 * repository collections write objects by reference (preserving the exact
 * semantics of the module-level `Map`s they replace). Keys are always
 * fully-qualified / namespace-prefixed, so the two facades never collide.
 *
 * This backend is process-scoped and resets on restart. It is the dev/test
 * default only — production persistence is served by Vercel KV via `KVStore`.
 */

interface MemEntry {
  value: unknown;
  /** Unix ms after which the entry is considered expired. `Infinity` = no expiry. */
  expiresAt: number;
}

/** The single shared map. Keys are fully-qualified (namespace-prefixed). */
const store = new Map<string, MemEntry>();

/** Read a live entry, transparently evicting it if it has expired. */
export function memGet<T = unknown>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

/**
 * Write an entry.
 * @param ttlSeconds Seconds until expiry; `0` or omitted means no expiry.
 */
export function memSet(key: string, value: unknown, ttlSeconds = 0): void {
  const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Infinity;
  store.set(key, { value, expiresAt });
}

/** Delete a single entry. */
export function memDel(key: string): void {
  store.delete(key);
}

/**
 * Return the live (non-expired) keys that start with `prefix`.
 * Expired keys are evicted as they are encountered.
 */
export function memKeysByPrefix(prefix: string): string[] {
  const now = Date.now();
  const keys: string[] = [];
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) {
      store.delete(key);
      continue;
    }
    if (key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/**
 * Clear the entire backend.
 *
 * Intended for tests only — callers should go through `__resetStores()`
 * (see `lib/store/index.ts`), which is a no-op outside `NODE_ENV==='test'`.
 */
export function memClear(): void {
  store.clear();
}
