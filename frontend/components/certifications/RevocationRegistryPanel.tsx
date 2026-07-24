'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldX, ShieldCheck, RefreshCw, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { RevocationEntry, RevocationType } from '@/lib/services/revocationRegistry';
import {
  listRevocations,
  checkRevocation,
  revokeCredential,
  getRevocationStats,
} from '@/lib/services/revocationRegistry';

// ── Type label map ────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<RevocationType, string> = {
  certification: 'Certification',
  attestation: 'Attestation',
  registry_record: 'Registry Record',
};

// ── Entry card ────────────────────────────────────────────────────────────────

interface RevocationEntryCardProps {
  entry: RevocationEntry;
}

function RevocationEntryCard({ entry }: RevocationEntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const revokedAt = new Date(entry.revokedAt).toLocaleString();

  return (
    <div
      data-testid="revocation-entry"
      data-subject-id={entry.subjectId}
      data-type={entry.type}
      className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <ShieldX size={14} className="shrink-0 mt-0.5 text-red-500" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                data-testid="revocation-type-label"
                className="text-xs font-semibold text-red-700 dark:text-red-400"
              >
                {TYPE_LABELS[entry.type]}
              </span>
              <span className="text-xs text-[var(--muted)]">·</span>
              <span
                data-testid="revocation-timestamp"
                className="text-xs text-[var(--muted)]"
              >
                {revokedAt}
              </span>
            </div>
            <p
              data-testid="revocation-subject-id"
              className="text-xs font-mono text-[var(--foreground)] mt-0.5 truncate"
            >
              {entry.subjectId}
            </p>
            {entry.reason && (
              <p data-testid="revocation-reason" className="text-xs text-[var(--muted)] mt-0.5">
                <span className="font-medium">Reason:</span> {entry.reason}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800 space-y-1 text-xs text-[var(--muted)]">
          <div>
            <span className="font-medium text-[var(--foreground)]">Record ID:</span>{' '}
            <span className="font-mono" data-testid="revocation-record-id">
              {entry.id}
            </span>
          </div>
          <div>
            <span className="font-medium text-[var(--foreground)]">Revoked by:</span>{' '}
            <span
              className="font-mono break-all"
              data-testid="revocation-revoked-by"
            >
              {entry.revokedBy}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Revoke form ───────────────────────────────────────────────────────────────

interface RevokeFormProps {
  productId: string;
  onRevoked: () => void;
}

function RevokeForm({ productId, onRevoked }: RevokeFormProps) {
  const [subjectId, setSubjectId] = useState('');
  const [type, setType] = useState<RevocationType>('certification');
  const [reason, setReason] = useState('');
  const [revokedBy, setRevokedBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subjectId.trim() || !revokedBy.trim()) {
      setError('Subject ID and revoker address are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      revokeCredential({
        subjectId: subjectId.trim(),
        type,
        productId,
        revokedBy: revokedBy.trim(),
        reason: reason.trim() || undefined,
      });
      setSubjectId('');
      setReason('');
      setRevokedBy('');
      onRevoked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke credential');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      data-testid="revoke-credential-form"
      onSubmit={handleSubmit}
      className="space-y-3 pt-3 border-t border-[var(--card-border)]"
    >
      <p className="text-xs font-semibold text-[var(--foreground)]">Revoke a credential</p>

      {error && (
        <div
          data-testid="revoke-form-error"
          className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400"
        >
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-[var(--muted)] mb-1" htmlFor="rev-subject-id">
            Subject ID (cert / attestation ID)
          </label>
          <input
            id="rev-subject-id"
            data-testid="revoke-subject-id-input"
            type="text"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            placeholder="cert-abc123"
            className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            required
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--muted)] mb-1" htmlFor="rev-type">
            Type
          </label>
          <select
            id="rev-type"
            data-testid="revoke-type-select"
            value={type}
            onChange={(e) => setType(e.target.value as RevocationType)}
            className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          >
            <option value="certification">Certification</option>
            <option value="attestation">Attestation</option>
            <option value="registry_record">Registry Record</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-[var(--muted)] mb-1" htmlFor="rev-by">
            Revoker address
          </label>
          <input
            id="rev-by"
            data-testid="revoke-by-input"
            type="text"
            value={revokedBy}
            onChange={(e) => setRevokedBy(e.target.value)}
            placeholder="G..."
            className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            required
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--muted)] mb-1" htmlFor="rev-reason">
            Reason (optional)
          </label>
          <input
            id="rev-reason"
            data-testid="revoke-reason-input"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Expired, Fraudulent"
            className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
      </div>

      <button
        type="submit"
        data-testid="revoke-submit-button"
        disabled={submitting}
        className="text-xs font-semibold px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Revoking…' : 'Revoke credential'}
      </button>
    </form>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface RevocationRegistryPanelProps {
  productId: string;
  /** Whether to show the revoke form (issuer / admin only). */
  canRevoke?: boolean;
}

/**
 * Displays the revocation registry for a product.
 * Shows all revoked credentials and optionally allows new revocations.
 */
export function RevocationRegistryPanel({
  productId,
  canRevoke = false,
}: RevocationRegistryPanelProps) {
  const [entries, setEntries] = useState<RevocationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      const data = listRevocations({ productId });
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load revocations');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section aria-label="Revocation registry" data-testid="revocation-registry-panel">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldX size={16} className="text-[var(--muted)]" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Revocation Registry
            {entries.length > 0 && (
              <span
                data-testid="revocation-registry-count"
                className="ml-2 text-xs font-normal text-red-600 dark:text-red-400"
              >
                ({entries.length} revoked)
              </span>
            )}
          </h3>
        </div>
        <button
          type="button"
          data-testid="revocation-registry-refresh"
          onClick={load}
          disabled={loading}
          className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
          aria-label="Refresh revocation records"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div
          data-testid="revocation-registry-error"
          className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-4"
        >
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div
          data-testid="revocation-registry-empty"
          className="flex items-center gap-2 text-sm text-[var(--muted)]"
        >
          <ShieldCheck size={14} className="text-green-600 dark:text-green-400" />
          No revoked credentials for this product.
        </div>
      )}

      {entries.length > 0 && (
        <div data-testid="revocation-registry-entries" className="space-y-2">
          {entries.map((entry) => (
            <RevocationEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {canRevoke && <RevokeForm productId={productId} onRevoked={load} />}
    </section>
  );
}

export default RevocationRegistryPanel;
