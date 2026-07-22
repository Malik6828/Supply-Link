import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { notifyWebhooksOfAlert } from '@/lib/webhooks/processor';

/**
 * POST /api/webhooks/recall
 *
 * Webhook endpoint for product recall notifications (#393).
 * Accepts a recall event payload, validates it, and fans it out to all active
 * webhook subscribers via the same WebhookDeliverer/signing primitives used
 * by the rest of the webhooks subsystem (HMAC signing, retry/backoff,
 * dead-lettering).
 */

const RecallPayloadSchema = z.object({
  productId: z.string().min(1, 'productId is required'),
  reason: z.string().min(1, 'reason is required'),
  timestamp: z.number().int().nonnegative(),
});

export type RecallPayload = z.infer<typeof RecallPayloadSchema>;

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RecallPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { productId, reason, timestamp } = parsed.data;

  const result = await notifyWebhooksOfAlert(
    `recall-${randomBytes(6).toString('hex')}`,
    productId,
    productId,
    'critical',
    'Product Recall Alert',
    reason,
    'RECALL_ALERT_PROPAGATED',
  );

  return NextResponse.json(
    {
      ok: result.delivered,
      message: 'Recall notification processed',
      productId,
      timestamp,
      successCount: result.successCount,
      failureCount: result.failureCount,
    },
    { status: 200 },
  );
}
