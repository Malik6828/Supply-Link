/**
 * e2e/api/certification-registry.spec.ts
 *
 * End-to-end tests for the certification registry subsystem (#590).
 *
 * Covers the full lifecycle in mock mode:
 *   1. Register a certification issuer
 *   2. Issue a certification record against a product
 *   3. Verify the record (expect valid)
 *   4. Revoke the record via DELETE /records/[recordId]
 *   5. Verify the record again (expect revoked / invalid)
 *   6. Check the revocation registry lists the revoked credential
 *   7. Assert the chain explorer service logic via inline helpers
 *
 * Auth:
 *   - certification-registry routes use 'partner' auth  → PARTNER_API_KEY
 *   - POST /api/v1/revocations uses 'internal' auth     → INTERNAL_API_KEY
 */

import { test, expect, PARTNER_KEY, INTERNAL_KEY, ALLOWED_ORIGIN } from './helpers/setup';

// ── Constants ─────────────────────────────────────────────────────────────────

const ISSUERS_ENDPOINT = '/api/v1/certification-registry/issuers';
const RECORDS_ENDPOINT = '/api/v1/certification-registry/records';
const REVOCATIONS_ENDPOINT = '/api/v1/revocations';

const PARTNER_HEADERS = {
  'x-api-key': PARTNER_KEY,
  'content-type': 'application/json',
  origin: ALLOWED_ORIGIN,
};

const INTERNAL_HEADERS = {
  'x-api-key': INTERNAL_KEY,
  'content-type': 'application/json',
  origin: ALLOWED_ORIGIN,
};

/** Unique suffix per test run to avoid KV collisions across parallel runs */
const RUN_ID = Date.now().toString(36);

// ── Inline chain-explorer helpers (mirrors lib/services/certificationChainExplorer) ──

interface CertificationChainLink {
  from_cert_id: string;
  to_cert_id: string;
  link_type: 'depends_on' | 'supersedes' | 'related';
  created_at: number;
}

interface CertificationNode {
  cert_id: string;
  cert_type: string;
  issuer: string;
  issued_at: number;
  revoked: boolean;
  dependencies: string[];
  dependents: string[];
}

interface CertificationChain {
  root_cert_id: string;
  nodes: CertificationNode[];
  links: CertificationChainLink[];
  depth: number;
}

function buildCertificationChain(
  rootCertId: string,
  links: CertificationChainLink[],
  certifications: Map<string, CertificationNode>,
): CertificationChain {
  const nodes = new Map<string, CertificationNode>();
  const visited = new Set<string>();

  function traverse(certId: string, depth = 0): void {
    if (visited.has(certId) || depth > 10) return;
    visited.add(certId);
    const cert = certifications.get(certId);
    if (!cert) return;
    const node: CertificationNode = {
      cert_id: certId,
      cert_type: cert.cert_type,
      issuer: cert.issuer,
      issued_at: cert.issued_at,
      revoked: cert.revoked,
      dependencies: [],
      dependents: [],
    };
    links.forEach((link) => {
      if (link.to_cert_id === certId && link.link_type === 'depends_on') {
        node.dependencies.push(link.from_cert_id);
        traverse(link.from_cert_id, depth + 1);
      }
    });
    links.forEach((link) => {
      if (link.from_cert_id === certId && link.link_type === 'depends_on') {
        node.dependents.push(link.to_cert_id);
        traverse(link.to_cert_id, depth + 1);
      }
    });
    nodes.set(certId, node);
  }

  traverse(rootCertId);

  return {
    root_cert_id: rootCertId,
    nodes: Array.from(nodes.values()),
    links,
    depth: Math.max(...Array.from(nodes.values()).map((n) => n.dependencies.length), 0),
  };
}

function isValidCertificationChain(chain: CertificationChain): boolean {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function hasCycle(certId: string): boolean {
    visited.add(certId);
    stack.add(certId);
    const node = chain.nodes.find((n) => n.cert_id === certId);
    if (!node) return false;
    for (const dep of node.dependencies) {
      if (!visited.has(dep)) {
        if (hasCycle(dep)) return true;
      } else if (stack.has(dep)) {
        return true;
      }
    }
    stack.delete(certId);
    return false;
  }

  for (const node of chain.nodes) {
    if (!visited.has(node.cert_id)) {
      if (hasCycle(node.cert_id)) return false;
    }
  }
  return true;
}

// ── Auth guard tests ──────────────────────────────────────────────────────────

test.describe('Auth guards — certification-registry endpoints', () => {
  test('POST /issuers returns 401 without API key', async ({ request }) => {
    const res = await request.post(ISSUERS_ENDPOINT, {
      data: { issuerAddress: 'GTEST', name: 'Test', certTypes: ['organic'] },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('POST /records returns 401 without API key', async ({ request }) => {
    const res = await request.post(RECORDS_ENDPOINT, {
      data: {
        productId: 'prod-x',
        issuerAddress: 'GTEST',
        recordId: 'rec-x',
        externalCertId: 'EXT-X',
        certType: 'organic',
        documentHash: 'a'.repeat(64),
      },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /records/[id]/verify returns 401 without API key', async ({ request }) => {
    const res = await request.get(
      `${RECORDS_ENDPOINT}/nonexistent/verify?productId=prod-x`,
    );
    expect(res.status()).toBe(401);
  });

  test('DELETE /records/[id] returns 401 without API key', async ({ request }) => {
    const res = await request.delete(`${RECORDS_ENDPOINT}/nonexistent`, {
      data: { productId: 'prod-x', issuerAddress: 'GTEST' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /revocations returns 401 with partner key (requires internal)', async ({
    request,
  }) => {
    const res = await request.post(REVOCATIONS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: {
        subjectId: 'test-id',
        type: 'registry_record',
        productId: 'prod-x',
        revokedBy: 'GTEST',
      },
    });
    expect(res.status()).toBe(401);
  });
});

// ── Issuer registration ───────────────────────────────────────────────────────

test.describe('POST /api/v1/certification-registry/issuers', () => {
  test('201 creates issuer and returns full object', async ({ request }) => {
    const issuerAddress = `GISSUER${RUN_ID}E2ECERT0000000001`;
    const res = await request.post(ISSUERS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: {
        issuerAddress,
        name: 'E2E Organic Authority',
        certTypes: ['organic', 'fair_trade'],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.issuerAddress).toBe(issuerAddress);
    expect(body.name).toBe('E2E Organic Authority');
    expect(body.certTypes).toEqual(expect.arrayContaining(['organic', 'fair_trade']));
    expect(body.active).toBe(true);
    expect(typeof body.registeredAt).toBe('number');
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers()['x-correlation-id']).toBeTruthy();
  });

  test('409 on duplicate issuer address', async ({ request }) => {
    const issuerAddress = `GDUP${RUN_ID}00000000000000000001`;
    const payload = { issuerAddress, name: 'Dup Authority', certTypes: ['iso_9001'] };
    const first = await request.post(ISSUERS_ENDPOINT, { headers: PARTNER_HEADERS, data: payload });
    expect(first.status()).toBe(201);
    const second = await request.post(ISSUERS_ENDPOINT, { headers: PARTNER_HEADERS, data: payload });
    expect(second.status()).toBe(409);
    expect((await second.json()).error.code).toBe('CONFLICT');
  });

  test('400 when certTypes is empty', async ({ request }) => {
    const res = await request.post(ISSUERS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: { issuerAddress: `GBAD${RUN_ID}000000000000000000001`, name: 'Bad', certTypes: [] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('400 when issuerAddress is missing', async ({ request }) => {
    const res = await request.post(ISSUERS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: { name: 'Missing Address', certTypes: ['organic'] },
    });
    expect(res.status()).toBe(400);
  });
});

// ── Issue registry record ─────────────────────────────────────────────────────

test.describe('POST /api/v1/certification-registry/records', () => {
  test('201 issues a record after issuer is registered', async ({ request }) => {
    const issuerAddress = `GNEWREC${RUN_ID}00000000000000001`;
    const productId = `e2e-prod-${RUN_ID}-rec`;
    const recordId = `e2e-rec-${RUN_ID}-new`;

    await request.post(ISSUERS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: { issuerAddress, name: 'Record Issuer', certTypes: ['organic'] },
    });

    const res = await request.post(RECORDS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: {
        productId,
        issuerAddress,
        recordId,
        externalCertId: `EXT-${RUN_ID}`,
        certType: 'organic',
        documentHash: 'a'.repeat(64),
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(recordId);
    expect(body.productId).toBe(productId);
    expect(body.issuerAddress).toBe(issuerAddress);
    expect(body.certType).toBe('organic');
    expect(body.revoked).toBe(false);
    expect(body.revokedAt).toBe(0);
    expect(typeof body.issuedAt).toBe('number');
  });

  test('404 when issuer is not registered', async ({ request }) => {
    const res = await request.post(RECORDS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: {
        productId: `e2e-prod-${RUN_ID}-nf`,
        issuerAddress: 'GUNREGISTERED0000000000000000000000001',
        recordId: `e2e-rec-${RUN_ID}-nf`,
        externalCertId: 'EXT-NONE',
        certType: 'organic',
        documentHash: 'b'.repeat(64),
      },
    });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  test('400 when certType not supported by the issuer', async ({ request }) => {
    const issuerAddress = `GNARROW${RUN_ID}00000000000000001`;
    await request.post(ISSUERS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: { issuerAddress, name: 'Narrow Authority', certTypes: ['iso_9001'] },
    });
    const res = await request.post(RECORDS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: {
        productId: `e2e-prod-${RUN_ID}-ct`,
        issuerAddress,
        recordId: `e2e-rec-${RUN_ID}-ct`,
        externalCertId: 'EXT-CT',
        certType: 'organic', // not in issuer's certTypes
        documentHash: 'c'.repeat(64),
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toMatch(/VALIDATION_ERROR/);
  });

  test('409 on duplicate record ID', async ({ request }) => {
    const issuerAddress = `GDUPID${RUN_ID}00000000000000001`;
    const productId = `e2e-prod-${RUN_ID}-dupid`;
    const recordId = `e2e-rec-${RUN_ID}-dupid`;
    await request.post(ISSUERS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: { issuerAddress, name: 'Dup ID Auth', certTypes: ['fair_trade'] },
    });
    const payload = {
      productId, issuerAddress, recordId,
      externalCertId: `EXT-DUPID-${RUN_ID}`,
      certType: 'fair_trade',
      documentHash: 'd'.repeat(64),
    };
    const first = await request.post(RECORDS_ENDPOINT, { headers: PARTNER_HEADERS, data: payload });
    expect(first.status()).toBe(201);
    const second = await request.post(RECORDS_ENDPOINT, { headers: PARTNER_HEADERS, data: payload });
    expect(second.status()).toBe(409);
    expect((await second.json()).error.code).toBe('CONFLICT');
  });
});

// ── Core lifecycle: issue → verify(valid) → revoke → verify(revoked) ──────────

test.describe('Core lifecycle — issue → verify → revoke → verify(revoked)', () => {
  test('full lifecycle in mock mode', async ({ request }) => {
    const issuerAddress = `GLIFE${RUN_ID}000000000000000000001`;
    const productId = `lifecycle-prod-${RUN_ID}`;
    const recordId = `lifecycle-rec-${RUN_ID}`;
    const externalCertId = `EXT-LIFE-${RUN_ID}`;

    // Step 1: Register issuer
    const issuerRes = await request.post(ISSUERS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: { issuerAddress, name: 'E2E Lifecycle Authority', certTypes: ['organic', 'fair_trade'] },
    });
    expect(issuerRes.status(), 'register issuer').toBe(201);
    const issuer = await issuerRes.json();
    expect(issuer.active).toBe(true);

    // Step 2: Issue a certification record
    const issueRes = await request.post(RECORDS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: {
        productId, issuerAddress, recordId,
        externalCertId, certType: 'organic',
        documentHash: 'e'.repeat(64),
      },
    });
    expect(issueRes.status(), 'issue record').toBe(201);
    const record = await issueRes.json();
    expect(record.id).toBe(recordId);
    expect(record.revoked).toBe(false);

    // Step 3: List records — confirm record present and active
    const listRes = await request.get(
      `${RECORDS_ENDPOINT}?productId=${encodeURIComponent(productId)}`,
      { headers: PARTNER_HEADERS },
    );
    expect(listRes.status(), 'list records').toBe(200);
    const records = await listRes.json();
    expect(Array.isArray(records)).toBe(true);
    expect(records.some((r: { id: string }) => r.id === recordId)).toBe(true);

    // Step 4: Verify record — expect valid
    const verifyValidRes = await request.get(
      `${RECORDS_ENDPOINT}/${encodeURIComponent(recordId)}/verify?productId=${encodeURIComponent(productId)}`,
      { headers: PARTNER_HEADERS },
    );
    expect(verifyValidRes.status(), 'verify (valid)').toBe(200);
    const verifyValid = await verifyValidRes.json();
    expect(verifyValid.valid, 'should be valid before revocation').toBe(true);
    expect(verifyValid.record.id).toBe(recordId);
    expect(verifyValid.record.revoked).toBe(false);
    expect(verifyValid.issuer).toBeDefined();
    expect(verifyValid.issuer.name).toBe('E2E Lifecycle Authority');
    expect(verifyValidRes.headers()['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

    // Step 5: Revoke the record via DELETE
    const revokeRes = await request.delete(
      `${RECORDS_ENDPOINT}/${encodeURIComponent(recordId)}`,
      { headers: PARTNER_HEADERS, data: { productId, issuerAddress } },
    );
    expect(revokeRes.status(), 'revoke record').toBe(200);
    expect(await revokeRes.json()).toBe(true);

    // Step 6: Verify record again — expect revoked/invalid
    const verifyRevokedRes = await request.get(
      `${RECORDS_ENDPOINT}/${encodeURIComponent(recordId)}/verify?productId=${encodeURIComponent(productId)}`,
      { headers: PARTNER_HEADERS },
    );
    expect(verifyRevokedRes.status(), 'verify (revoked)').toBe(200);
    const verifyRevoked = await verifyRevokedRes.json();
    expect(verifyRevoked.valid, 'should be invalid after revocation').toBe(false);
    expect(verifyRevoked.record.revoked).toBe(true);
    expect(verifyRevoked.record.revokedAt).toBeGreaterThan(0);

    // Step 7: Record appears in list as revoked
    const listAfterRes = await request.get(
      `${RECORDS_ENDPOINT}?productId=${encodeURIComponent(productId)}`,
      { headers: PARTNER_HEADERS },
    );
    expect(listAfterRes.status(), 'list after revoke').toBe(200);
    const recordsAfter = await listAfterRes.json();
    const revokedRecord = (recordsAfter as Array<{ id: string; revoked: boolean }>)
      .find((r) => r.id === recordId);
    expect(revokedRecord, 'revoked record still in list').toBeDefined();
    expect(revokedRecord?.revoked).toBe(true);

    // Step 8: Register revocation in revocation registry
    const revRegRes = await request.post(REVOCATIONS_ENDPOINT, {
      headers: INTERNAL_HEADERS,
      data: {
        subjectId: recordId,
        type: 'registry_record',
        productId,
        revokedBy: issuerAddress,
        reason: 'E2E test revocation',
      },
    });
    expect(revRegRes.status(), 'post to revocation registry').toBe(201);
    const revEntry = await revRegRes.json();
    expect(revEntry.subjectId).toBe(recordId);
    expect(revEntry.type).toBe('registry_record');
    expect(revEntry.superseded).toBe(false);

    // Step 9: List revocation registry — confirm entry appears
    const revListRes = await request.get(
      `${REVOCATIONS_ENDPOINT}?productId=${encodeURIComponent(productId)}`,
      { headers: PARTNER_HEADERS },
    );
    expect(revListRes.status(), 'list revocations').toBe(200);
    const revBody = await revListRes.json();
    expect(Array.isArray(revBody.revocations)).toBe(true);
    const ourEntry = (revBody.revocations as Array<{ subjectId: string }>)
      .find((e) => e.subjectId === recordId);
    expect(ourEntry, 'entry in revocation registry').toBeDefined();

    // Step 10: Single-credential check
    const checkRes = await request.get(
      `${REVOCATIONS_ENDPOINT}?check=${encodeURIComponent(recordId)}`,
      { headers: PARTNER_HEADERS },
    );
    expect(checkRes.status(), 'single check').toBe(200);
    const checkBody = await checkRes.json();
    expect(checkBody.revoked).toBe(true);
    expect(checkBody.entry.subjectId).toBe(recordId);
  });
});

// ── Revocation registry — query & edge cases ──────────────────────────────────

test.describe('GET /api/v1/revocations', () => {
  test('200 returns revocations array and stats', async ({ request }) => {
    const res = await request.get(REVOCATIONS_ENDPOINT, { headers: PARTNER_HEADERS });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.revocations)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.stats).toBe('object');
    expect(typeof body.stats.total).toBe('number');
  });

  test('200 empty list for unknown productId', async ({ request }) => {
    const res = await request.get(
      `${REVOCATIONS_ENDPOINT}?productId=product-with-no-revocations-ever`,
      { headers: PARTNER_HEADERS },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.revocations).toHaveLength(0);
  });

  test('200 single-check returns revoked=false for unknown credential', async ({ request }) => {
    const res = await request.get(
      `${REVOCATIONS_ENDPOINT}?check=nonexistent-credential-xyz`,
      { headers: PARTNER_HEADERS },
    );
    expect(res.status()).toBe(200);
    expect((await res.json()).revoked).toBe(false);
  });

  test('401 without API key', async ({ request }) => {
    const res = await request.get(REVOCATIONS_ENDPOINT);
    expect(res.status()).toBe(401);
  });
});

test.describe('DELETE /records/[recordId] — edge cases', () => {
  test('404 when record does not exist', async ({ request }) => {
    const res = await request.delete(`${RECORDS_ENDPOINT}/nonexistent-record-id-xyz`, {
      headers: PARTNER_HEADERS,
      data: { productId: 'any-product', issuerAddress: 'GISSUER0001' },
    });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  test('403 when a different issuer attempts revocation', async ({ request }) => {
    const realIssuer = `GREAL${RUN_ID}000000000000000001`;
    const fakeIssuer = `GFAKE${RUN_ID}000000000000000001`;
    const productId = `e2e-403-prod-${RUN_ID}`;
    const recordId = `e2e-403-rec-${RUN_ID}`;

    await request.post(ISSUERS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: { issuerAddress: realIssuer, name: 'Real Issuer', certTypes: ['iso_9001'] },
    });
    await request.post(RECORDS_ENDPOINT, {
      headers: PARTNER_HEADERS,
      data: {
        productId, issuerAddress: realIssuer, recordId,
        externalCertId: `EXT-403-${RUN_ID}`,
        certType: 'iso_9001',
        documentHash: 'f'.repeat(64),
      },
    });

    const res = await request.delete(`${RECORDS_ENDPOINT}/${recordId}`, {
      headers: PARTNER_HEADERS,
      data: { productId, issuerAddress: fakeIssuer },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });
});

// ── Certification chain explorer — service layer (inline logic) ───────────────

test.describe('Certification chain explorer — service layer', () => {
  test('single node chain has correct structure', () => {
    const certId = `chain-root-${RUN_ID}`;
    const certMap = new Map<string, CertificationNode>([
      [certId, {
        cert_id: certId, cert_type: 'organic', issuer: 'GISSUER0001',
        issued_at: Date.now(), revoked: false, dependencies: [], dependents: [],
      }],
    ]);
    const chain = buildCertificationChain(certId, [], certMap);
    expect(chain.root_cert_id).toBe(certId);
    expect(chain.nodes).toHaveLength(1);
    expect(chain.nodes[0].cert_id).toBe(certId);
    expect(chain.nodes[0].cert_type).toBe('organic');
    expect(chain.nodes[0].revoked).toBe(false);
    expect(chain.links).toHaveLength(0);
  });

  test('depends_on links are traversed', () => {
    const rootId = `chain-root-dep-${RUN_ID}`;
    const depId = `chain-dep-${RUN_ID}`;
    const certMap = new Map<string, CertificationNode>([
      [rootId, { cert_id: rootId, cert_type: 'fair_trade', issuer: 'GISSUER0002',
        issued_at: Date.now(), revoked: false, dependencies: [], dependents: [] }],
      [depId, { cert_id: depId, cert_type: 'organic', issuer: 'GISSUER0002',
        issued_at: Date.now(), revoked: false, dependencies: [], dependents: [] }],
    ]);
    const links: CertificationChainLink[] = [
      { from_cert_id: rootId, to_cert_id: depId, link_type: 'depends_on', created_at: Date.now() },
    ];
    const chain = buildCertificationChain(rootId, links, certMap);
    expect(chain.nodes.length).toBeGreaterThanOrEqual(1);
    expect(isValidCertificationChain(chain)).toBe(true);
  });

  test('acyclic chain passes validity check', () => {
    const nodeA = `chain-a-${RUN_ID}`;
    const nodeB = `chain-b-${RUN_ID}`;
    const certMap = new Map<string, CertificationNode>([
      [nodeA, { cert_id: nodeA, cert_type: 'iso_9001', issuer: 'GISSUER0003',
        issued_at: Date.now(), revoked: false, dependencies: [], dependents: [] }],
      [nodeB, { cert_id: nodeB, cert_type: 'iso_14001', issuer: 'GISSUER0003',
        issued_at: Date.now(), revoked: false, dependencies: [], dependents: [] }],
    ]);
    const links: CertificationChainLink[] = [
      { from_cert_id: nodeA, to_cert_id: nodeB, link_type: 'depends_on', created_at: Date.now() },
    ];
    const chain = buildCertificationChain(nodeA, links, certMap);
    expect(isValidCertificationChain(chain)).toBe(true);
  });

  test('revoked node is reflected in chain', () => {
    const revokedId = `chain-revoked-${RUN_ID}`;
    const certMap = new Map<string, CertificationNode>([
      [revokedId, { cert_id: revokedId, cert_type: 'halal', issuer: 'GISSUER0004',
        issued_at: Date.now(), revoked: true, dependencies: [], dependents: [] }],
    ]);
    const chain = buildCertificationChain(revokedId, [], certMap);
    expect(chain.nodes).toHaveLength(1);
    expect(chain.nodes[0].revoked).toBe(true);
  });

  test('empty chain for unknown root cert ID', () => {
    const chain = buildCertificationChain('nonexistent-cert', [], new Map());
    expect(chain.nodes).toHaveLength(0);
    expect(chain.links).toHaveLength(0);
  });
});
