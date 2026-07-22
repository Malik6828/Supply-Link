/**
 * Webhook & delivery-attempt persistence.
 *
 * Backed by the shared KVStore (Vercel KV in production, in-memory Map in
 * dev/test — see lib/kv.ts) instead of a local JSON file, so state survives
 * across serverless invocations.
 *
 * KV layout:
 *   webhook:<id>                                   -> Webhook (JSON)
 *   webhook:list                                   -> string[] of webhook ids
 *   webhook:attempt:<webhookId>:<payloadId>:<n>     -> WebhookDeliveryAttempt (JSON)
 *   webhook:attempt:pending:list                   -> string[] of attempt keys awaiting retry
 *   webhook:deadletter:list                        -> string[] of attempt keys that exhausted retries
 */
import { randomBytes } from 'crypto';
import { kvStore } from '@/lib/kv';
import type { Webhook, WebhookDeliveryAttempt } from './types';
import {
  WEBHOOK_RECORD_TTL_SECONDS,
  WEBHOOK_ATTEMPT_TTL_SECONDS,
  WEBHOOK_DEADLETTER_TTL_SECONDS,
} from './config';

const WEBHOOK_LIST_KEY = 'webhook:list';
const PENDING_ATTEMPTS_LIST_KEY = 'webhook:attempt:pending:list';
const DEADLETTER_LIST_KEY = 'webhook:deadletter:list';

function webhookKey(id: string): string {
  return `webhook:${id}`;
}

function attemptKey(webhookId: string, payloadId: string, attemptNumber: number): string {
  return `webhook:attempt:${webhookId}:${payloadId}:${attemptNumber}`;
}

// ── Generic list-index helpers ────────────────────────────────────────────────

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

// ── Idempotency helper (used by the processing tick) ─────────────────────────

/**
 * Attempt to claim a one-time key. Returns true the first time it's called for
 * a given key within the TTL window, false on every subsequent call — allowing
 * callers to dedupe repeated/concurrent work.
 */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  const existing = await kvStore.get(key);
  if (existing) return false;
  await kvStore.set(key, '1', ttlSeconds);
  return true;
}

// ── Webhook CRUD ──────────────────────────────────────────────────────────────

/**
 * Read all webhooks from storage
 */
export async function getWebhooks(): Promise<Webhook[]> {
  const ids = await readList(WEBHOOK_LIST_KEY);
  const webhooks = await Promise.all(ids.map((id) => getWebhookById(id)));
  return webhooks.filter((w): w is Webhook => w !== null);
}

/**
 * Get a single webhook by ID
 */
export async function getWebhookById(id: string): Promise<Webhook | null> {
  const raw = await kvStore.get(webhookKey(id));
  if (!raw) return null;
  return JSON.parse(raw) as Webhook;
}

/**
 * Create a new webhook registration
 * @throws {Error} if the URL is not a valid HTTPS URL (HTTP allowed only for localhost)
 */
export async function createWebhook(url: string, providedSecret?: string): Promise<Webhook> {
  // Validate URL: must be HTTPS (or HTTP for localhost in development)
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`);
  }
  const isLocalhost =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalhost)) {
    throw new Error(`Webhook URL must use HTTPS (got ${parsed.protocol}//)`);
  }

  const id = randomBytes(16).toString('hex');
  const secret = providedSecret || randomBytes(32).toString('hex');
  const now = Date.now();

  const webhook: Webhook = {
    id,
    url,
    secret,
    active: true,
    createdAt: now,
    updatedAt: now,
    failureCount: 0,
  };

  await kvStore.set(webhookKey(id), JSON.stringify(webhook), WEBHOOK_RECORD_TTL_SECONDS);
  await addToList(WEBHOOK_LIST_KEY, id, WEBHOOK_RECORD_TTL_SECONDS);

  return webhook;
}

/**
 * Update webhook (e.g., toggle active status)
 */
export async function updateWebhook(
  id: string,
  updates: Partial<Webhook>,
): Promise<Webhook | null> {
  const webhook = await getWebhookById(id);
  if (!webhook) return null;

  const updated: Webhook = {
    ...webhook,
    ...updates,
    id: webhook.id, // Ensure ID doesn't change
    updatedAt: Date.now(),
  };

  await kvStore.set(webhookKey(id), JSON.stringify(updated), WEBHOOK_RECORD_TTL_SECONDS);

  return updated;
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(id: string): Promise<boolean> {
  const webhook = await getWebhookById(id);
  if (!webhook) return false;

  await kvStore.del(webhookKey(id));
  await removeFromList(WEBHOOK_LIST_KEY, id, WEBHOOK_RECORD_TTL_SECONDS);

  // Also delete associated subscriptions
  try {
    const { deleteSubscriptionsByWebhookId } = await import('./subscriptions');
    await deleteSubscriptionsByWebhookId(id);
  } catch (err) {
    console.error('Failed to delete subscriptions for webhook:', err);
    // Don't fail the webhook deletion if subscription cleanup fails
  }

  return true;
}

/**
 * Get active webhooks
 */
export async function getActiveWebhooks(): Promise<Webhook[]> {
  const webhooks = await getWebhooks();
  return webhooks.filter((w) => w.active);
}

// ── Delivery attempts ─────────────────────────────────────────────────────────

/**
 * Record a webhook delivery attempt.
 * Attempts left 'pending' are tracked for the retry tick; attempts that land in
 * a terminal 'failed' state (retries exhausted) are recorded as dead letters.
 */
export async function recordDeliveryAttempt(attempt: WebhookDeliveryAttempt): Promise<void> {
  const key = attemptKey(attempt.webhookId, attempt.payloadId, attempt.attemptNumber);
  await kvStore.set(key, JSON.stringify(attempt), WEBHOOK_ATTEMPT_TTL_SECONDS);

  if (attempt.status === 'pending') {
    await addToList(PENDING_ATTEMPTS_LIST_KEY, key, WEBHOOK_ATTEMPT_TTL_SECONDS);
  } else if (attempt.status === 'failed') {
    await addToList(DEADLETTER_LIST_KEY, key, WEBHOOK_DEADLETTER_TTL_SECONDS);
  }
}

/**
 * Get pending delivery attempts that are due for retry
 */
export async function getPendingDeliveryAttempts(
  now: number = Date.now(),
): Promise<WebhookDeliveryAttempt[]> {
  const keys = await readList(PENDING_ATTEMPTS_LIST_KEY);
  const attempts: WebhookDeliveryAttempt[] = [];

  for (const key of keys) {
    const raw = await kvStore.get(key);
    if (!raw) {
      // Expired/missing — drop it from the index.
      await removeFromList(PENDING_ATTEMPTS_LIST_KEY, key, WEBHOOK_ATTEMPT_TTL_SECONDS);
      continue;
    }
    const attempt = JSON.parse(raw) as WebhookDeliveryAttempt;
    if (
      attempt.status === 'pending' &&
      attempt.nextRetryAt !== undefined &&
      attempt.nextRetryAt <= now
    ) {
      attempts.push(attempt);
    }
  }

  return attempts;
}

/**
 * Update a delivery attempt's status in storage
 */
export async function updateDeliveryAttempt(
  payloadId: string,
  webhookId: string,
  attemptNumber: number,
  updates: Partial<WebhookDeliveryAttempt>,
): Promise<void> {
  const key = attemptKey(webhookId, payloadId, attemptNumber);
  const raw = await kvStore.get(key);
  if (!raw) return;

  const existing = JSON.parse(raw) as WebhookDeliveryAttempt;
  const updated: WebhookDeliveryAttempt = { ...existing, ...updates, updatedAt: Date.now() };
  await kvStore.set(key, JSON.stringify(updated), WEBHOOK_ATTEMPT_TTL_SECONDS);

  if (updated.status !== 'pending') {
    await removeFromList(PENDING_ATTEMPTS_LIST_KEY, key, WEBHOOK_ATTEMPT_TTL_SECONDS);
  }
  if (updated.status === 'failed') {
    await addToList(DEADLETTER_LIST_KEY, key, WEBHOOK_DEADLETTER_TTL_SECONDS);
  }
}

/**
 * Get dead-lettered delivery attempts (retries exhausted without success).
 */
export async function getDeadLetterDeliveries(): Promise<WebhookDeliveryAttempt[]> {
  const keys = await readList(DEADLETTER_LIST_KEY);
  const attempts: WebhookDeliveryAttempt[] = [];

  for (const key of keys) {
    const raw = await kvStore.get(key);
    if (raw) attempts.push(JSON.parse(raw) as WebhookDeliveryAttempt);
  }

  return attempts;
}

/**
 * Update a webhook's last delivery info
 */
export async function updateWebhookDelivery(
  webhookId: string,
  status: number,
  success: boolean,
): Promise<void> {
  const webhook = await getWebhookById(webhookId);
  if (!webhook) return;

  await updateWebhook(webhookId, {
    lastDeliveryAt: Date.now(),
    lastDeliveryStatus: status,
    failureCount: success ? 0 : webhook.failureCount + 1,
  });
}

/**
 * Get recently failed webhooks (for potential deactivation)
 */
export async function getFailedWebhooks(maxFailures: number = 5): Promise<Webhook[]> {
  const webhooks = await getWebhooks();
  return webhooks.filter((w) => w.active && w.failureCount >= maxFailures);
}
