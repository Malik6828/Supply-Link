/**
 * e2e/api/products.spec.ts
 *
 * Contract tests for:
 *   GET  /api/v1/products  — list products (paginated)
 *   POST /api/v1/products  — register a product
 *
 * Covers: 401 auth, 200/201 happy-path, validation errors, pagination,
 *         idempotency, CORS headers, X-Correlation-Id, OpenAPI schema.
 */

import { test, expect, ALLOWED_ORIGIN } from './helpers/setup';
import { getValidator } from './helpers/schema';

const ENDPOINT = '/api/v1/products';

// ── Helpers ───────────────────────────────────────────────────────────────────

function validProductBody(suffix = Date.now().toString(36)) {
  return {
    name: `E2E Coffee ${suffix}`,
    origin: 'Ethiopia',
    owner: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

test.describe('GET /api/v1/products — auth', () => {
  test('401 when x-api-key header is missing', async ({ request }) => {
    const res = await request.get(ENDPOINT);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.correlationId).toBeTruthy();
  });

  test('401 when x-api-key is invalid', async ({ request }) => {
    const res = await request.get(ENDPOINT, {
      headers: { 'x-api-key': 'sl_partner_invalid000' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

test.describe('POST /api/v1/products — auth', () => {
  test('401 when x-api-key header is missing', async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      data: validProductBody(),
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ── GET 200 + pagination ──────────────────────────────────────────────────────

test.describe('GET /api/v1/products — happy path', () => {
  test('200 with valid key and returns paginated list', async ({ request, apiKey }) => {
    const res = await request.get(ENDPOINT, {
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // Pagination envelope
    expect(typeof body.total).toBe('number');
    expect(typeof body.offset).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.offset).toBe(0);
    expect(body.limit).toBeLessThanOrEqual(100);
  });

  test('X-Correlation-Id header is present', async ({ request, apiKey }) => {
    const res = await request.get(ENDPOINT, {
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['x-correlation-id']).toBeTruthy();
  });

  test('pagination — offset/limit slice is respected', async ({ request, apiKey }) => {
    // Get total first
    const allRes = await request.get(ENDPOINT, {
      headers: { 'x-api-key': apiKey },
    });
    const allBody = await allRes.json();
    const total: number = allBody.total;

    // Request only 1 item
    const res = await request.get(`${ENDPOINT}?limit=1&offset=0`, {
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeLessThanOrEqual(1);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
    expect(body.total).toBe(total);
  });

  test('pagination — offset beyond total returns empty items array', async ({
    request,
    apiKey,
  }) => {
    const res = await request.get(`${ENDPOINT}?offset=999999&limit=10`, {
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(0);
    expect(body.offset).toBe(999999);
  });

  test('400 on invalid offset (negative)', async ({ request, apiKey }) => {
    const res = await request.get(`${ENDPOINT}?offset=-1`, {
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('OpenAPI schema — list response items are valid Product shapes', async ({
    request,
    apiKey,
  }) => {
    const res = await request.get(ENDPOINT, {
      headers: { 'x-api-key': apiKey },
    });
    const body = await res.json();
    const v = await getValidator(request);
    for (const item of body.items as unknown[]) {
      v.assertValid('Product', item);
    }
  });
});

// ── CORS ──────────────────────────────────────────────────────────────────────

test.describe('GET /api/v1/products — CORS', () => {
  test('CORS headers present when Origin matches allowlist', async ({ request, apiKey }) => {
    const res = await request.get(ENDPOINT, {
      headers: {
        'x-api-key': apiKey,
        origin: ALLOWED_ORIGIN,
      },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers()['vary']).toContain('Origin');
  });

  test('No CORS headers when Origin is not in allowlist', async ({ request, apiKey }) => {
    const res = await request.get(ENDPOINT, {
      headers: {
        'x-api-key': apiKey,
        origin: 'https://evil.example.com',
      },
    });
    // Request still succeeds but no ACAO header
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });
});

// ── POST 201 + validation ─────────────────────────────────────────────────────

test.describe('POST /api/v1/products — happy path', () => {
  test('201 on valid payload and response matches Product schema', async ({ request, apiKey }) => {
    const payload = validProductBody();
    const res = await request.post(ENDPOINT, {
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      data: payload,
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(typeof body.id).toBe('string');
    expect(body.name).toBe(payload.name);
    expect(body.origin).toBe(payload.origin);
    expect(body.owner).toBe(payload.owner);
    expect(typeof body.timestamp).toBe('number');

    // CORS on POST response
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

    // Correlation ID
    expect(res.headers()['x-correlation-id']).toBeTruthy();

    // Schema
    const v = await getValidator(request);
    v.assertValid('Product', body);
  });
});

test.describe('POST /api/v1/products — validation errors', () => {
  test('400 when name is missing', async ({ request, apiKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: { origin: 'Ethiopia', owner: 'GABC...' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/MISSING_FIELDS|VALIDATION_ERROR/);
  });

  test('400 when origin is missing', async ({ request, apiKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: { name: 'Test', owner: 'GABC...' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/MISSING_FIELDS|VALIDATION_ERROR/);
  });

  test('400 when owner is missing', async ({ request, apiKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: { name: 'Test', origin: 'Ethiopia' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/MISSING_FIELDS|VALIDATION_ERROR/);
  });

  test('400 on invalid JSON body', async ({ request, apiKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: 'not-json{{{{',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/INVALID_PAYLOAD|INVALID_JSON/);
  });

  test('400 when authorizedActors contains non-strings', async ({ request, apiKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: {
        name: 'Test',
        origin: 'Ethiopia',
        owner: 'GABC...',
        authorizedActors: [1, 2, 3],
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('error envelope always contains status, code, message, correlationId', async ({
    request,
    apiKey,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(typeof body.error.status).toBe('number');
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.correlationId).toBe('string');
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

test.describe('POST /api/v1/products — idempotency', () => {
  test('same Idempotency-Key + same body returns identical response', async ({
    request,
    apiKey,
  }) => {
    const idempotencyKey = `e2e-products-idem-${Date.now()}`;
    const payload = validProductBody(`idem-${Date.now()}`);
    const headers = {
      'x-api-key': apiKey,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    const res1 = await request.post(ENDPOINT, { headers, data: payload });
    expect(res1.status()).toBe(201);
    const body1 = await res1.json();

    const res2 = await request.post(ENDPOINT, { headers, data: payload });
    expect(res2.status()).toBe(201);
    const body2 = await res2.json();

    // Same product ID must be returned on replay
    expect(body2.id).toBe(body1.id);
    // Replay header should be set
    expect(res2.headers()['idempotent-replayed']).toBe('true');
  });

  test('same Idempotency-Key + different body returns 409', async ({ request, apiKey }) => {
    const idempotencyKey = `e2e-products-conflict-${Date.now()}`;
    const headers = {
      'x-api-key': apiKey,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    await request.post(ENDPOINT, {
      headers,
      data: validProductBody('conflict-v1'),
    });

    const res = await request.post(ENDPOINT, {
      headers,
      data: validProductBody('conflict-v2'),
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
