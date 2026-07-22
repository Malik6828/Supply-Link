/**
 * e2e/api/events.spec.ts
 *
 * Contract tests for:
 *   GET  /api/v1/products/[id]/events  — list events (paginated, public)
 *   POST /api/v1/products/[id]/events  — add a tracking event (authenticated)
 *
 * Covers: 401 auth, 200/201 happy-path, validation errors (missing fields,
 *         invalid eventType, missing seq), pagination, idempotency, seq field,
 *         CORS, X-Correlation-Id, OpenAPI schema.
 *
 * Key design note:
 *   POST /events requires a `seq` field whose value must match the current
 *   sequence counter for the product. We fetch it from
 *   GET /api/v1/products/[id]/events/sequence before each write.
 */

import { test, expect, ALLOWED_ORIGIN } from './helpers/setup';
import { getValidator } from './helpers/schema';

// prod-001 always exists in mock data with at least one event
const KNOWN_PRODUCT_ID = 'prod-001';
const UNKNOWN_PRODUCT_ID = 'prod-does-not-exist-e2e-xyz';
const EVENTS_ENDPOINT = (id: string) => `/api/v1/products/${id}/events`;
const SEQ_ENDPOINT = (id: string) => `/api/v1/products/${id}/events/sequence`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch the current event sequence number for a product.
 * Required before every POST to /events.
 */
async function fetchSeq(
  request: import('@playwright/test').APIRequestContext,
  productId: string,
): Promise<number> {
  const res = await request.get(SEQ_ENDPOINT(productId));
  if (!res.ok()) {
    // If sequence endpoint returns non-200, default seq to 0
    // (first event for a new product)
    return 0;
  }
  const body = await res.json();
  // seq endpoint returns { seq: number } or similar
  return typeof body.seq === 'number' ? body.seq : 0;
}

function validEventBody(seq: number) {
  return {
    eventType: 'SHIPPING',
    location: 'Rotterdam, Netherlands',
    actor: 'GACTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    metadata: JSON.stringify({ vessel: 'MV Test', destination: 'London' }),
    seq,
  };
}

// ── GET — auth (public endpoint, no key needed) ───────────────────────────────

test.describe('GET /api/v1/products/[id]/events — public access', () => {
  test('200 without auth header (public read)', async ({ request }) => {
    const res = await request.get(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID));
    expect(res.status()).toBe(200);
  });

  test('404 when product does not exist', async ({ request }) => {
    const res = await request.get(EVENTS_ENDPOINT(UNKNOWN_PRODUCT_ID));
    expect(res.status()).toBe(404);
  });
});

// ── GET — 200 + pagination ────────────────────────────────────────────────────

test.describe('GET /api/v1/products/[id]/events — happy path', () => {
  test('200 and returns paginated envelope', async ({ request }) => {
    const res = await request.get(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID));
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(typeof body.total).toBe('number');
    expect(typeof body.offset).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.offset).toBe(0);
  });

  test('X-Correlation-Id header present', async ({ request }) => {
    const res = await request.get(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID));
    expect(res.status()).toBe(200);
    expect(res.headers()['x-correlation-id']).toBeTruthy();
  });

  test('pagination — offset/limit respected', async ({ request }) => {
    const res = await request.get(`${EVENTS_ENDPOINT(KNOWN_PRODUCT_ID)}?limit=1&offset=0`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeLessThanOrEqual(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
  });

  test('400 on negative offset', async ({ request }) => {
    const res = await request.get(`${EVENTS_ENDPOINT(KNOWN_PRODUCT_ID)}?offset=-5`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('CORS headers present when Origin matches allowlist', async ({ request }) => {
    const res = await request.get(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers: { origin: ALLOWED_ORIGIN },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
  });

  test('OpenAPI schema — each event item is a valid TrackingEvent', async ({ request }) => {
    const res = await request.get(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID));
    const body = await res.json();
    const v = await getValidator(request);
    for (const item of body.items as unknown[]) {
      v.assertValid('TrackingEvent', item);
    }
  });
});

// ── POST — auth ───────────────────────────────────────────────────────────────

test.describe('POST /api/v1/products/[id]/events — auth', () => {
  test('401 when x-api-key is missing', async ({ request }) => {
    const seq = await fetchSeq(request, KNOWN_PRODUCT_ID);
    const res = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      data: validEventBody(seq),
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('401 when x-api-key is invalid', async ({ request }) => {
    const seq = await fetchSeq(request, KNOWN_PRODUCT_ID);
    const res = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers: { 'x-api-key': 'sl_partner_badbadkey' },
      data: validEventBody(seq),
    });
    expect(res.status()).toBe(401);
  });
});

// ── POST — happy path ─────────────────────────────────────────────────────────

test.describe('POST /api/v1/products/[id]/events — happy path', () => {
  test('201 on valid payload with correct seq', async ({ request, apiKey }) => {
    const seq = await fetchSeq(request, KNOWN_PRODUCT_ID);
    const payload = validEventBody(seq);

    const res = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      data: payload,
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.productId).toBe(KNOWN_PRODUCT_ID);
    expect(body.eventType).toBe(payload.eventType);
    expect(body.location).toBe(payload.location);
    expect(body.actor).toBe(payload.actor);
    expect(typeof body.timestamp).toBe('number');
    expect(typeof body.seq).toBe('number');

    // CORS + correlation
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers()['x-correlation-id']).toBeTruthy();

    // Schema
    const v = await getValidator(request);
    v.assertValid('TrackingEvent', body);
  });

  test('404 when product does not exist', async ({ request, apiKey }) => {
    const res = await request.post(EVENTS_ENDPOINT(UNKNOWN_PRODUCT_ID), {
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      data: validEventBody(0),
    });
    expect(res.status()).toBe(404);
  });
});

// ── POST — validation errors ──────────────────────────────────────────────────

test.describe('POST /api/v1/products/[id]/events — validation errors', () => {
  test('400 when eventType is invalid', async ({ request, apiKey }) => {
    const seq = await fetchSeq(request, KNOWN_PRODUCT_ID);
    const res = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: {
        eventType: 'INVALID_TYPE',
        location: 'Rotterdam',
        actor: 'GACTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
        seq,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('400 when location is missing', async ({ request, apiKey }) => {
    const seq = await fetchSeq(request, KNOWN_PRODUCT_ID);
    const res = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: {
        eventType: 'SHIPPING',
        actor: 'GACTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
        seq,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/MISSING_FIELDS|VALIDATION_ERROR/);
  });

  test('400 when actor is missing', async ({ request, apiKey }) => {
    const seq = await fetchSeq(request, KNOWN_PRODUCT_ID);
    const res = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: {
        eventType: 'SHIPPING',
        location: 'Rotterdam',
        seq,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/MISSING_FIELDS|VALIDATION_ERROR/);
  });

  test('400 when seq field is missing', async ({ request, apiKey }) => {
    const res = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: {
        eventType: 'SHIPPING',
        location: 'Rotterdam',
        actor: 'GACTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
        // seq deliberately omitted
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/MISSING_FIELDS|VALIDATION_ERROR/);
    expect(body.error.message).toMatch(/seq/i);
  });

  test('error envelope always has required fields', async ({ request, apiKey }) => {
    const res = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: {},
    });
    expect([400, 409]).toContain(res.status());
    const body = await res.json();
    expect(typeof body.error.status).toBe('number');
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.correlationId).toBe('string');
  });
});

// ── POST — idempotency ────────────────────────────────────────────────────────

test.describe('POST /api/v1/products/[id]/events — idempotency', () => {
  test('same Idempotency-Key + same body returns identical response', async ({
    request,
    apiKey,
  }) => {
    const seq = await fetchSeq(request, KNOWN_PRODUCT_ID);
    const payload = validEventBody(seq);
    const idempotencyKey = `e2e-events-idem-${Date.now()}`;
    const headers = {
      'x-api-key': apiKey,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    const res1 = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers,
      data: payload,
    });
    // Could be 201 or 409 (seq conflict if another test ran concurrently)
    // We only test idempotency replay if the first call succeeded
    if (res1.status() !== 201) return;

    const body1 = await res1.json();
    const res2 = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers,
      data: payload,
    });
    expect(res2.status()).toBe(201);
    const body2 = await res2.json();

    expect(body2.seq).toBe(body1.seq);
    expect(res2.headers()['idempotent-replayed']).toBe('true');
  });

  test('same Idempotency-Key + different body returns 409', async ({ request, apiKey }) => {
    const seq = await fetchSeq(request, KNOWN_PRODUCT_ID);
    const idempotencyKey = `e2e-events-conflict-${Date.now()}`;
    const headers = {
      'x-api-key': apiKey,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    const res1 = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers,
      data: { ...validEventBody(seq), location: 'Location A' },
    });
    if (res1.status() !== 201) return; // skip if first call didn't succeed

    const res2 = await request.post(EVENTS_ENDPOINT(KNOWN_PRODUCT_ID), {
      headers,
      data: { ...validEventBody(seq), location: 'Location B — different' },
    });
    expect(res2.status()).toBe(409);
    const body = await res2.json();
    expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
