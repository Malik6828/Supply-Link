/**
 * DELETE /api/v1/certification-registry/records/[recordId]  — Revoke a registry record
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { kvStore } from '@/lib/kv';
import type { CertificationRegistryRecord } from '@/lib/types';

export const runtime = 'nodejs';

const TTL = 10 * 365 * 24 * 60 * 60;

function recordsKey(productId: string): string {
  return `cert-registry:records:${productId}`;
}

const revokeSchema = z.object({
  productId: z.string().trim().min(1).max(128),
  issuerAddress: z.string().trim().min(1).max(256),
});

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { recordId: string } },
): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'DELETE /api/v1/certification-registry/records/[recordId]',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest(
      'DELETE /api/v1/certification-registry/records/[recordId]',
      429,
      Date.now() - start,
    );
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest(
      'DELETE /api/v1/certification-registry/records/[recordId]',
      401,
      Date.now() - start,
    );
    return auth.error;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return withCors(request, apiError(request, 400, ErrorCode.INVALID_JSON, 'Invalid JSON body'));
  }

  const parsed = revokeSchema.safeParse(payload);
  if (!parsed.success) {
    return withCors(
      request,
      apiError(
        request,
        400,
        ErrorCode.VALIDATION_ERROR,
        parsed.error.issues[0]?.message ?? 'Validation error',
      ),
    );
  }

  const { productId, issuerAddress } = parsed.data;
  const recordId = resolvedParams.recordId;

  const raw = await kvStore.get(recordsKey(productId));
  const records: CertificationRegistryRecord[] = raw
    ? (JSON.parse(raw) as CertificationRegistryRecord[])
    : [];

  const idx = records.findIndex((r) => r.id === recordId);
  if (idx === -1) {
    return withCors(
      request,
      apiError(request, 404, ErrorCode.NOT_FOUND, `Record '${recordId}' not found`),
    );
  }

  if (records[idx].issuerAddress !== issuerAddress) {
    return withCors(
      request,
      apiError(request, 403, ErrorCode.FORBIDDEN, 'Only the issuer can revoke this record'),
    );
  }

  records[idx] = { ...records[idx], revoked: true, revokedAt: Date.now() };
  await kvStore.set(recordsKey(productId), JSON.stringify(records), TTL);

  recordRequest(
    'DELETE /api/v1/certification-registry/records/[recordId]',
    200,
    Date.now() - start,
  );
  return withCors(request, withCorrelationId(request, NextResponse.json(true, { status: 200 })));
}
