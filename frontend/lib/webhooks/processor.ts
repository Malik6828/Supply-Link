import { randomBytes } from 'crypto';
import type { TrackingEvent } from '@/lib/types';
import type { WebhookPayload, WebhookEvent, ProductEventType } from './types';
import {
  getActiveWebhooks,
  getFailedWebhooks,
  updateWebhook,
  getWebhookById,
  getPendingDeliveryAttempts,
} from './storage';
import { broadcastWebhook, sendWebhook } from './delivery';
import { getSubscriptionsForEvent, updateSubscriptionTrigger } from './subscriptions';
import { WEBHOOK_FAILURE_THRESHOLD } from './config';

/**
 * Create a webhook event payload from a tracking event
 */
export function createWebhookPayload(event: TrackingEvent): WebhookPayload {
  const webhookEvent: WebhookEvent = {
    type: 'TRACKING_EVENT_CREATED',
    data: {
      productId: event.productId,
      location: event.location,
      actor: event.actor,
      timestamp: event.timestamp,
      eventType: event.eventType,
      metadata: event.metadata,
    },
  };

  return {
    event: webhookEvent,
    timestamp: Date.now(),
    id: randomBytes(8).toString('hex'),
  };
}

/**
 * Create a webhook event payload from a product event change
 */
export function createProductEventPayload(
  eventType: ProductEventType,
  productId: string,
  details: Record<string, any>,
): WebhookPayload {
  const webhookEvent: WebhookEvent = {
    type: 'PRODUCT_EVENT_CHANGED',
    data: {
      eventType,
      productId,
      timestamp: Date.now(),
      details,
    },
  };

  return {
    event: webhookEvent,
    timestamp: Date.now(),
    id: randomBytes(8).toString('hex'),
  };
}

/**
 * Send webhooks for a new tracking event
 * This is called when a new event is detected via polling
 */
export async function notifyWebhooksOfEvent(event: TrackingEvent): Promise<{
  delivered: boolean;
  successCount: number;
  failureCount: number;
  failedWebhookIds: string[];
}> {
  try {
    // Check for failed webhooks that should be deactivated
    const failedWebhooks = await getFailedWebhooks(WEBHOOK_FAILURE_THRESHOLD);
    for (const webhook of failedWebhooks) {
      console.warn(`Deactivating webhook ${webhook.id} due to ${webhook.failureCount} failures`);
      await updateWebhook(webhook.id, { active: false });
    }

    // Get all active webhooks
    const webhooks = await getActiveWebhooks();

    if (webhooks.length === 0) {
      return {
        delivered: true,
        successCount: 0,
        failureCount: 0,
        failedWebhookIds: [],
      };
    }

    // Create payload
    const payload = createWebhookPayload(event);

    // Broadcast to all active webhooks
    const result = await broadcastWebhook(webhooks, payload);

    console.log(`Webhook delivery: ${result.successful} successful, ${result.failed} failed`);

    return {
      delivered: true,
      successCount: result.successful,
      failureCount: result.failed,
      failedWebhookIds: result.details.filter((d) => !d.success).map((d) => d.webhookId),
    };
  } catch (err) {
    console.error('Failed to notify webhooks:', err);
    return {
      delivered: false,
      successCount: 0,
      failureCount: 0,
      failedWebhookIds: [],
    };
  }
}

/**
 * Send webhooks for product event changes (product_updated, product_registered, etc.)
 * This is called when product metadata or state changes
 */
export async function notifyWebhooksOfProductEvent(
  eventType: ProductEventType,
  productId: string,
  details: Record<string, any>,
): Promise<{
  delivered: boolean;
  successCount: number;
  failureCount: number;
  failedWebhookIds: string[];
  triggedSubscriptionIds: string[];
}> {
  try {
    // Get subscriptions that match this product event
    const subscriptions = await getSubscriptionsForEvent(
      'PRODUCT_EVENT_CHANGED',
      eventType,
      productId,
    );

    if (subscriptions.length === 0) {
      return {
        delivered: true,
        successCount: 0,
        failureCount: 0,
        failedWebhookIds: [],
        triggedSubscriptionIds: [],
      };
    }

    // Get unique webhooks from subscriptions
    const webhookIds = [...new Set(subscriptions.map((s) => s.webhookId))];
    const webhooks = [];
    for (const id of webhookIds) {
      const webhook = await getWebhookById(id);
      if (webhook && webhook.active) {
        webhooks.push(webhook);
      }
    }

    if (webhooks.length === 0) {
      return {
        delivered: true,
        successCount: 0,
        failureCount: 0,
        failedWebhookIds: [],
        triggedSubscriptionIds: [],
      };
    }

    // Create payload
    const payload = createProductEventPayload(eventType, productId, details);

    // Broadcast to matching webhooks
    const result = await broadcastWebhook(webhooks, payload);

    // Update subscription triggers
    for (const subscription of subscriptions) {
      await updateSubscriptionTrigger(subscription.id);
    }

    console.log(
      `Product event webhook delivery: ${result.successful} successful, ${result.failed} failed`,
    );

    return {
      delivered: true,
      successCount: result.successful,
      failureCount: result.failed,
      failedWebhookIds: result.details.filter((d) => !d.success).map((d) => d.webhookId),
      triggedSubscriptionIds: subscriptions.map((s) => s.id),
    };
  } catch (err) {
    console.error('Failed to notify webhooks of product event:', err);
    return {
      delivered: false,
      successCount: 0,
      failureCount: 0,
      failedWebhookIds: [],
      triggedSubscriptionIds: [],
    };
  }
}

/**
 * Re-attempt to send failed webhook deliveries that are due for retry.
 * Reads pending delivery attempts whose nextRetryAt has passed and retries each one.
 * Safe to call repeatedly/concurrently — attempts that are no longer 'pending'
 * (already resolved by another invocation) are simply skipped by the storage layer.
 */
export async function retryFailedDeliveries(): Promise<void> {
  const pending = await getPendingDeliveryAttempts();
  if (pending.length === 0) return;

  for (const attempt of pending) {
    const webhook = await getWebhookById(attempt.webhookId);
    if (!webhook || !webhook.active) continue;

    // Replay the exact original payload (persisted alongside the attempt) so
    // retries deliver identical content to the original send, not a stub.
    const payload: WebhookPayload = attempt.payloadData
      ? (JSON.parse(attempt.payloadData) as WebhookPayload)
      : {
          id: attempt.payloadId,
          timestamp: Date.now(),
          event: { type: 'TRACKING_EVENT_CREATED', data: {} as any },
        };

    await sendWebhook(webhook, payload, attempt.attemptNumber + 1, attempt.subscriptionId);
  }
}

/**
 * Send webhooks for an emergency alert event.
 * Called when a new alert is created or a recall is propagated.
 */
export async function notifyWebhooksOfAlert(
  alertId: string,
  productId: string,
  productName: string,
  severity: 'info' | 'warning' | 'high' | 'critical',
  title: string,
  message: string,
  eventType: 'EMERGENCY_ALERT_CREATED' | 'RECALL_ALERT_PROPAGATED' = 'EMERGENCY_ALERT_CREATED',
): Promise<{
  delivered: boolean;
  successCount: number;
  failureCount: number;
}> {
  try {
    const webhooks = await getActiveWebhooks();
    if (webhooks.length === 0) {
      return { delivered: true, successCount: 0, failureCount: 0 };
    }

    const payload: WebhookPayload = {
      event: {
        type: eventType,
        data: {
          alertId,
          productId,
          productName,
          severity,
          title,
          message,
          timestamp: Date.now(),
        },
      },
      timestamp: Date.now(),
      id: randomBytes(8).toString('hex'),
    };

    const result = await broadcastWebhook(webhooks, payload);
    console.log(
      `[alerts] webhook delivery: ${result.successful} successful, ${result.failed} failed`,
    );

    return {
      delivered: true,
      successCount: result.successful,
      failureCount: result.failed,
    };
  } catch (err) {
    console.error('[alerts] Failed to notify webhooks of alert:', err);
    return { delivered: false, successCount: 0, failureCount: 0 };
  }
}
