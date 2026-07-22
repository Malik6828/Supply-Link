/**
 * GET    /api/v1/certification-registry/issuers/[address]  — Get issuer by address
 * DELETE /api/v1/certification-registry/issuers/[address]  — Deactivate issuer
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { kvStore } from '@/lib/kv';
import type { CertificationIssuer } from '@/lib/types';

export const runtime = 'nodejs';

const TTL = 10 * 365 * 24 * 60 * 60;

function issuerKey(address: string): string {
  return `cert-registry:issuer:${address}`;
}

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const { address } = await params;

  const limited = applyRateLimit(
    request,
    'GET /api/v1/certification-registry/issuers/[address]',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('GET /api/v1/certification-registry/issuers/[address]', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/certification-registry/issuers/[address]', 429, Date.now() - start);
    return auth.error;
  }

  const raw = await kvStore.get(issuerKey(address));
  if (!raw) {
    return withCors(request, apiError(request, 404, ErrorCode.NOT_FOUND, 'Issuer not found'));
  }

  recordRequest('GET /api/v1/certification-registry/issuers/[address]', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json(JSON.parse(raw), { status: 200 })),
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const { address } = await params;

  const limited = applyRateLimit(
    request,
    'DELETE /api/v1/certification-registry/issuers/[address]',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest(
      'DELETE /api/v1/certification-registry/issuers/[address]',
      429,
      Date.now() - start,
    );
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest(
      'DELETE /api/v1/certification-registry/issuers/[address]',
      401,
      Date.now() - start,
    );
    return auth.error;
  }

  const raw = await kvStore.get(issuerKey(address));
  if (!raw) {
    return withCors(request, apiError(request, 404, ErrorCode.NOT_FOUND, 'Issuer not found'));
  }

  const issuer = JSON.parse(raw) as CertificationIssuer;
  issuer.active = false;
  await kvStore.set(issuerKey(address), JSON.stringify(issuer), TTL);

  recordRequest('DELETE /api/v1/certification-registry/issuers/[address]', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(true, { status: 200 })));
}
