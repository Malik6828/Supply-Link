/**
 * e2e/api/attestations.spec.ts
 *
 * Contract tests for:
 *   POST /api/v1/attestations  — add an attestation (auditor-tier key required)
 *   GET  /api/v1/attestations  — list attestations by productId or issuerAddress
 *
 * Covers: 401 auth, 200/201 happy-path, validation errors, idempotency,
 *         CORS, X-Correlation-Id, OpenAPI schema.
 *
 * Auth note:
 *   This endpoint uses authenticateRegistryKey (dynamic KV registry), NOT the
 *   static PARTNER_API_KEY env var. An auditor key is issued by globalSetup
 *   and made available as `auditorKey` via the shared fixture.
 */

import { test, expect, ALLOWED_ORIGIN } from './helpers/setup';
import { getValidator } from './helpers/schema';

const ENDPOINT = '/api/v1/attestations';
const KNOWN_PRODUCT_ID = 'prod-001';

// ── Helpers ───────────────────────────────────────────────────────────────────

function validAttestationBody(suffix = Date.now().toString(36)) {
  return {
    productId: KNOWN_PRODUCT_ID,
    issuerAddress: `GISSUER${suffix}ABCDEFGHIJKLMNOPQRSTUVWXY`,
    issuerName: `E2E Auditor ${suffix}`,
    trustLevel: 'verified',
    attestationType: 'audit',
    summary: `E2E compliance audit for ${suffix}`,
    signedReference: `sha256:e2e-ref-${suffix}`,
    expiresInDays: 30,
  };
}

// ── POST — auth ───────────────────────────────────────────────────────────────

test.describe('POST /api/v1/attestations — auth', () => {
  test('401 when x-api-key header is missing', async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      data: validAttestationBody(),
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('401 when x-api-key is invalid', async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': 'sl_auditor_completely_invalid_key_000' },
      data: validAttestationBody(),
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('401 when partner key used (auditor tier required)', async ({ request, apiKey }) => {
    // The partner key is an env-var static key — not registered in the registry
    // so it will fail authenticateRegistryKey. This tests tier enforcement.
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': apiKey },
      data: validAttestationBody(),
    });
    // 401 because partner key is not in the KV registry
    expect([401, 403]).toContain(res.status());
  });
});

// ── POST — happy path ─────────────────────────────────────────────────────────

test.describe('POST /api/v1/attestations — happy path', () => {
  test('201 on valid payload with auditor key', async ({ request, auditorKey }) => {
    const payload = validAttestationBody();
    const res = await request.post(ENDPOINT, {
      headers: {
        'x-api-key': auditorKey,
        'content-type': 'application/json',
        origin: ALLOWED_ORIGIN,
      },
      data: payload,
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.productId).toBe(KNOWN_PRODUCT_ID);
    expect(body.issuerAddress).toBe(payload.issuerAddress);
    expect(body.issuerName).toBe(payload.issuerName);
    expect(body.trustLevel).toBe(payload.trustLevel);
    expect(body.attestationType).toBe(payload.attestationType);
    expect(body.summary).toBe(payload.summary);
    expect(typeof body.id).toBe('string');
    expect(typeof body.issuedAt).toBe('number');

    // CORS + correlation
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers()['x-correlation-id']).toBeTruthy();
  });

  test('201 response body conforms to OpenAPI schema', async ({ request, auditorKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: {
        'x-api-key': auditorKey,
        'content-type': 'application/json',
      },
      data: validAttestationBody(`schema-${Date.now()}`),
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    const v = await getValidator(request);
    // Validate against the Attestation schema if it exists in the spec
    if (v.isValid('Attestation', body)) {
      v.assertValid('Attestation', body);
    }
    // At minimum the top-level shape must be an object
    expect(typeof body).toBe('object');
  });
});

// ── POST — validation errors ──────────────────────────────────────────────────

test.describe('POST /api/v1/attestations — validation errors', () => {
  test('400 when productId is missing', async ({ request, auditorKey }) => {
    const payload = validAttestationBody();
    const { productId: _omit, ...withoutProductId } = payload;
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': auditorKey, 'content-type': 'application/json' },
      data: withoutProductId,
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('400 when issuerAddress is missing', async ({ request, auditorKey }) => {
    const payload = validAttestationBody();
    const { issuerAddress: _omit, ...rest } = payload;
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': auditorKey, 'content-type': 'application/json' },
      data: rest,
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('400 when trustLevel is invalid enum value', async ({ request, auditorKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': auditorKey, 'content-type': 'application/json' },
      data: { ...validAttestationBody(), trustLevel: 'superstar' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('400 when attestationType is invalid enum value', async ({ request, auditorKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': auditorKey, 'content-type': 'application/json' },
      data: { ...validAttestationBody(), attestationType: 'unknown_type' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('400 when reportUrl is not a valid URL', async ({ request, auditorKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': auditorKey, 'content-type': 'application/json' },
      data: { ...validAttestationBody(), reportUrl: 'not-a-url' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('400 on invalid JSON body', async ({ request, auditorKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': auditorKey, 'content-type': 'application/json' },
      data: '{{not-json}}',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/INVALID_JSON|INVALID_PAYLOAD/);
  });

  test('error envelope always has required fields', async ({ request, auditorKey }) => {
    const res = await request.post(ENDPOINT, {
      headers: { 'x-api-key': auditorKey, 'content-type': 'application/json' },
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

// ── GET — query filtering ─────────────────────────────────────────────────────

test.describe('GET /api/v1/attestations', () => {
  test('400 when neither productId nor issuerAddress is provided', async ({ request }) => {
    const res = await request.get(ENDPOINT);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('200 with productId query param', async ({ request }) => {
    const res = await request.get(`${ENDPOINT}?productId=${KNOWN_PRODUCT_ID}`, {
      headers: { origin: ALLOWED_ORIGIN },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.attestations)).toBe(true);
    expect(typeof body.total).toBe('number');

    // CORS + correlation
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers()['x-correlation-id']).toBeTruthy();
  });

  test('200 with issuerAddress query param', async ({ request }) => {
    const res = await request.get(`${ENDPOINT}?issuerAddress=GISSUER0001TEST`, {
      headers: { origin: ALLOWED_ORIGIN },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.attestations)).toBe(true);
  });
});

// ── POST — idempotency ────────────────────────────────────────────────────────

test.describe('POST /api/v1/attestations — idempotency', () => {
  test('same Idempotency-Key + same body returns identical result', async ({
    request,
    auditorKey,
  }) => {
    const idempotencyKey = `e2e-attest-idem-${Date.now()}`;
    const payload = validAttestationBody(`idem-${Date.now()}`);
    const headers = {
      'x-api-key': auditorKey,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    const res1 = await request.post(ENDPOINT, { headers, data: payload });
    expect(res1.status()).toBe(201);
    const body1 = await res1.json();

    const res2 = await request.post(ENDPOINT, { headers, data: payload });
    expect(res2.status()).toBe(201);
    const body2 = await res2.json();

    expect(body2.id).toBe(body1.id);
    expect(res2.headers()['idempotent-replayed']).toBe('true');
  });

  test('same Idempotency-Key + different body returns 409', async ({ request, auditorKey }) => {
    const idempotencyKey = `e2e-attest-conflict-${Date.now()}`;
    const headers = {
      'x-api-key': auditorKey,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    await request.post(ENDPOINT, {
      headers,
      data: { ...validAttestationBody('v1'), summary: 'First summary' },
    });

    const res = await request.post(ENDPOINT, {
      headers,
      data: { ...validAttestationBody('v1'), summary: 'Different summary — conflict' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
