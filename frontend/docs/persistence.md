# Persistence

## Overview

Server-side services in Supply-Link used to hold state in ad-hoc module-level
`Map`s. Those maps live inside a single Node process, so on a serverless
platform (Vercel) each invocation can land on a different worker with its own
empty map — writes made on one request silently disappear on the next. This
document describes the shared persistence layer that replaces those maps and
the rule for deciding whether a given piece of state belongs in it.

Entry point: **`@/lib/store`** (`frontend/lib/store/`).

## The layers

| Layer                     | File                       | Role                                                                                                                                                                                                          |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared in-memory backend  | `lib/store/memoryStore.ts` | One process-wide map used by both facades in dev/test. TTL-aware. Resets on restart.                                                                                                                          |
| `KVStore` (async)         | `lib/kv.ts`                | `get` / `set` / `del` / `listByPrefix` over serialized strings. Backed by the in-memory backend in dev/test, and by **Vercel KV** (Redis) in production when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set. |
| JSON + key helpers        | `lib/kv.ts`                | `getJSON` / `setJSON` centralize (de)serialization; `namespaceKey` / `namespacePrefix` build collision-free keys.                                                                                             |
| `createCollection` (sync) | `lib/store/collection.ts`  | A synchronous CRUD facade over one namespace — the drop-in replacement for a module-level `Map`.                                                                                                              |

In dev/test both the async `KVStore` and the synchronous collections read and
write the **same** shared backend, so state stays consistent no matter which
facade a service reaches it through, and `__resetStores()` clears all of it at
once between test cases.

## Using `createCollection`

`createCollection<T>(namespace)` returns a `Collection<T>` scoped to a
namespace. Records are stored under `"<namespace>:<id>"`, so collections can
never observe or clobber each other's keys.

```ts
import { createCollection } from '@/lib/store';

interface RevocationEntry {
  id: string;
  productId: string;
  superseded: boolean;
}

const revocations = createCollection<RevocationEntry>('revocation');

revocations.set(entry.id, entry); // create / overwrite
revocations.get(id); // → T | null
revocations.all().filter((e) => !e.superseded);
revocations.list(); // → string[] of ids
revocations.delete(id); // → boolean (existed?)
```

Notes:

- **Return type is `T | null`**, not `T | undefined`. A `Map`-based service
  that previously returned `undefined` should map with `?? undefined` at its
  public boundary if callers depend on that (see `getSavedQuery`).
- **Reference semantics are preserved.** Like the `Map` it replaces, a
  collection stores objects by reference in dev/test, so a service that mutates
  a returned object and expects the change on the next `get` keeps working.
  Prefer immutable updates (`set(id, { ...prev, changed })`) where practical so
  behaviour is identical once a real KV backend serializes writes.
- **TTL is optional**: `set(id, value, ttlSeconds)`. Omitted / `0` means no
  expiry, matching the old `Map` behaviour.

## Caches vs. persistence

Not every module-level map is persistence. Use this rule:

> Persist it if losing it would lose user/business data or break correctness.
> Keep it a plain in-process `Map` if it is a cache of something you can
> recompute or re-fetch, or per-instance protection/observability state whose
> whole point is to be process-local.

### Migrated to `createCollection` (business data that must survive)

| Module                                           | Namespace(s)                                  |
| ------------------------------------------------ | --------------------------------------------- |
| `lib/services/revocationRegistry.ts`             | `revocation`                                  |
| `lib/services/delegationStore.ts`                | `delegation`                                  |
| `lib/services/emergencyAlerts.ts`                | `emergency-alert`                             |
| `lib/services/insuranceCoverage.ts`              | `insurance-coverage`, `insurance-certificate` |
| `lib/services/recallBroadcastService.ts`         | `recall-broadcast`, `recall-notification`     |
| `lib/services/searchService.ts` (`savedQueries`) | `saved-query`                                 |
| `lib/regulator/certifications.ts`                | `regulator-cert`                              |
| `lib/recall/escalation.ts`                       | `recall-escalation`                           |

### Deliberately kept as process-local `Map`s

Each is documented at its declaration. They fall into three groups:

**Recomputable read caches** — a cold cache just re-fetches or recomputes:

- `lib/services/productReadModel.ts` — 60s read-through cache of on-chain data.
- `lib/services/searchService.ts` `resultCache` — 5s memoization of a pure
  computation.
- `lib/services/searchService.ts` `analyticsBuffer` — best-effort telemetry
  ring buffer.

**Function-local computation Maps** — never module-level state, rebuilt on every
call, so there is nothing to persist:

- `lib/services/comparisonService.ts`, `lifecycleGapDetector.ts`,
  `eventTrust.ts`, `certificationChainExplorer.ts`.

**Per-instance protection / observability state** — intentionally ephemeral and
scoped to a single serverless instance; persisting it would be incorrect, not
just wasteful:

- `lib/api/rateLimit.ts` (throttle counters, IP reputation, sliding windows) —
  per-instance rate limiting; a shared/pluggable backend is a separate concern.
- `lib/api/metrics.ts`, `lib/analytics/usageAnalytics.ts` — in-process metrics
  that reset on restart and are flushed to a time-series store in production.
- `lib/api/idempotency.ts` — short-TTL in-memory idempotency cache.
- `lib/api/correlation.ts` — a `WeakMap` keyed by the request object; lives only
  for the request's lifetime and cannot be persisted.

### Already behind the KV abstraction (not ad-hoc Maps)

`lib/jobs/queue.ts` and `lib/indexer/eventIndex.ts` are KV-first: they use
Vercel KV when configured and fall back to an in-memory store for dev/test.
`lib/webhooks/storage.ts` persists to JSON files under `.kiro/webhooks/`. These
already survive across invocations by their own mechanism and are out of scope
for the `Map`-consolidation pass.

## Production configuration

Set both env vars to route the async `KVStore` at Vercel KV:

```
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

When absent (local dev, CI), everything falls back to the shared in-memory
backend automatically — no code change required.

## Testing

Import the test-only reset hook and call it in `beforeEach` to isolate cases
that share a namespace:

```ts
import { __resetStores } from '@/lib/store';

beforeEach(() => __resetStores());
```

`__resetStores()` is a no-op unless `NODE_ENV === 'test'`, so it can never wipe
a real backend if reached from application code.

Infrastructure behaviour is verified in
`frontend/lib/store/__tests__/collection.test.ts` and
`frontend/lib/store/__tests__/kv.test.ts`, covering namespace isolation, prefix
listing, TTL expiry, and a shared keyspace across the async KV and synchronous
collection facades (the cross-invocation persistence guarantee).

Migrated stores keep their own behavioural tests — e.g.
`frontend/__tests__/recallBroadcastService.test.ts` and
`frontend/__tests__/recallEscalation.test.ts` assert that state is read back
from the store rather than from a returned reference.
