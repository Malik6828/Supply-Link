/**
 * GET  /api/v1/alerts        – list emergency alerts (optionally filtered by productId)
 * POST /api/v1/alerts        – create a new emergency alert
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
  createAlert,
  listAlerts,
  listActiveAlerts,
  getAlertStats,
} from '@/lib/services/emergencyAlerts';
import type { AlertSeverity, AlertChannel } from '@/lib/services/emergencyAlerts';
import { notifyWebhooksOfProductEvent } from '@/lib/webhooks/processor';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

const CreateAlertSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  severity: z.enum(['info', 'warning', 'high', 'critical']),
  distribution: z.object({
    channels: z.array(z.enum(['in-app', 'webhook', 'email'])).min(1),
    recipients: z.array(z.string()).default([]),
    requireAcknowledgement: z.boolean().default(false),
  }),
  createdBy: z.string().min(1),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/alerts',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/alerts', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/alerts', 401, Date.now() - start);
    return auth.error;
  }

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get('productId') ?? undefined;
  const activeOnly = searchParams.get('active') === 'true';

  const alerts = activeOnly ? listActiveAlerts(productId) : listAlerts(productId);
  const stats = getAlertStats();

  recordRequest('GET /api/v1/alerts', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ alerts, stats, total: alerts.length }, { status: 200 }),
    ),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/alerts',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/alerts', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('POST /api/v1/alerts', 401, Date.now() - start);
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

  const parsed = CreateAlertSchema.safeParse(body);
  if (!parsed.success) {
    recordRequest('POST /api/v1/alerts', 422, Date.now() - start);
    return withCors(
      request,
      apiError(
        request,
        422,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed: ' + parsed.error.issues.map((i) => i.message).join(', '),
      ),
    );
  }

  const alert = createAlert(parsed.data);

  // Fan out to webhook subscribers if webhook channel is enabled
  if (parsed.data.distribution.channels.includes('webhook')) {
    void notifyWebhooksOfProductEvent('product_updated', parsed.data.productId, {
      alertId: alert.id,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
    }).catch((err) => console.error('[alerts] webhook delivery failed:', err));
  }

  recordRequest('POST /api/v1/alerts', 201, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(alert, { status: 201 })));
}
