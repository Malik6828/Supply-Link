/**
 * GET  /api/v1/insurance        – list coverage for a product
 * POST /api/v1/insurance        – add insurance coverage to a product
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
  addCoverage,
  listCoverageForProduct,
  verifyCoverage,
} from '@/lib/services/insuranceCoverage';
import { recordReadAccess, anonymousActor } from '@/lib/services/readAccessAudit';
import { getCorrelationId } from '@/lib/api/correlation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

const AddCoverageSchema = z.object({
  productId: z.string().min(1),
  provider: z.string().min(1).max(200),
  policyNumber: z.string().min(1).max(100),
  coverageType: z.string().min(1).max(100),
  coverageAmount: z.number().int().positive(),
  currency: z.string().length(3),
  validFrom: z.number().int().positive(),
  validUntil: z.number().int().nonnegative().default(0),
  documentRef: z.string().max(500).optional(),
  registeredBy: z.string().min(1),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/insurance',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/insurance', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/insurance', 401, Date.now() - start);
    return auth.error;
  }

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get('productId');

  if (!productId) {
    return withCors(
      request,
      apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'productId query parameter is required'),
    );
  }

  // Audit the read access
  recordReadAccess({
    operation: 'insurance.read',
    productIds: [productId],
    actor: anonymousActor(),
    requestPath: request.nextUrl.pathname,
    responseStatus: 200,
    correlationId: getCorrelationId(request),
  });

  const coverages = listCoverageForProduct(productId);
  const verification = verifyCoverage(productId);

  recordRequest('GET /api/v1/insurance', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ coverages, verification, total: coverages.length }, { status: 200 }),
    ),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/insurance',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/insurance', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('POST /api/v1/insurance', 401, Date.now() - start);
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

  const parsed = AddCoverageSchema.safeParse(body);
  if (!parsed.success) {
    recordRequest('POST /api/v1/insurance', 422, Date.now() - start);
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

  const coverage = addCoverage(parsed.data);

  recordRequest('POST /api/v1/insurance', 201, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json(coverage, { status: 201 })),
  );
}
