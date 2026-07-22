/**
 * Webhook subscription persistence.
 *
 * Backed by the shared KVStore (Vercel KV in production, in-memory Map in
 * dev/test — see lib/kv.ts) instead of a local JSON file, so state survives
 * across serverless invocations.
 *
 * KV layout:
 *   subscription:<id>     -> WebhookSubscription (JSON)
 *   subscription:list     -> string[] of subscription ids
 */
import { randomBytes } from 'crypto';
import { kvStore } from '@/lib/kv';
import type { WebhookSubscription, WebhookEventType, ProductEventType } from './types';
import { WEBHOOK_RECORD_TTL_SECONDS } from './config';

const SUBSCRIPTION_LIST_KEY = 'subscription:list';

function subscriptionKey(id: string): string {
  return `subscription:${id}`;
}

async function readList(key: string): Promise<string[]> {
  const raw = await kvStore.get(key);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

async function addToList(key: string, value: string, ttlSeconds: number): Promise<void> {
  const list = await readList(key);
  if (!list.includes(value)) {
    list.push(value);
    await kvStore.set(key, JSON.stringify(list), ttlSeconds);
  }
}

async function removeFromList(key: string, value: string, ttlSeconds: number): Promise<void> {
  const list = await readList(key);
  const filtered = list.filter((v) => v !== value);
  if (filtered.length !== list.length) {
    await kvStore.set(key, JSON.stringify(filtered), ttlSeconds);
  }
}

/**
 * Read all subscriptions from storage
 */
export async function getSubscriptions(): Promise<WebhookSubscription[]> {
  const ids = await readList(SUBSCRIPTION_LIST_KEY);
  const subscriptions = await Promise.all(ids.map((id) => getSubscriptionById(id)));
  return subscriptions.filter((s): s is WebhookSubscription => s !== null);
}

/**
 * Get a single subscription by ID
 */
export async function getSubscriptionById(id: string): Promise<WebhookSubscription | null> {
  const raw = await kvStore.get(subscriptionKey(id));
  if (!raw) return null;
  return JSON.parse(raw) as WebhookSubscription;
}

/**
 * Get all subscriptions for a specific webhook
 */
export async function getSubscriptionsByWebhookId(
  webhookId: string,
): Promise<WebhookSubscription[]> {
  const subscriptions = await getSubscriptions();
  return subscriptions.filter((s) => s.webhookId === webhookId);
}

/**
 * Create a new webhook subscription
 */
export async function createSubscription(
  webhookId: string,
  name: string,
  eventTypes: WebhookEventType[],
  options?: {
    description?: string;
    productEventFilter?: {
      types?: ProductEventType[];
      productIds?: string[];
    };
    retryPolicy?: {
      maxRetries?: number;
      backoffMs?: number;
      maxBackoffMs?: number;
    };
  },
): Promise<WebhookSubscription> {
  const id = randomBytes(16).toString('hex');
  const now = Date.now();

  const subscription: WebhookSubscription = {
    id,
    webhookId,
    name,
    description: options?.description,
    eventTypes,
    productEventFilter: options?.productEventFilter,
    retryPolicy: {
      maxRetries: options?.retryPolicy?.maxRetries ?? 5,
      backoffMs: options?.retryPolicy?.backoffMs ?? 1000,
      maxBackoffMs: options?.retryPolicy?.maxBackoffMs ?? 3600000,
    },
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  await kvStore.set(subscriptionKey(id), JSON.stringify(subscription), WEBHOOK_RECORD_TTL_SECONDS);
  await addToList(SUBSCRIPTION_LIST_KEY, id, WEBHOOK_RECORD_TTL_SECONDS);

  return subscription;
}

/**
 * Update a subscription
 */
export async function updateSubscription(
  id: string,
  updates: Partial<WebhookSubscription>,
): Promise<WebhookSubscription | null> {
  const subscription = await getSubscriptionById(id);
  if (!subscription) return null;

  const updated: WebhookSubscription = {
    ...subscription,
    ...updates,
    id: subscription.id, // Ensure ID doesn't change
    webhookId: subscription.webhookId, // Ensure webhook ID doesn't change
    updatedAt: Date.now(),
  };

  await kvStore.set(subscriptionKey(id), JSON.stringify(updated), WEBHOOK_RECORD_TTL_SECONDS);

  return updated;
}

/**
 * Delete a subscription
 */
export async function deleteSubscription(id: string): Promise<boolean> {
  const subscription = await getSubscriptionById(id);
  if (!subscription) return false;

  await kvStore.del(subscriptionKey(id));
  await removeFromList(SUBSCRIPTION_LIST_KEY, id, WEBHOOK_RECORD_TTL_SECONDS);

  return true;
}

/**
 * Get active subscriptions for a specific event type and product
 */
export async function getSubscriptionsForEvent(
  eventType: WebhookEventType,
  productEventType?: ProductEventType,
  productId?: string,
): Promise<WebhookSubscription[]> {
  const subscriptions = await getSubscriptions();

  return subscriptions.filter((sub) => {
    // Must be active
    if (!sub.active) return false;

    // Must support the event type
    if (!sub.eventTypes.includes(eventType)) return false;

    // For product events, check filters
    if (eventType === 'PRODUCT_EVENT_CHANGED') {
      const filter = sub.productEventFilter;
      if (filter) {
        // Check product event type filter
        if (filter.types && filter.types.length > 0 && productEventType) {
          if (!filter.types.includes(productEventType)) return false;
        }

        // Check product ID filter
        if (filter.productIds && filter.productIds.length > 0 && productId) {
          if (!filter.productIds.includes(productId)) return false;
        }
      }
    }

    return true;
  });
}

/**
 * Mark subscription as triggered (update lastTriggeredAt)
 */
export async function updateSubscriptionTrigger(id: string): Promise<WebhookSubscription | null> {
  return updateSubscription(id, {
    lastTriggeredAt: Date.now(),
  });
}

/**
 * Delete all subscriptions for a webhook (called when webhook is deleted)
 */
export async function deleteSubscriptionsByWebhookId(webhookId: string): Promise<number> {
  const subscriptions = await getSubscriptionsByWebhookId(webhookId);

  for (const subscription of subscriptions) {
    await deleteSubscription(subscription.id);
  }

  return subscriptions.length;
}
