/**
 * Emergency Alert System for critical product recalls and safety notices.
 *
 * Manages alert severity, distribution settings, and delivery tracking
 * across in-app, webhook, and email channels.
 */

import { createCollection } from '@/lib/store';

export type AlertSeverity = 'info' | 'warning' | 'high' | 'critical';
export type AlertChannel = 'in-app' | 'webhook' | 'email';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved' | 'cancelled';

export interface AlertDistributionSettings {
  /** Channels through which this alert should be delivered. */
  channels: AlertChannel[];
  /** Stakeholder IDs / email addresses to notify. */
  recipients: string[];
  /** Whether to repeat the alert until acknowledged. */
  requireAcknowledgement: boolean;
}

export interface EmergencyAlert {
  id: string;
  productId: string;
  productName: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  status: AlertStatus;
  distribution: AlertDistributionSettings;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolvedAt?: number;
  /** Delivery log per recipient per channel. */
  deliveryLog: AlertDeliveryEntry[];
}

export interface AlertDeliveryEntry {
  id: string;
  alertId: string;
  recipient: string;
  channel: AlertChannel;
  status: 'pending' | 'delivered' | 'failed' | 'acknowledged';
  sentAt: number;
  acknowledgedAt?: number;
  error?: string;
}

// ── Persistent store (shared KV repository) ───────────────────────────────────

const alertStore = createCollection<EmergencyAlert>('emergency-alert');

// ── Severity helpers ──────────────────────────────────────────────────────────

export const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  high: 'High',
  critical: 'Critical',
};

export const SEVERITY_BADGE_CLASS: Record<AlertSeverity, string> = {
  info: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
  warning:
    'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700',
  high: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700',
  critical:
    'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700',
};

export const SEVERITY_BANNER_CLASS: Record<AlertSeverity, string> = {
  info: 'border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950 dark:text-blue-100',
  warning:
    'border-yellow-400 bg-yellow-50 text-yellow-900 dark:border-yellow-500 dark:bg-yellow-950 dark:text-yellow-100',
  high: 'border-orange-500 bg-orange-50 text-orange-900 dark:border-orange-400 dark:bg-orange-950 dark:text-orange-100',
  critical:
    'border-red-600 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950 dark:text-red-100',
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createAlert(params: {
  productId: string;
  productName: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  distribution: AlertDistributionSettings;
  createdBy: string;
}): EmergencyAlert {
  const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  const alert: EmergencyAlert = {
    id,
    productId: params.productId,
    productName: params.productName,
    title: params.title,
    message: params.message,
    severity: params.severity,
    status: 'active',
    distribution: params.distribution,
    createdBy: params.createdBy,
    createdAt: now,
    updatedAt: now,
    deliveryLog: [],
  };

  // Seed delivery log entries
  for (const recipient of params.distribution.recipients) {
    for (const channel of params.distribution.channels) {
      alert.deliveryLog.push({
        id: `dlv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        alertId: id,
        recipient,
        channel,
        status: 'pending',
        sentAt: now,
      });
    }
  }

  alertStore.set(id, alert);
  return alert;
}

export function getAlert(id: string): EmergencyAlert | null {
  return alertStore.get(id) ?? null;
}

export function listAlerts(productId?: string): EmergencyAlert[] {
  const all = alertStore.all();
  return productId ? all.filter((a) => a.productId === productId) : all;
}

export function listActiveAlerts(productId?: string): EmergencyAlert[] {
  return listAlerts(productId).filter((a) => a.status === 'active');
}

export function acknowledgeAlert(id: string, acknowledgedBy: string): EmergencyAlert | null {
  const alert = alertStore.get(id);
  if (!alert || alert.status !== 'active') return null;

  const now = Date.now();
  alert.status = 'acknowledged';
  alert.acknowledgedBy = acknowledgedBy;
  alert.acknowledgedAt = now;
  alert.updatedAt = now;

  // Mark delivery entries for this recipient as acknowledged
  for (const entry of alert.deliveryLog) {
    if (entry.recipient === acknowledgedBy && entry.status === 'delivered') {
      entry.status = 'acknowledged';
      entry.acknowledgedAt = now;
    }
  }

  alertStore.set(id, alert);
  return alert;
}

export function resolveAlert(id: string): EmergencyAlert | null {
  const alert = alertStore.get(id);
  if (!alert) return null;

  const now = Date.now();
  alert.status = 'resolved';
  alert.resolvedAt = now;
  alert.updatedAt = now;
  alertStore.set(id, alert);
  return alert;
}

export function cancelAlert(id: string): EmergencyAlert | null {
  const alert = alertStore.get(id);
  if (!alert) return null;

  alert.status = 'cancelled';
  alert.updatedAt = Date.now();
  alertStore.set(id, alert);
  return alert;
}

export function markDelivered(alertId: string, recipient: string, channel: AlertChannel): void {
  const alert = alertStore.get(alertId);
  if (!alert) return;

  const entry = alert.deliveryLog.find(
    (e) => e.alertId === alertId && e.recipient === recipient && e.channel === channel,
  );
  if (entry) {
    entry.status = 'delivered';
  }
  alertStore.set(alertId, alert);
}

export function markDeliveryFailed(
  alertId: string,
  recipient: string,
  channel: AlertChannel,
  error: string,
): void {
  const alert = alertStore.get(alertId);
  if (!alert) return;

  const entry = alert.deliveryLog.find(
    (e) => e.alertId === alertId && e.recipient === recipient && e.channel === channel,
  );
  if (entry) {
    entry.status = 'failed';
    entry.error = error;
  }
  alertStore.set(alertId, alert);
}

export function getAlertStats(): {
  total: number;
  active: number;
  critical: number;
  acknowledged: number;
  resolved: number;
} {
  const all = alertStore.all();
  return {
    total: all.length,
    active: all.filter((a) => a.status === 'active').length,
    critical: all.filter((a) => a.severity === 'critical' && a.status === 'active').length,
    acknowledged: all.filter((a) => a.status === 'acknowledged').length,
    resolved: all.filter((a) => a.status === 'resolved').length,
  };
}
