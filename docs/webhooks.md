# Webhook Delivery Contract

This document is the source of truth for how Supply-Link delivers webhooks:
signing, headers, retry/backoff schedule, dead-lettering, storage, and the
idempotency guarantees of the processing tick. For endpoint-by-endpoint API
reference and payload shapes, see `docs/webhooks/README.md`.

## Delivery path

All webhook sends — tracking events, product events, alerts, and recall
notifications — go through a single `WebhookDeliverer`
(`frontend/lib/webhooks/delivery.ts`). There is one delivery path in the
system; no route or subsystem sends HTTP requests to subscriber URLs
directly.

```
event source (tracking / product / alert / recall)
        │
        ▼
lib/webhooks/processor.ts   (builds the WebhookPayload)
        │
        ▼
lib/webhooks/delivery.ts    (WebhookDeliverer.deliver / .broadcast)
        │
        ├─ per-webhook CircuitBreaker (lib/resilience.ts)
        ├─ timeout-wrapped HTTP POST (lib/resilience.ts withRetry, 1 attempt/call)
        └─ persists the attempt (lib/webhooks/storage.ts → KVStore)
```

## Storage

Webhooks, subscriptions, and delivery attempts are persisted in the shared
`KVStore` (`frontend/lib/kv.ts` — Vercel KV in production, an in-memory Map in
dev/test), not on local disk. State therefore survives across serverless
invocations.

| Key                                                       | Value                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `webhook:<id>`                                            | `Webhook` record                                                                               |
| `webhook:list`                                            | `string[]` of webhook ids                                                                      |
| `subscription:<id>`                                       | `WebhookSubscription` record                                                                   |
| `subscription:list`                                       | `string[]` of subscription ids                                                                 |
| `webhook:attempt:<webhookId>:<payloadId>:<attemptNumber>` | `WebhookDeliveryAttempt`, including the serialized payload so retries replay the original body |
| `webhook:attempt:pending:list`                            | attempt keys awaiting retry                                                                    |
| `webhook:deadletter:list`                                 | attempt keys that exhausted all retries                                                        |

## Headers

Every delivery POSTs the JSON-serialized `WebhookPayload` with:

| Header                | Description                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| `Content-Type`        | `application/json`                                                              |
| `X-Webhook-Signature` | HMAC-SHA256 of the exact request body, hex-encoded                              |
| `X-Webhook-Timestamp` | `payload.timestamp` (Unix ms)                                                   |
| `X-Webhook-ID`        | `payload.id` — unique per delivery, safe to use for receiver-side deduplication |

## Signature verification

```ts
const expected = createHmac("sha256", webhookSecret)
  .update(JSON.stringify(payload))
  .digest("hex");
// Compare `expected` to the X-Webhook-Signature header using a timing-safe
// comparison (see verifyWebhookSignature in lib/webhooks/delivery.ts).
```

## Retry schedule

- Default max attempts: **5** (`WEBHOOK_MAX_RETRY_ATTEMPTS`), overridable per
  subscription via `retryPolicy.maxRetries`.
- Backoff: exponential starting at **1s**, doubling each attempt, capped at
  **1 hour** (`WEBHOOK_INITIAL_BACKOFF_MS` / `WEBHOOK_MAX_BACKOFF_MS`), with
  ±10% jitter (`WEBHOOK_BACKOFF_JITTER`) to avoid thundering-herd retries.
- Only retryable HTTP status codes trigger a retry: `408, 429, 500, 502, 503,
504`. Other 4xx/5xx responses fail permanently on the first attempt.
- Network errors and timeouts (10s request timeout,
  `WEBHOOK_REQUEST_TIMEOUT_MS`) are always retryable up to the max attempt
  count.
- A per-webhook circuit breaker (`lib/resilience.ts`) opens after
  `WEBHOOK_FAILURE_THRESHOLD` (5) consecutive failures, short-circuiting
  further attempts to that URL for 30s before allowing a half-open probe —
  independent of, and in addition to, the attempt-level retry/backoff above.
- A webhook is auto-deactivated after `WEBHOOK_FAILURE_THRESHOLD` (5)
  consecutive delivery failures.

Retries are **not** performed by blocking inside a single request — each
attempt is one call. A failed-but-retryable attempt is persisted with a
`nextRetryAt`, and the processing tick (below) picks it up once due.

## Dead-lettering

An attempt that fails permanently (non-retryable status, or retries
exhausted) is recorded with `status: 'failed'` and added to
`webhook:deadletter:list`. Dead-letter records are retained for 90 days
(`WEBHOOK_DEADLETTER_TTL_SECONDS`) and readable via
`getDeadLetterDeliveries()` in `lib/webhooks/storage.ts` for operational
inspection — they are not automatically replayed.

## The processing tick: idempotency & concurrency

`POST /api/v1/webhooks/process/pending` (`lib/webhooks/processor.ts` +
`app/api/v1/webhooks/process/pending/route.ts`) is the single entry point for
both (a) broadcasting a new event and (b) draining due retries. It is safe to
call repeatedly and concurrently — by a polling service, a chain-triggered
webhook, or a scheduled cron job:

- **Event broadcast is deduped.** Each call with a body of `{ event }` claims
  a one-time key (`webhook:event:seen:<productId>:<eventType>:<timestamp>`,
  24h TTL) before broadcasting. A duplicate call for the same event is a
  no-op and still returns `success: true`.
- **Retry draining is lock-guarded.** Before draining `webhook:attempt:pending:list`,
  the tick claims a short-lived lock (`webhook:process:tick:lock`, 20s TTL).
  If another invocation already holds it, this call skips the retry pass —
  it does not process the batch twice — while still handling its own `event`
  payload, if any.
- Calling the endpoint with no body at all is a valid no-op-for-events tick
  that only drains due retries.

## Recall alerts

`POST /api/webhooks/recall` (`app/api/webhooks/recall/route.ts`) validates
the recall payload (`productId`, `reason`, `timestamp`) and fans it out via
`notifyWebhooksOfAlert(..., 'RECALL_ALERT_PROPAGATED')` — the same
`WebhookDeliverer`/signing path used for every other event type, so recall
notifications get identical signing, retry, and dead-letter behavior.
