/**
 * POST  /api/v1/insurance/[id]/claims          – file a claim proof against a coverage record
 * PATCH /api/v1/insurance/[id]/claims/[claimId] – update claim proof status (verifier)
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
  getCoverage,
  addClaimProof,
  updateClaimProofStatus,
} from '@/lib/services/insuranceCoverage';
import type { ClaimProofStatus } from '@/lib/services/insuranceCoverage';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

const AddClaimSchema = z.object({
  productId: z.string().min(1),
  description: z.string().min(1).max(500),
  proofRef: z.string().min(1).max(500),
  documentHash: z.string().max(128).optional(),
  claimant: z.string().min(1),
});

const UpdateClaimSchema = z.object({
  claimId: z.string().min(1),
  status: z.enum(['pending', 'verified', 'rejected']),
  verifierNotes: z.string().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/insurance/[id]/claims',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/insurance/[id]/claims', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/insurance/[id]/claims', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  const coverage = getCoverage(id);
  if (!coverage) {
    recordRequest('POST /api/v1/insurance/[id]/claims', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Coverage record not found: ${id}`),
    );
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

  const parsed = AddClaimSchema.safeParse(body);
  if (!parsed.success) {
    recordRequest('POST /api/v1/insurance/[id]/claims', 422, Date.now() - start);
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

  const proof = addClaimProof({ coverageId: id, ...parsed.data });
  if (!proof) {
    return withCors(
      request,
      apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to add claim proof'),
    );
  }

  recordRequest('POST /api/v1/insurance/[id]/claims', 201, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(proof, { status: 201 })));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('PATCH /api/v1/insurance/[id]/claims', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(
      request,
      apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid JSON body'),
    );
  }

  const parsed = UpdateClaimSchema.safeParse(body);
  if (!parsed.success) {
    recordRequest('PATCH /api/v1/insurance/[id]/claims', 422, Date.now() - start);
    return withCors(
      request,
      apiError(request, 422, ErrorCode.VALIDATION_ERROR, 'Validation failed'),
    );
  }

  const updated = updateClaimProofStatus(
    id,
    parsed.data.claimId,
    parsed.data.status as ClaimProofStatus,
    parsed.data.verifierNotes,
  );

  if (!updated) {
    recordRequest('PATCH /api/v1/insurance/[id]/claims', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, 'Coverage or claim not found'),
    );
  }

  recordRequest('PATCH /api/v1/insurance/[id]/claims', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(updated, { status: 200 })));
}
