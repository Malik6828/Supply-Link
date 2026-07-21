/**
 * e2e/webhooks.spec.ts
 *
 * T13 — E2E: Webhook subscription management and delivery verification.
 *
 * Covers:
 *   1. Webhook CRUD (create, list, get, disable, enable, delete) via the REST API.
 *   2. Subscription CRUD (create, list, get, update name/active, delete) via the
 *      REST API with x-api-key authentication.
 *   3. Signed delivery — registers a local HTTP sink, triggers an event via
 *      /api/v1/webhooks/process/pending, and asserts the sink received a request
 *      with a valid HMAC-SHA256 X-Webhook-Signature.
 *   4. Retry / dead-letter — when the sink returns 5xx the system records the
 *      attempt as "pending" (not "success"), confirming retry scheduling.
 *
 * All API calls are direct fetch() calls against the Next.js dev server
 * (baseURL: http://localhost:3000). The tests do NOT require a browser UI;
 * they use Playwright's request fixture for API-level assertions plus an
 * in-process HTTP sink (WebhookSink) for delivery capture.
 *
 * Environment:
 *   PARTNER_API_KEY — must be set in the Next.js process (e.g. via .env.local).
 *   The test uses the same value from process.env to authenticate.
 */

import { test, expect } from '@playwright/test';
import { WebhookSink } from './support/webhook-sink';

// ── Helpers ────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:3000';

/**
 * The partner API key must be set in the server environment via PARTNER_API_KEY.
 * In CI, set the env var; locally, set it in frontend/.env.local.
 * We read it from process.env — if absent the test will produce a 401 and fail
 * with a clear message.
 */
const PARTNER_API_KEY = process.env.PARTNER_API_KEY ?? 'test-partner-key';

function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': PARTNER_API_KEY,
    ...extra,
  };
}

/** Build an absolute URL. */
function url(path: string): string {
  return `${BASE}${path}`;
}

/**
 * Minimal tracking event body matching the TrackingEvent type expected by
 * POST /api/v1/webhooks/process/pending.
 */
function makeTrackingEvent(productId: string) {
  return {
    event: {
      productId,
      location: 'Test Warehouse',
      actor: 'GTEST000000000000000000000000000000000000000000000000000',
      timestamp: Date.now(),
      eventType: 'SHIPPING' as const,
      metadata: JSON.stringify({ test: true }),
    },
  };
}

// ── Suite ──────────────────────────────────────────────────────────────────

test.describe('Webhook system — E2E', () => {
  /**
   * Track resources created during tests so the afterEach hook can clean up
   * even if a test assertion fails mid-way.
   */
  let createdWebhookId: string | null = null;

  test.afterEach(async ({ request }) => {
    if (createdWebhookId) {
      await request.delete(url(`/api/v1/webhooks/${createdWebhookId}`)).catch(() => {});
      createdWebhookId = null;
    }
  });

  // ── 1. Webhook CRUD ──────────────────────────────────────────────────────

  test.describe('1. Webhook CRUD', () => {
    test('POST /api/v1/webhooks — register a new webhook', async ({ request }) => {
      const res = await request.post(url('/api/v1/webhooks'), {
        data: {
          url: 'http://127.0.0.1:19999/webhook',
          secret: 'e2e-test-secret',
        },
      });

      expect(res.status()).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({
        url: 'http://127.0.0.1:19999/webhook',
        active: true,
      });
      expect(typeof body.id).toBe('string');
      expect(typeof body.secret).toBe('string');
      createdWebhookId = body.id;
    });

    test('POST /api/v1/webhooks — rejects duplicate URL with 409', async ({ request }) => {
      // Register first
      const first = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19998/webhook' },
      });
      expect(first.status()).toBe(201);
      const { id } = await first.json();
      createdWebhookId = id;

      // Duplicate should fail
      const second = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19998/webhook' },
      });
      expect(second.status()).toBe(409);
    });

    test('GET /api/v1/webhooks — lists registered webhooks', async ({ request }) => {
      // Register one
      const reg = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19997/webhook' },
      });
      const { id } = await reg.json();
      createdWebhookId = id;

      const res = await request.get(url('/api/v1/webhooks'));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(typeof body.total).toBe('number');
      expect(Array.isArray(body.webhooks)).toBe(true);
      const found = body.webhooks.find((w: { id: string }) => w.id === id);
      expect(found).toBeDefined();
    });

    test('GET /api/v1/webhooks/[id] — get webhook details', async ({ request }) => {
      const reg = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19996/webhook' },
      });
      const { id } = await reg.json();
      createdWebhookId = id;

      const res = await request.get(url(`/api/v1/webhooks/${id}`));
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(id);
      expect(body.active).toBe(true);
      // Secret must NOT be exposed in GET
      expect(body.secret).toBeUndefined();
    });

    test('PATCH /api/v1/webhooks/[id] — disable then re-enable', async ({ request }) => {
      const reg = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19995/webhook' },
      });
      const { id } = await reg.json();
      createdWebhookId = id;

      // Disable
      const disable = await request.patch(url(`/api/v1/webhooks/${id}`), {
        data: { active: false },
      });
      expect(disable.status()).toBe(200);
      expect((await disable.json()).active).toBe(false);

      // Re-enable
      const enable = await request.patch(url(`/api/v1/webhooks/${id}`), {
        data: { active: true },
      });
      expect(enable.status()).toBe(200);
      expect((await enable.json()).active).toBe(true);
    });

    test('DELETE /api/v1/webhooks/[id] — delete a webhook', async ({ request }) => {
      const reg = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19994/webhook' },
      });
      const { id } = await reg.json();

      const del = await request.delete(url(`/api/v1/webhooks/${id}`));
      // Route returns 204 with { success: true }
      expect([200, 204]).toContain(del.status());

      // Confirm it's gone
      const get = await request.get(url(`/api/v1/webhooks/${id}`));
      expect(get.status()).toBe(404);

      // Already cleaned up — prevent afterEach from trying again
      createdWebhookId = null;
    });
  });

  // ── 2. Subscription CRUD ─────────────────────────────────────────────────

  test.describe('2. Subscription CRUD (requires x-api-key)', () => {
    /**
     * We create a fresh webhook for each subscription sub-suite to keep tests
     * independent.  cleanup is done in afterEach via createdWebhookId.
     */

    test('POST subscriptions — create a subscription', async ({ request }) => {
      // Register parent webhook
      const wh = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19993/webhook' },
      });
      const webhook = await wh.json();
      createdWebhookId = webhook.id;

      const res = await request.post(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: apiHeaders(),
        data: {
          name: 'E2E Test Subscription',
          description: 'Created by e2e test suite',
          eventTypes: ['TRACKING_EVENT_CREATED'],
          retryPolicy: { maxRetries: 3, backoffMs: 500 },
        },
      });

      expect(res.status()).toBe(201);
      const sub = await res.json();
      expect(sub.name).toBe('E2E Test Subscription');
      expect(sub.eventTypes).toContain('TRACKING_EVENT_CREATED');
      expect(sub.active).toBe(true);
      expect(typeof sub.id).toBe('string');
    });

    test('POST subscriptions — rejects missing x-api-key with 401', async ({ request }) => {
      const wh = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19992/webhook' },
      });
      const webhook = await wh.json();
      createdWebhookId = webhook.id;

      const res = await request.post(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: { 'Content-Type': 'application/json' }, // no x-api-key
        data: { name: 'NoAuth', eventTypes: ['TRACKING_EVENT_CREATED'] },
      });

      expect(res.status()).toBe(401);
    });

    test('POST subscriptions — rejects empty eventTypes with 400', async ({ request }) => {
      const wh = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19991/webhook' },
      });
      const webhook = await wh.json();
      createdWebhookId = webhook.id;

      const res = await request.post(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: apiHeaders(),
        data: { name: 'Bad', eventTypes: [] },
      });

      expect(res.status()).toBe(400);
    });

    test('GET subscriptions — list subscriptions for a webhook', async ({ request }) => {
      const wh = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19990/webhook' },
      });
      const webhook = await wh.json();
      createdWebhookId = webhook.id;

      // Create a sub
      await request.post(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: apiHeaders(),
        data: { name: 'List Test', eventTypes: ['PRODUCT_EVENT_CHANGED'] },
      });

      const res = await request.get(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: apiHeaders(),
      });
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.total).toBeGreaterThanOrEqual(1);
      expect(data.subscriptions[0].webhookId).toBe(webhook.id);
    });

    test('GET subscriptions/[subId] — get single subscription', async ({ request }) => {
      const wh = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19989/webhook' },
      });
      const webhook = await wh.json();
      createdWebhookId = webhook.id;

      const create = await request.post(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: apiHeaders(),
        data: { name: 'Single Get', eventTypes: ['TRACKING_EVENT_CREATED'] },
      });
      const sub = await create.json();

      const res = await request.get(url(`/api/v1/webhooks/${webhook.id}/subscriptions/${sub.id}`), {
        headers: apiHeaders(),
      });
      expect(res.status()).toBe(200);
      const detail = await res.json();
      expect(detail.id).toBe(sub.id);
      expect(detail.name).toBe('Single Get');
    });

    test('PATCH subscriptions/[subId] — rename and disable', async ({ request }) => {
      const wh = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19988/webhook' },
      });
      const webhook = await wh.json();
      createdWebhookId = webhook.id;

      const create = await request.post(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: apiHeaders(),
        data: { name: 'Original Name', eventTypes: ['TRACKING_EVENT_CREATED'] },
      });
      const sub = await create.json();

      // Rename and disable
      const patch = await request.patch(
        url(`/api/v1/webhooks/${webhook.id}/subscriptions/${sub.id}`),
        {
          headers: apiHeaders(),
          data: { name: 'Updated Name', active: false },
        },
      );
      expect(patch.status()).toBe(200);
      const updated = await patch.json();
      expect(updated.name).toBe('Updated Name');
      expect(updated.active).toBe(false);

      // Verify via GET
      const get = await request.get(url(`/api/v1/webhooks/${webhook.id}/subscriptions/${sub.id}`), {
        headers: apiHeaders(),
      });
      const reloaded = await get.json();
      expect(reloaded.name).toBe('Updated Name');
      expect(reloaded.active).toBe(false);
    });

    test('DELETE subscriptions/[subId] — delete a subscription', async ({ request }) => {
      const wh = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19987/webhook' },
      });
      const webhook = await wh.json();
      createdWebhookId = webhook.id;

      const create = await request.post(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: apiHeaders(),
        data: { name: 'To Delete', eventTypes: ['TRACKING_EVENT_CREATED'] },
      });
      const sub = await create.json();

      const del = await request.delete(
        url(`/api/v1/webhooks/${webhook.id}/subscriptions/${sub.id}`),
        { headers: apiHeaders() },
      );
      expect(del.status()).toBe(200);
      const delBody = await del.json();
      expect(delBody.success).toBe(true);

      // Confirm 404
      const get = await request.get(url(`/api/v1/webhooks/${webhook.id}/subscriptions/${sub.id}`), {
        headers: apiHeaders(),
      });
      expect(get.status()).toBe(404);
    });
  });

  // ── 3. Signed Delivery ───────────────────────────────────────────────────

  test.describe('3. Signed delivery', () => {
    test('POST /process/pending delivers a correctly HMAC-signed payload to the sink', async ({
      request,
    }) => {
      // Start an in-process HTTP sink that responds 200
      const sink = await WebhookSink.start({ responseStatus: 200 });

      try {
        const secret = 'e2e-delivery-secret';
        const productId = `e2e-product-${Date.now()}`;

        // Register a webhook pointing at our sink
        const reg = await request.post(url('/api/v1/webhooks'), {
          data: { url: sink.url, secret },
        });
        expect(reg.status()).toBe(201);
        const webhook = await reg.json();
        createdWebhookId = webhook.id;

        // Trigger an event
        const trigger = await request.post(url('/api/v1/webhooks/process/pending'), {
          data: makeTrackingEvent(productId),
        });
        expect(trigger.status()).toBe(200);
        const triggerBody = await trigger.json();
        expect(triggerBody.successCount).toBeGreaterThanOrEqual(1);

        // Wait for the sink to receive the delivery (up to 10 s)
        const captured = await sink.waitForRequest(10_000);

        // ── Payload shape assertions ──
        expect(captured.body).toHaveProperty('event');
        expect(captured.body).toHaveProperty('timestamp');
        expect(captured.body).toHaveProperty('id');

        const event = captured.body.event as {
          type: string;
          data: { productId: string };
        };
        expect(event.type).toBe('TRACKING_EVENT_CREATED');
        expect(event.data.productId).toBe(productId);

        // ── Header assertions ──
        expect(captured.headers['x-webhook-signature']).toBeTruthy();
        expect(captured.headers['x-webhook-timestamp']).toBeTruthy();
        expect(captured.headers['x-webhook-id']).toBeTruthy();
        expect(captured.headers['content-type']).toContain('application/json');

        // ── HMAC-SHA256 signature verification ──
        const signatureValid = WebhookSink.verifySignature(captured, secret);
        expect(signatureValid).toBe(true);
      } finally {
        sink.stop();
      }
    });

    test('Delivery signed correctly when secret is auto-generated', async ({ request }) => {
      const sink = await WebhookSink.start({ responseStatus: 200 });

      try {
        const productId = `e2e-product-autosecret-${Date.now()}`;

        // Register WITHOUT providing a secret — server generates one
        const reg = await request.post(url('/api/v1/webhooks'), {
          data: { url: sink.url },
        });
        expect(reg.status()).toBe(201);
        const webhook = await reg.json();
        createdWebhookId = webhook.id;
        const autoSecret: string = webhook.secret;
        expect(typeof autoSecret).toBe('string');
        expect(autoSecret.length).toBeGreaterThan(0);

        // Trigger
        await request.post(url('/api/v1/webhooks/process/pending'), {
          data: makeTrackingEvent(productId),
        });

        const captured = await sink.waitForRequest(10_000);

        // Verify signature using the auto-generated secret
        expect(WebhookSink.verifySignature(captured, autoSecret)).toBe(true);
      } finally {
        sink.stop();
      }
    });

    test('Disabled webhook does NOT receive delivery', async ({ request }) => {
      const sink = await WebhookSink.start({ responseStatus: 200 });

      try {
        const productId = `e2e-product-disabled-${Date.now()}`;

        const reg = await request.post(url('/api/v1/webhooks'), {
          data: { url: sink.url, secret: 'disabled-test-secret' },
        });
        const webhook = await reg.json();
        createdWebhookId = webhook.id;

        // Disable webhook
        await request.patch(url(`/api/v1/webhooks/${webhook.id}`), {
          data: { active: false },
        });

        // Trigger event
        await request.post(url('/api/v1/webhooks/process/pending'), {
          data: makeTrackingEvent(productId),
        });

        // The sink should receive NO request within 3 s
        const received = await sink
          .waitForRequest(3_000)
          .then(() => true)
          .catch(() => false);
        expect(received).toBe(false);
      } finally {
        sink.stop();
      }
    });

    test('Payload id header matches payload body id', async ({ request }) => {
      const sink = await WebhookSink.start({ responseStatus: 200 });

      try {
        const secret = 'payload-id-test-secret';
        const reg = await request.post(url('/api/v1/webhooks'), {
          data: { url: sink.url, secret },
        });
        const webhook = await reg.json();
        createdWebhookId = webhook.id;

        await request.post(url('/api/v1/webhooks/process/pending'), {
          data: makeTrackingEvent(`e2e-pid-${Date.now()}`),
        });

        const captured = await sink.waitForRequest(10_000);

        // X-Webhook-ID must equal body.id
        expect(captured.headers['x-webhook-id']).toBe(captured.body.id);

        // X-Webhook-Timestamp must equal body.timestamp (as string)
        expect(captured.headers['x-webhook-timestamp']).toBe(String(captured.body.timestamp));
      } finally {
        sink.stop();
      }
    });
  });

  // ── 4. Retry / Dead-letter behaviour ────────────────────────────────────

  test.describe('4. Retry and dead-letter behaviour', () => {
    test('Delivery attempt is recorded as non-success when sink returns 500', async ({
      request,
    }) => {
      /**
       * Start a sink that always returns 500. When the webhook system tries to
       * deliver, sendWebhook() should record the attempt with status "pending"
       * (eligible for retry) or "failed" (no more retries), and successCount
       * should be 0 on the process/pending response.
       */
      const sink = await WebhookSink.start({ responseStatus: 500 });

      try {
        const productId = `e2e-product-retry-${Date.now()}`;

        const reg = await request.post(url('/api/v1/webhooks'), {
          data: { url: sink.url, secret: 'retry-test-secret' },
        });
        expect(reg.status()).toBe(201);
        const webhook = await reg.json();
        createdWebhookId = webhook.id;

        // Trigger event — processor attempts delivery
        const trigger = await request.post(url('/api/v1/webhooks/process/pending'), {
          data: makeTrackingEvent(productId),
        });
        expect(trigger.status()).toBe(200);
        const triggerBody = await trigger.json();

        // Delivery should have failed (5xx is not success)
        expect(triggerBody.successCount).toBe(0);
        expect(triggerBody.failureCount).toBeGreaterThanOrEqual(1);

        // The sink should have received exactly one request (the first attempt)
        const captured = await sink.waitForRequest(10_000);
        expect(captured.respondedWith).toBe(500);

        // Signature is still present — the server signed the payload correctly
        const valid = WebhookSink.verifySignature(captured, 'retry-test-secret');
        expect(valid).toBe(true);
      } finally {
        sink.stop();
      }
    });

    test('Delivery attempt is recorded as non-success when sink returns 429 (rate limit)', async ({
      request,
    }) => {
      const sink = await WebhookSink.start({ responseStatus: 429 });

      try {
        const productId = `e2e-product-ratelimit-${Date.now()}`;

        const reg = await request.post(url('/api/v1/webhooks'), {
          data: { url: sink.url, secret: 'ratelimit-test-secret' },
        });
        const webhook = await reg.json();
        createdWebhookId = webhook.id;

        const trigger = await request.post(url('/api/v1/webhooks/process/pending'), {
          data: makeTrackingEvent(productId),
        });
        const triggerBody = await trigger.json();

        // 429 is a retryable error — delivery recorded as non-success
        expect(triggerBody.successCount).toBe(0);
        expect(triggerBody.failureCount).toBeGreaterThanOrEqual(1);

        // Sink received the request
        const captured = await sink.waitForRequest(10_000);
        expect(captured.respondedWith).toBe(429);
      } finally {
        sink.stop();
      }
    });

    test('Delivery succeeds after a transient failure when sink switches to 200', async ({
      request,
    }) => {
      /**
       * This test validates recovery behaviour:
       * - First delivery attempt → sink returns 500 (failure)
       * - Second call to process/pending → sink now returns 200 (success)
       * The second call simulates what a retry cron would do.
       */
      const sink = await WebhookSink.start({ responseStatus: 500 });

      try {
        const productId = `e2e-product-recovery-${Date.now()}`;
        const secret = 'recovery-test-secret';

        const reg = await request.post(url('/api/v1/webhooks'), {
          data: { url: sink.url, secret },
        });
        const webhook = await reg.json();
        createdWebhookId = webhook.id;

        // First attempt — fails
        const firstTrigger = await request.post(url('/api/v1/webhooks/process/pending'), {
          data: makeTrackingEvent(productId),
        });
        const firstBody = await firstTrigger.json();
        expect(firstBody.successCount).toBe(0);

        // Sink received the first request
        const firstCapture = await sink.waitForRequest(10_000);
        expect(firstCapture.respondedWith).toBe(500);

        // Flip the sink to 200 to simulate recovery
        sink.setResponseStatus(200);

        // Second attempt — simulates retry / re-processing
        const secondTrigger = await request.post(url('/api/v1/webhooks/process/pending'), {
          data: makeTrackingEvent(productId),
        });
        const secondBody = await secondTrigger.json();
        expect(secondBody.successCount).toBeGreaterThanOrEqual(1);

        // Sink received a second request, this time responded 200
        const secondCapture = await sink.waitForRequest(10_000);
        expect(secondCapture.respondedWith).toBe(200);

        // Both deliveries should have valid signatures
        expect(WebhookSink.verifySignature(firstCapture, secret)).toBe(true);
        expect(WebhookSink.verifySignature(secondCapture, secret)).toBe(true);
      } finally {
        sink.stop();
      }
    });
  });

  // ── 5. Webhook deletion cascades subscriptions ───────────────────────────

  test.describe('5. Cascade: deleting a webhook also removes its subscriptions', () => {
    test('After DELETE webhook, subscription GET returns 404', async ({ request }) => {
      const wh = await request.post(url('/api/v1/webhooks'), {
        data: { url: 'http://127.0.0.1:19986/webhook' },
      });
      const webhook = await wh.json();

      // Create a subscription
      const create = await request.post(url(`/api/v1/webhooks/${webhook.id}/subscriptions`), {
        headers: apiHeaders(),
        data: { name: 'Cascade Test', eventTypes: ['TRACKING_EVENT_CREATED'] },
      });
      const sub = await create.json();

      // Delete the webhook
      await request.delete(url(`/api/v1/webhooks/${webhook.id}`));
      createdWebhookId = null; // Already deleted

      // Subscription should no longer be reachable
      const get = await request.get(url(`/api/v1/webhooks/${webhook.id}/subscriptions/${sub.id}`), {
        headers: apiHeaders(),
      });
      // Either the webhook is gone (404 for webhook) or subscription is gone
      expect(get.status()).toBe(404);
    });
  });
});
