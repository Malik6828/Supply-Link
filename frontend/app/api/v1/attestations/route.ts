/**
 * POST /api/v1/attestations  — Add an attestation to a product
 * GET  /api/v1/attestations  — List attestations (by productId or issuerAddress)
 *
 * Authentication: auditor tier or higher (x-api-key)
 * Rate limiting: default preset
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateRegistryKey } from '@/lib/api/apiKeyAuth';
import { withIdempotency } from '@/lib/api/idempotency';
import { recordRequest } from '@/lib/api/metrics';
import { attestationCreateBodySchema, attestationListQuerySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody, parseQuery } from '@/lib/api/validation';
import {
  addAttestation,
  listAttestationsForProduct,
  listAttestationsByIssuer,
} from '@/lib/attestations';

export const runtime = 'nodejs';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(request, 'POST /api/v1/attestations', RATE_LIMIT_PRESETS.default);
  if (limited) {
    recordRequest('POST /api/v1/attestations', 429, Date.now() - start);
    return limited;
  }

  // Auditor tier or higher required
  const auth = await authenticateRegistryKey(request, 'auditor', 'POST /api/v1/attestations');
  if (auth.error) {
    recordRequest('POST /api/v1/attestations', 401, Date.now() - start);
    return auth.error;
  }

  const response = await withIdempotency(request, async (req, rawBody) => {
    try {
      const body = parseJsonBody(req, rawBody, attestationCreateBodySchema);
      const record = await addAttestation(body);
      return withCors(req, withCorrelationId(req, NextResponse.json(record, { status: 201 })));
    } catch (error) {
      return withCors(req, handleValidationError(req, error)!);
    }
  });

  recordRequest('POST /api/v1/attestations', response.status, Date.now() - start);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/attestations',
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/attestations', 429, Date.now() - start);
    return limited;
  }

  let query;
  try {
    query = parseQuery(request, attestationListQuerySchema);
  } catch (error) {
    recordRequest('GET /api/v1/attestations', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  const attestations = query.productId
    ? await listAttestationsForProduct(query.productId)
    : await listAttestationsByIssuer(query.issuerAddress!);

  const response = withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ attestations, total: attestations.length }, { status: 200 }),
    ),
  );

  recordRequest('GET /api/v1/attestations', response.status, Date.now() - start);
  return response;
}
