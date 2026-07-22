# State layer (`lib/state/`)

Global client state lives in a single [Zustand](https://github.com/pmndrs/zustand) store
(`store.ts`), composed from five slices. Components should almost never read from the
store directly — they should go through a selector in `selectors/`.

## Slices

| Slice             | File                 | Owns                                                                               | Persisted?                                   |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| `WalletSlice`     | `walletSlice.ts`     | Freighter wallet address, XLM balance, network-mismatch flag                       | `walletAddress` only                         |
| `ProductsSlice`   | `productsSlice.ts`   | Normalized product entities, fetch status, pagination                              | no                                           |
| `EventsSlice`     | `eventsSlice.ts`     | Normalized tracking-event entities, fetch status, pagination, selected product     | no                                           |
| `UISlice`         | `uiSlice.ts`         | Search/filter/sort controls, notifications, compare selection, modal/page UI state | `notifications` only                         |
| `OnboardingSlice` | `onboardingSlice.ts` | Onboarding checklist + derived progress                                            | `onboardingCompleted`, `onboardingChecklist` |

Persistence is handled by `zustand/middleware`'s `persist` in `store.ts`; see its
`partialize` for the exact persisted fields. Products/events are intentionally **not**
persisted — they're always re-fetched (see `lib/hooks/useProducts.ts` / `useEvents.ts`).

## Normalized entity storage

`ProductsSlice` and `EventsSlice` store entities keyed by id rather than as flat arrays:

- `productsById: Record<string, Product>` + `productOrder: string[]` (insertion order).
  The key is the product's own `id`.
- `eventsById: Record<string, TrackingEvent>` + `eventOrder: string[]`. `TrackingEvent`
  has no guaranteed unique id (the optional `stableId` isn't populated by every source),
  so events are keyed by `` `${productId}__${timestamp}` `` — see `keys.ts`. This is the
  same pair the slice already used to identify events for optimistic confirm/remove.

This makes single-entity operations (`updateProductOwner`, `confirmOptimisticProduct`,
`confirmOptimisticEvent`, etc.) O(1) instead of scanning the full array. Components
should not read `productsById`/`eventsById`/`*Order` directly — use the selectors below,
which expose plain arrays for display and O(1) lookups where that matters (e.g. compare
view, dashboards).

## Async status

Fetch state used to be two independent fields (`productsLoading: boolean`,
`productsError: string | null`), which allowed invalid combinations (both set at once).
It's now a single discriminated union, `AsyncStatus` (`types.ts`):

```ts
type AsyncStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'success' }
  | { state: 'error'; message: string };
```

`productsStatus` / `eventsStatus` hold this. `productsLastFetched` / `eventsLastFetched`
stay as separate fields — they're cache metadata (when the last _successful_ fetch
happened, for the 60s TTL in `useProducts`/`useEvents`), which is orthogonal to whether a
request is currently in flight.

## Selectors (`selectors/`)

One module per slice (`products.ts`, `events.ts`, `wallet.ts`, `onboarding.ts`, `ui.ts`),
re-exported from `selectors/index.ts`. Each module exports:

- Plain **selector functions** (`state => value`), for use with `useStore(selector)` or
  `useStore(useShallow(selector))` directly.
- **Hook wrappers** (e.g. `useProductsList()`, `useWalletAddress()`, `useProductFilters()`)
  for the common cases — prefer these in components.

Derived/array-producing selectors (`selectProducts`, `selectEvents`,
`selectFilteredProducts`, `selectUnreadNotificationsCount`) are memoized with
`createSelector` (`createSelector.ts`) — a minimal reselect-style cache keyed by
reference-equality of their inputs. Because products/events are normalized, the derived
array is only recomputed when `productsById`/`productOrder` (or the relevant filter/sort
fields) actually change, so a component subscribed via `useProductsList()` does not
re-render when unrelated slices (UI, wallet, onboarding) update.

For parameterized lookups (e.g. "product by id"), use the `make*` factories
(`makeSelectProductById(id)`) or grouped selectors (`selectProductFilters`,
`selectOnboardingSummary`) that bundle several related fields behind one `useShallow`
subscription instead of several separate `useStore` calls.

### Choosing a selector

- Need one primitive field (e.g. `walletAddress`)? Use the dedicated hook
  (`useWalletAddress()`) or `useStore(selectX)` — no `useShallow` needed, since primitive
  equality is enough.
- Need several related fields at once (e.g. search/filter/sort controls)? Use a grouped
  selector with `useShallow` (`useProductFilters()`), so the component only re-renders
  when the _set_ of values actually differs, not just because the store re-created the
  object.
- Need a derived array/object (e.g. filtered products)? Use the memoized `createSelector`-
  based selector so re-renders only happen when the underlying inputs change.
- Need a single entity by id? Use `productsById[id]` / a `make*ById` selector instead of
  `.find()` over the full list.

## Cross-slice interactions

- `walletSlice.disconnect()` resets `productsById`/`productOrder`/`eventsById`/`eventOrder`
  and their pagination/cache fields, in addition to clearing the wallet address — product
  and event data is scoped to the connected wallet.
- `useOnboardingProgress` (in `lib/hooks/`) reads `walletAddress`, `productOrder.length`
  and `eventOrder.length` (via `selectProductCount`/`selectEventCount`) to auto-complete
  onboarding checklist items as the user connects a wallet, registers a product, or logs
  an event.
- `useNotifications` reads `walletAddress` and the products list to poll for new
  on-chain events per product, then writes into `UISlice`'s `notifications`.

## Testing

- `tests/store.test.ts` — slice reducers/actions (wallet, products, events).
- `tests/selectors.test.ts` — selector correctness and memoization (reference stability).
- `tests/render-count.test.tsx` — a broad `useStore()` subscriber vs. a selector
  subscriber, proving the selector subscriber skips re-renders on unrelated state
  changes.
