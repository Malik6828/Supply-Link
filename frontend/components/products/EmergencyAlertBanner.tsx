'use client';

import { useState } from 'react';
import { AlertTriangle, X, Bell, ChevronDown, ChevronUp } from 'lucide-react';
import type { EmergencyAlert, AlertSeverity } from '@/lib/services/emergencyAlerts';
import { SEVERITY_BANNER_CLASS, SEVERITY_LABELS } from '@/lib/services/emergencyAlerts';

// ── Severity icon ─────────────────────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: AlertSeverity }) {
  if (severity === 'critical') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-5 w-5 shrink-0"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />;
}

// ── Single alert banner ───────────────────────────────────────────────────────

interface SingleAlertBannerProps {
  alert: EmergencyAlert;
  onAcknowledge?: (alertId: string) => void;
  onDismiss?: (alertId: string) => void;
}

function SingleAlertBanner({ alert, onAcknowledge, onDismiss }: SingleAlertBannerProps) {
  const [expanded, setExpanded] = useState(alert.severity === 'critical');
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const bannerClass = SEVERITY_BANNER_CLASS[alert.severity];
  const severityLabel = SEVERITY_LABELS[alert.severity];
  const createdAt = new Date(alert.createdAt).toLocaleString();

  function handleDismiss() {
    setDismissed(true);
    onDismiss?.(alert.id);
  }

  function handleAcknowledge() {
    onAcknowledge?.(alert.id);
  }

  return (
    <div
      role="alert"
      aria-live={alert.severity === 'critical' ? 'assertive' : 'polite'}
      data-testid={`emergency-alert-${alert.id}`}
      data-alert-severity={alert.severity}
      className={`rounded-lg border-2 px-4 py-3 ${bannerClass}`}
    >
      <div className="flex items-start gap-3">
        <SeverityIcon severity={alert.severity} />

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs font-bold uppercase tracking-wide opacity-75"
              data-testid={`emergency-alert-severity-${alert.id}`}
            >
              {severityLabel} Alert
            </span>
            <span className="text-xs opacity-60">·</span>
            <span className="text-xs opacity-60" data-testid={`emergency-alert-timestamp-${alert.id}`}>{createdAt}</span>
          </div>

          <p className="font-semibold text-sm mt-0.5" data-testid={`emergency-alert-title-${alert.id}`}>{alert.title}</p>

          {/* Expandable message */}
          {expanded && (
            <p className="text-sm mt-1 opacity-90" data-testid={`emergency-alert-message-${alert.id}`}>{alert.message}</p>
          )}

          {/* Action row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              data-testid={`emergency-alert-toggle-${alert.id}`}
              className="text-xs font-medium underline underline-offset-2 opacity-75 hover:opacity-100 flex items-center gap-1"
            >
              {expanded ? (
                <>
                  <ChevronUp size={12} /> Hide details
                </>
              ) : (
                <>
                  <ChevronDown size={12} /> Show details
                </>
              )}
            </button>

            {onAcknowledge && alert.status === 'active' && (
              <button
                type="button"
                onClick={handleAcknowledge}
                data-testid={`emergency-alert-acknowledge-${alert.id}`}
                className="text-xs font-semibold px-2.5 py-1 rounded border border-current opacity-80 hover:opacity-100 transition-opacity"
              >
                Acknowledge
              </button>
            )}
          </div>
        </div>

        {/* Dismiss button — only for non-critical alerts */}
        {alert.severity !== 'critical' && (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss alert"
            data-testid={`emergency-alert-dismiss-${alert.id}`}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Multi-alert banner (stacked) ──────────────────────────────────────────────

interface EmergencyAlertBannerProps {
  alerts: EmergencyAlert[];
  onAcknowledge?: (alertId: string) => void;
  onDismiss?: (alertId: string) => void;
}

/**
 * Displays one or more emergency alerts as prominent banners.
 * Critical alerts are expanded by default and cannot be dismissed.
 * Renders nothing when there are no active alerts.
 */
export function EmergencyAlertBanner({
  alerts,
  onAcknowledge,
  onDismiss,
}: EmergencyAlertBannerProps) {
  const activeAlerts = alerts.filter((a) => a.status === 'active');
  if (activeAlerts.length === 0) return null;

  // Sort: critical first, then by createdAt desc
  const sorted = [...activeAlerts].sort((a, b) => {
    const severityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      warning: 2,
      info: 3,
    };
    const diff = (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
    if (diff !== 0) return diff;
    return b.createdAt - a.createdAt;
  });

  return (
    <div className="space-y-2" aria-label="Emergency alerts" data-testid="emergency-alert-list">
      {sorted.map((alert) => (
        <SingleAlertBanner
          key={alert.id}
          alert={alert}
          onAcknowledge={onAcknowledge}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

// ── Dashboard summary banner ──────────────────────────────────────────────────

interface AlertSummaryBannerProps {
  criticalCount: number;
  totalActiveCount: number;
  onViewAll?: () => void;
}

/**
 * Compact summary banner for the dashboard showing active alert counts.
 * Renders nothing when there are no active alerts.
 */
export function AlertSummaryBanner({
  criticalCount,
  totalActiveCount,
  onViewAll,
}: AlertSummaryBannerProps) {
  if (totalActiveCount === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="emergency-alert-summary-banner"
      className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${
        criticalCount > 0
          ? 'border-red-600 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950 dark:text-red-100'
          : 'border-orange-500 bg-orange-50 text-orange-900 dark:border-orange-400 dark:bg-orange-950 dark:text-orange-100'
      }`}
    >
      <Bell size={18} className="shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">
          {criticalCount > 0
            ? `${criticalCount} critical alert${criticalCount !== 1 ? 's' : ''} require attention`
            : `${totalActiveCount} active alert${totalActiveCount !== 1 ? 's' : ''}`}
        </p>
        {criticalCount > 0 && totalActiveCount > criticalCount && (
          <p className="text-xs opacity-75 mt-0.5">
            {totalActiveCount - criticalCount} additional alert
            {totalActiveCount - criticalCount !== 1 ? 's' : ''} pending
          </p>
        )}
      </div>
      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="text-xs font-semibold underline underline-offset-2 shrink-0 opacity-80 hover:opacity-100"
        >
          View all
        </button>
      )}
    </div>
  );
}

export default EmergencyAlertBanner;
