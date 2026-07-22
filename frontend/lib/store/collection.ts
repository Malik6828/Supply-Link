/**
 * Repository helper: a small, synchronous CRUD facade over a single KV
 * namespace, backing the migration of ad-hoc module-level `Map`s (Issue #579).
 *
 * ## Why synchronous?
 * Every service migrated in this pass exposes a synchronous public API
 * (`revokeCredential(...)`, `delegationStore.add(...)`, …) and its unit tests
 * call those methods synchronously. To migrate without a breaking API change,
 * `createCollection` mirrors the `Map` semantics it replaces: it reads and
 * writes the shared process-wide in-memory backend directly.
 *
 * ## Namespacing
 * Each collection owns a namespace and stores records under
 * `"<namespace>:<id>"`. Listing is scoped to that prefix, so two collections
 * can never observe or clobber each other's keys.
 *
 * ## Values by reference
 * Records are stored by reference (like the original `Map`s), so a service
 * that mutates a returned object and expects the change to be visible on the
 * next `get` keeps working unchanged. Do not rely on this for cross-process
 * durability — that guarantee comes from the async `KVStore` (Vercel KV) path.
 *
 * ## TTL
 * `set(id, value, ttlSeconds)` accepts an optional TTL. Omitted / `0` means
 * the record never expires, matching the previous `Map` behaviour.
 */

import { memGet, memSet, memDel, memKeysByPrefix } from '@/lib/store/memoryStore';
import { namespaceKey, namespacePrefix } from '@/lib/kv';

export interface Collection<T> {
  /** The namespace this collection is scoped to. */
  readonly namespace: string;
  /** Fetch a record by id, or `null` if absent / expired. */
  get(id: string): T | null;
  /** Store a record under `id`, with an optional TTL in seconds (`0` = none). */
  set(id: string, value: T, ttlSeconds?: number): void;
  /** Delete a record. Returns `true` if it existed. */
  delete(id: string): boolean;
  /** List the ids currently held in this namespace. */
  list(): string[];
  /** Return every live record in this namespace. */
  all(): T[];
  /** Remove every record in this namespace. */
  clear(): void;
}

/**
 * Create a repository collection scoped to `namespace`.
 *
 * @example
 *   const revocations = createCollection<RevocationEntry>('revocation');
 *   revocations.set(entry.id, entry);
 *   revocations.all().filter((e) => !e.superseded);
 */
export function createCollection<T>(namespace: string): Collection<T> {
  const prefix = namespacePrefix(namespace);
  const key = (id: string) => namespaceKey(namespace, id);
  /** Strip the `"<namespace>:"` prefix back to the bare record id. */
  const idOf = (fullKey: string) => fullKey.slice(prefix.length);

  return {
    namespace,
    get(id) {
      return memGet<T>(key(id));
    },
    set(id, value, ttlSeconds = 0) {
      memSet(key(id), value, ttlSeconds);
    },
    delete(id) {
      const existed = memGet<T>(key(id)) !== null;
      memDel(key(id));
      return existed;
    },
    list() {
      return memKeysByPrefix(prefix).map(idOf);
    },
    all() {
      return memKeysByPrefix(prefix)
        .map((fullKey) => memGet<T>(fullKey))
        .filter((v): v is T => v !== null);
    },
    clear() {
      for (const fullKey of memKeysByPrefix(prefix)) {
        memDel(fullKey);
      }
    },
  };
}
