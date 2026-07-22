# TypeScript Fix Tasks

Fixes for TS errors surfaced by the pre-push hook. All changes are in `frontend/`.

---

## Status

| #   | Task                                                                                                                                                                                                         | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1   | Rename `event_type` → `eventType` in fraud `__tests__/*.test.ts`                                                                                                                                             | ✅ Done |
| 2   | Rename `event_type` → `eventType` in `compliance/__tests__/traceabilityScorecard.test.ts`                                                                                                                    | ✅ Done |
| 3   | Fix `lib/stellar/contract-client.ts` index signature conflict                                                                                                                                                | ✅ Done |
| 4   | Fix `lib/stellar/identifier-canonicalization.ts` (Env import, return type, creator field)                                                                                                                    | ✅ Done |
| 5   | Fix `lib/types/index.ts` — expand `SustainabilityMetadata` with snake_case fields used by scorer                                                                                                             | ✅ Done |
| 6   | Fix `lib/provenance/score-management.ts` — add `schema_version` arg, narrow `unknown` result type                                                                                                            | ✅ Done |
| 7   | Fix `__tests__/provenanceScore.test.ts` — add missing `actorReputation` field in test objects                                                                                                                | ✅ Done |
| 8   | Fix misc errors: `utils.test.ts`, `network-config.test.ts`, `secrets.test.ts`, `resilience.test.ts`, `webhooks/subscriptions.test.ts`, `webhooks/webhooks.test.ts`, `vitest.config.ts`, e2e playwright types | ✅ Done |
| 9   | Commit and push all fixes                                                                                                                                                                                    | ✅ Done |

---

## Remaining Work Detail

### Task 7 — `__tests__/provenanceScore.test.ts`

`ProvenanceScoreBreakdown` requires `actorReputation: number` but the two
`getProvenanceScorePercentage(...)` calls at lines ~125 and ~139 pass objects
without it.

**Fix:** add `actorReputation: 0` (or appropriate value) to both call sites.

---

### Task 8 — Misc errors

#### `__tests__/utils.test.ts` (lines 81, 87, 98, 103)

`exportToCSV` / `exportToJSON` return `void` instead of `string`.
Check `lib/utils/export.ts` — functions likely missing `return` statements.

#### `lib/__tests__/network-config.test.ts` + `lib/__tests__/secrets.test.ts`

All errors are: `Property 'NODE_ENV' is missing in type '{...}' but required in type 'ProcessEnv'`.
**Fix:** either make `NODE_ENV` optional in `ProcessEnv`, or add `NODE_ENV: 'test'` to
every test object literal.

#### `lib/__tests__/resilience.test.ts` (line 67)

`'err' is of type 'unknown'`. Add `as Error` cast or narrow with `instanceof Error`.

#### `lib/webhooks/subscriptions.test.ts` + `webhooks.test.ts`

Union-type narrowing issues on `WebhookPayload`. Tests access `.eventType` and
`.details` on a union that includes an alert shape without those fields.
**Fix:** add discriminated union narrowing (`if (payload.event.type === 'TRACKING_EVENT_CREATED')`)
before accessing those fields.

#### `vitest.config.ts` (line 24)

`'lines' does not exist in type '{ provider: "v8" } & CoverageV8Options'`.
**Fix:** remove or rename the `lines` property (use `statements` instead, which v8 supports).

#### `e2e/*.spec.ts` — `Cannot find module '@playwright/test'`

Playwright types not installed or not in scope for the TS project.
**Fix:** add `@playwright/test` to `devDependencies` and ensure `e2e/tsconfig.json`
references it, or add `"@playwright/test"` to `types` in the root `tsconfig.json`.

---

### Task 9 — Commit & push

Group fixes into two commits:

- `fix(tests): rename event_type → eventType and add missing fields in test fixtures`
- `fix(lib): type fixes in contract-client, identifier-canonicalization, score-management, SustainabilityMetadata`

Then push to `origin/feat/e2e-recall-broadcast-test`.
