/**
 * GET  /api/v1/revocations        – list revocations (filter by productId, type)
 * POST /api/v1/revocations        – record a new revocation
 *
 * Authentication: x-api-key (partner or internal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import {
  revokeCredential,
  listRevocations,
  checkRevocation,
  getRevocationStats,
} from '@/lib/services/revocationRegistry';
import type { RevocationType } from '@/lib/services/revocationRegistry';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

const RevokeSchema = z.object({
  subjectId: z.string().min(1),
  type: z.enum(['certification', 'attestation', 'registry_record']),
  productId: z.string().min(1),
  revokedBy: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/revocations',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/revocations', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/revocations', 401, Date.now() - start);
    return auth.error;
  }

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get('productId') ?? undefined;
  const type = (searchParams.get('type') as RevocationType) ?? undefined;
  const checkId = searchParams.get('check');

  // Single-credential check mode
  if (checkId) {
    const result = checkRevocation(checkId);
    recordRequest('GET /api/v1/revocations', 200, Date.now() - start);
    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(result, { status: 200 })),
    );
  }

  const revocations = listRevocations({ productId, type });
  const stats = getRevocationStats();

  recordRequest('GET /api/v1/revocations', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ revocations, stats, total: revocations.length }, { status: 200 }),
    ),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/revocations',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/revocations', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('POST /api/v1/revocations', 401, Date.now() - start);
    return auth.error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(
      request,
      apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid JSON body'),
    );
  }

  const parsed = RevokeSchema.safeParse(body);
  if (!parsed.success) {
    recordRequest('POST /api/v1/revocations', 422, Date.now() - start);
    return withCors(
      request,
      apiError(request, 422, ErrorCode.VALIDATION_ERROR, 'Validation failed', {
        details: parsed.error.issues.map((e) => ({
          field: e.path.join('.'),
          location: 'body' as const,
          message: e.message,
        })),
      }),
    );
  }

  const entry = revokeCredential(parsed.data);

  recordRequest('POST /api/v1/revocations', 201, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(entry, { status: 201 })));
}
