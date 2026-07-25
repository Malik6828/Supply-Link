/**
 * POST /api/v1/products/export – export product timeline for regulatory reporting
 *
 * Request body:
 * {
 *   "productIds": ["prod-001"],
 *   "format": "json" | "csv"
 * }
 *
 * Response: File download (application/json or text/csv)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { generateTimelineExport, generateBatchExport } from '@/lib/services/exportService';
import { getEventRepository, getProductRepository } from '@/lib/data';
import { recordRequest } from '@/lib/api/metrics';
import type { Product } from '@/lib/types';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/export',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/export', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/export', 401, Date.now() - start);
    return auth.error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return apiError(request, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid JSON');
  }

  const body = payload as Record<string, unknown>;

  if (!Array.isArray(body.productIds) || body.productIds.length === 0) {
    return apiError(
      request,
      400,
      ErrorCode.VALIDATION_ERROR,
      'productIds must be a non-empty array',
    );
  }

  const format = (body.format === 'csv' ? 'csv' : 'json') as 'csv' | 'json';
  const productIds = body.productIds as string[];

  const productRepository = getProductRepository();
  const products = (
    await Promise.all(productIds.map((id) => productRepository.getById(id)))
  ).filter((p): p is Product => p !== null);

  if (products.length === 0) {
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'No valid products found');
  }

  const allEvents = await getEventRepository().listAll();

  let content: string;
  let contentType: string;
  let filename: string;

  if (products.length === 1) {
    const exp = generateTimelineExport(products[0], allEvents, format);
    content =
      format === 'json'
        ? JSON.stringify(exp, null, 2)
        : generateBatchExport(products, allEvents, format);
    filename = `timeline-${products[0].id}-${Date.now()}.${format}`;
  } else {
    content = generateBatchExport(products, allEvents, format);
    filename = `timeline-batch-${Date.now()}.${format}`;
  }

  contentType = format === 'json' ? 'application/json' : 'text/csv';

  recordRequest('POST /api/v1/products/export', 200, Date.now() - start);

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
