/**
 * e2e/api/products-id.spec.ts
 *
 * Contract tests for:
 *   GET /api/v1/products/[id]
 *
 * This endpoint is public-read (no auth required).
 * Covers: 200 with known id, 404 with unknown id, CORS, X-Correlation-Id, schema.
 *
 * Assumption: mock data always contains prod-001 (see lib/mock/products.ts).
 */

import { test, expect, ALLOWED_ORIGIN } from './helpers/setup';
import { getValidator } from './helpers/schema';

const KNOWN_ID = 'prod-001';
const UNKNOWN_ID = 'prod-does-not-exist-e2e-xyz';

// ── 200 happy path ────────────────────────────────────────────────────────────

test.describe('GET /api/v1/products/[id] — happy path', () => {
  test('200 for a known product id', async ({ request }) => {
    const res = await request.get(`/api/v1/products/${KNOWN_ID}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(KNOWN_ID);
    expect(typeof body.name).toBe('string');
    expect(typeof body.origin).toBe('string');
    expect(typeof body.owner).toBe('string');
    expect(typeof body.timestamp).toBe('number');
  });

  test('X-Correlation-Id header is present', async ({ request }) => {
    const res = await request.get(`/api/v1/products/${KNOWN_ID}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['x-correlation-id']).toBeTruthy();
  });

  test('OpenAPI schema — response body matches Product schema', async ({ request }) => {
    const res = await request.get(`/api/v1/products/${KNOWN_ID}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const v = await getValidator(request);
    v.assertValid('Product', body);
  });
});

// ── 404 unknown id ────────────────────────────────────────────────────────────

test.describe('GET /api/v1/products/[id] — not found', () => {
  test('404 for an unknown product id', async ({ request }) => {
    const res = await request.get(`/api/v1/products/${UNKNOWN_ID}`);
    expect(res.status()).toBe(404);
  });

  test('404 error envelope has correct shape', async ({ request }) => {
    const res = await request.get(`/api/v1/products/${UNKNOWN_ID}`);
    const body = await res.json();
    expect(typeof body.error.status).toBe('number');
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.correlationId).toBe('string');
    expect(body.error.status).toBe(404);
  });
});

// ── CORS ──────────────────────────────────────────────────────────────────────

test.describe('GET /api/v1/products/[id] — CORS', () => {
  test('CORS headers present when Origin matches allowlist', async ({ request }) => {
    const res = await request.get(`/api/v1/products/${KNOWN_ID}`, {
      headers: { origin: ALLOWED_ORIGIN },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers()['vary']).toContain('Origin');
  });

  test('CORS headers absent when Origin is not in allowlist', async ({ request }) => {
    const res = await request.get(`/api/v1/products/${KNOWN_ID}`, {
      headers: { origin: 'https://attacker.example.com' },
    });
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });
});
