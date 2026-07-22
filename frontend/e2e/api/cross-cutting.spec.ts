/**
 * e2e/api/cross-cutting.spec.ts
 *
 * Cross-cutting concern tests that span multiple endpoints:
 *   1. Rate limiting — exhaust the burst window, verify 429 + Retry-After header
 *   2. CORS preflight (OPTIONS) — verify 204 + full CORS headers on matched origin
 *
 * Strategy for rate-limit tests:
 *   The in-memory rate limiter keys on the client IP extracted from X-Forwarded-For
 *   (enabled because TRUSTED_PROXY=true is set in the webServer env).
 *   Each rate-limit test uses a unique fake IP (via X-Forwarded-For) so it gets
 *   its own clean counter, avoiding interference between tests.
 *
 * Rate presets used by the endpoints under test:
 *   GET  /api/v1/products      — default   { limit: 60,  windowMs: 60_000 }
 *   GET  /api/v1/products/[id] — publicRead { limit: 30, burstLimit: 10, burstWindowMs: 10_000 }
 *   GET  /api/v1/attestations  — publicRead { limit: 30, burstLimit: 10, burstWindowMs: 10_000 }
 *
 * We exhaust the BURST window (10 req / 10 s) on publicRead endpoints since
 * that threshold is small enough to hit in a test without sending 30+ requests.
 */

import { test, expect, ALLOWED_ORIGIN } from './helpers/setup';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a unique fake IP so each test gets its own rate-limit counter. */
function uniqueIp(): string {
  return `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

/**
 * Fire `count` GET requests to `path` from the same fake IP.
 * Returns all responses in order.
 */
async function burst(
  request: import('@playwright/test').APIRequestContext,
  path: string,
  count: number,
  extraHeaders: Record<string, string> = {},
): Promise<import('@playwright/test').APIResponse[]> {
  const ip = uniqueIp();
  const responses: import('@playwright/test').APIResponse[] = [];
  for (let i = 0; i < count; i++) {
    const res = await request.get(path, {
      headers: {
        'x-forwarded-for': ip,
        ...extraHeaders,
      },
    });
    responses.push(res);
  }
  return responses;
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

test.describe('Rate limiting — GET /api/v1/products/[id] (publicRead preset)', () => {
  /**
   * publicRead burst: 10 requests per 10-second window.
   * Send 12 — the last ones should hit 429.
   */
  test('429 after burst limit is exceeded, response has Retry-After header', async ({
    request,
  }) => {
    const ip = uniqueIp();
    const headers = { 'x-forwarded-for': ip };
    let got429 = false;

    // Send 12 rapid requests; the burst limit is 10 per 10 s
    for (let i = 0; i < 12; i++) {
      const res = await request.get('/api/v1/products/prod-001', { headers });
      if (res.status() === 429) {
        got429 = true;
        const body = await res.json();
        expect(body.error.code).toBe('RATE_LIMITED');
        expect(body.error.correlationId).toBeTruthy();

        // Retry-After must be a positive integer
        const retryAfter = res.headers()['retry-after'];
        expect(retryAfter).toBeTruthy();
        expect(parseInt(retryAfter, 10)).toBeGreaterThan(0);
        break;
      }
    }

    expect(got429).toBe(true);
  });

  test('429 error envelope matches canonical error shape', async ({ request }) => {
    const ip = uniqueIp();
    const headers = { 'x-forwarded-for': ip };
    let errorBody: Record<string, unknown> | null = null;

    for (let i = 0; i < 12; i++) {
      const res = await request.get('/api/v1/products/prod-001', { headers });
      if (res.status() === 429) {
        errorBody = await res.json();
        break;
      }
    }

    expect(errorBody).not.toBeNull();
    const err = (errorBody as { error: Record<string, unknown> }).error;
    expect(typeof err.status).toBe('number');
    expect(err.status).toBe(429);
    expect(typeof err.code).toBe('string');
    expect(typeof err.message).toBe('string');
    expect(typeof err.correlationId).toBe('string');
  });
});

test.describe('Rate limiting — GET /api/v1/attestations?productId (publicRead preset)', () => {
  test('429 after burst limit is exceeded on attestations', async ({ request }) => {
    const ip = uniqueIp();
    const headers = { 'x-forwarded-for': ip };
    let got429 = false;

    for (let i = 0; i < 12; i++) {
      const res = await request.get('/api/v1/attestations?productId=prod-001', { headers });
      if (res.status() === 429) {
        got429 = true;
        const retryAfter = res.headers()['retry-after'];
        expect(retryAfter).toBeTruthy();
        expect(parseInt(retryAfter, 10)).toBeGreaterThan(0);
        break;
      }
    }

    expect(got429).toBe(true);
  });
});

test.describe('Rate limiting — GET /api/v1/products (default preset)', () => {
  /**
   * Default preset: 60 req / 60 s, burstLimit undefined (no burst check).
   * We cannot easily hit 60 in a test, so instead we verify the first 5 requests
   * all succeed — proving the limiter is not overly aggressive.
   *
   * The 429 path is covered by the publicRead tests above.
   */
  test('first 5 requests from same IP succeed (not over-throttled)', async ({
    request,
    apiKey,
  }) => {
    const ip = uniqueIp();
    const responses = await burst(request, '/api/v1/products', 5, { 'x-api-key': apiKey });
    for (const res of responses) {
      expect(res.status()).toBe(200);
    }
  });
});

// ── CORS preflight (OPTIONS) ──────────────────────────────────────────────────

test.describe('CORS OPTIONS preflight', () => {
  const endpoints = ['/api/v1/products', '/api/v1/products/prod-001', '/api/v1/attestations'];

  for (const endpoint of endpoints) {
    test(`OPTIONS ${endpoint} — 204 with full CORS headers for allowed origin`, async ({
      request,
    }) => {
      const res = await request.fetch(endpoint, {
        method: 'OPTIONS',
        headers: {
          origin: ALLOWED_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, x-api-key',
        },
      });

      expect(res.status()).toBe(204);
      expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(res.headers()['access-control-allow-methods']).toMatch(/POST/);
      expect(res.headers()['access-control-allow-headers']).toMatch(/content-type/i);
      // Vary must include Origin so caches don't serve wrong CORS headers
      expect(res.headers()['vary']).toContain('Origin');
    });

    test(`OPTIONS ${endpoint} — 204 but no ACAO header for disallowed origin`, async ({
      request,
    }) => {
      const res = await request.fetch(endpoint, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://not-allowed.example.com',
          'access-control-request-method': 'POST',
        },
      });

      expect(res.status()).toBe(204);
      // No ACAO header for origins not in the allowlist
      expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    });
  }
});

// ── Correlation IDs across endpoints ─────────────────────────────────────────

test.describe('X-Correlation-Id — cross-endpoint', () => {
  test('every successful GET includes X-Correlation-Id', async ({ request, apiKey }) => {
    const endpoints: Array<{ url: string; headers: Record<string, string> }> = [
      { url: '/api/v1/products', headers: { 'x-api-key': apiKey } },
      { url: '/api/v1/products/prod-001', headers: {} },
      {
        url: '/api/v1/attestations?productId=prod-001',
        headers: {},
      },
    ];

    for (const { url, headers } of endpoints) {
      const res = await request.get(url, { headers });
      // Only check the header for non-rate-limited responses
      if (res.status() < 400) {
        expect(res.headers()['x-correlation-id']).toBeTruthy();
      }
    }
  });

  test('every 4xx error response includes X-Correlation-Id', async ({ request }) => {
    // Hit 401 on products, 404 on unknown product
    const unauthRes = await request.get('/api/v1/products');
    expect(unauthRes.status()).toBe(401);
    expect(unauthRes.headers()['x-correlation-id']).toBeTruthy();

    const notFoundRes = await request.get('/api/v1/products/nonexistent-xyz');
    expect(notFoundRes.status()).toBe(404);
    expect(notFoundRes.headers()['x-correlation-id']).toBeTruthy();
  });
});
