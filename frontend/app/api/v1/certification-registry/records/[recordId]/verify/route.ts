/**
 * GET /api/v1/certification-registry/records/[recordId]/verify
 *   — Verify a certification registry record
 *
 * Query params: productId (required)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { kvStore } from '@/lib/kv';
import type {
  CertificationIssuer,
  CertificationRegistryRecord,
  CertificationVerificationResult,
} from '@/lib/types';

export const runtime = 'nodejs';

function recordsKey(productId: string): string {
  return `cert-registry:records:${productId}`;
}

function issuerKey(address: string): string {
  return `cert-registry:issuer:${address}`;
}

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: { recordId: string } },
): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/certification-registry/records/[recordId]/verify',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest(
      'GET /api/v1/certification-registry/records/[recordId]/verify',
      429,
      Date.now() - start,
    );
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest(
      'GET /api/v1/certification-registry/records/[recordId]/verify',
      401,
      Date.now() - start,
    );
    return auth.error;
  }

  const productId = request.nextUrl.searchParams.get('productId');
  if (!productId) {
    return withCors(
      request,
      apiError(request, 400, ErrorCode.MISSING_FIELDS, 'productId is required'),
    );
  }

  const raw = await kvStore.get(recordsKey(productId));
  const records: CertificationRegistryRecord[] = raw
    ? (JSON.parse(raw) as CertificationRegistryRecord[])
    : [];

  const record = records.find((r) => r.id === resolvedParams.recordId);
  if (!record) {
    return withCors(
      request,
      apiError(request, 404, ErrorCode.NOT_FOUND, `Record '${resolvedParams.recordId}' not found`),
    );
  }

  // Fetch issuer for enriched response
  let issuer: CertificationIssuer | undefined;
  const issuerRaw = await kvStore.get(issuerKey(record.issuerAddress));
  if (issuerRaw) {
    issuer = JSON.parse(issuerRaw) as CertificationIssuer;
  }

  const result: CertificationVerificationResult = {
    valid: !record.revoked,
    record,
    issuer,
  };

  recordRequest(
    'GET /api/v1/certification-registry/records/[recordId]/verify',
    200,
    Date.now() - start,
  );
  return withCors(request, withCorrelationId(request, NextResponse.json(result, { status: 200 })));
}
