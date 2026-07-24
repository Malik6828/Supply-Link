'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldX,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { CertificationRegistryRecord, CertificationIssuer, CertificationVerificationResult } from '@/lib/types';
import {
  listRegistryRecords,
  verifyCertificationRecord,
  filterActiveRecords,
  filterRevokedRecords,
} from '@/lib/services/certificationRegistry';
import { getCertificationLabel } from '@/lib/certifications';

// ── Record card ───────────────────────────────────────────────────────────────

interface RegistryRecordCardProps {
  record: CertificationRegistryRecord;
  locale?: string;
  onVerify?: (recordId: string) => void;
  verificationResult?: CertificationVerificationResult;
  verifying?: boolean;
}

function RegistryRecordCard({
  record,
  locale,
  onVerify,
  verificationResult,
  verifying,
}: RegistryRecordCardProps) {
  const [expanded, setExpanded] = useState(false);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  const isRevoked = record.revoked;

  return (
    <div
      data-testid="cert-registry-record"
      data-record-id={record.id}
      data-revoked={isRevoked ? 'true' : 'false'}
      className={`rounded-lg border p-4 transition-colors ${
        isRevoked
          ? 'border-[var(--card-border)] opacity-60 bg-[var(--muted-bg)]'
          : 'border-[var(--card-border)] bg-[var(--card)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {isRevoked ? (
            <ShieldX size={16} className="shrink-0 mt-0.5 text-red-500" />
          ) : (
            <ShieldCheck size={16} className="shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
          )}
          <div className="min-w-0">
            <p
              data-testid="cert-record-type"
              className="text-sm font-semibold text-[var(--foreground)] truncate"
            >
              {getCertificationLabel(record.certType)}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              External ID:{' '}
              <span className="font-mono" data-testid="cert-record-external-id">
                {record.externalCertId}
              </span>
            </p>
            <p className="text-xs text-[var(--muted)]">
              Issued: {dateFmt.format(new Date(record.issuedAt))}
              {isRevoked && record.revokedAt > 0 && (
                <> · Revoked: {dateFmt.format(new Date(record.revokedAt))}</>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRevoked && (
            <span
              data-testid="cert-record-revoked-badge"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600 border border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"
            >
              <ShieldX size={10} />
              Revoked
            </span>
          )}

          {!isRevoked && onVerify && (
            <button
              type="button"
              data-testid="cert-verify-button"
              onClick={() => onVerify(record.id)}
              disabled={verifying}
              className="text-xs px-2 py-1 rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--foreground)] transition-colors disabled:opacity-40"
            >
              {verifying ? 'Verifying…' : 'Verify'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Verification result */}
      {verificationResult && (
        <div
          data-testid="cert-verification-result"
          data-valid={verificationResult.valid ? 'true' : 'false'}
          className={`mt-3 flex items-center gap-2 text-xs rounded-md px-3 py-2 ${
            verificationResult.valid
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {verificationResult.valid ? (
            <CheckCircle2 size={13} />
          ) : (
            <XCircle size={13} />
          )}
          {verificationResult.valid
            ? 'Certification verified — record is active and issuer is registered.'
            : 'Verification failed — record has been revoked.'}
          {verificationResult.issuer && (
            <span
              data-testid="cert-verification-issuer"
              className="ml-auto font-medium"
            >
              {verificationResult.issuer.name}
            </span>
          )}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-1.5 text-xs text-[var(--muted)]">
          <div>
            <span className="font-medium text-[var(--foreground)]">Record ID:</span>{' '}
            <span className="font-mono" data-testid="cert-record-id">
              {record.id}
            </span>
          </div>
          <div>
            <span className="font-medium text-[var(--foreground)]">Issuer address:</span>{' '}
            <span className="font-mono break-all" data-testid="cert-record-issuer-address">
              {record.issuerAddress}
            </span>
          </div>
          <div>
            <span className="font-medium text-[var(--foreground)]">Document hash:</span>{' '}
            <span className="font-mono break-all">{record.documentHash}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface CertificationRegistryPanelProps {
  productId: string;
  locale?: string;
}

/**
 * Displays on-chain certification registry records for a product.
 * Each record links the product to an external certificate issued by a
 * registered third-party body. Users can verify records on-demand.
 */
export function CertificationRegistryPanel({ productId, locale }: CertificationRegistryPanelProps) {
  const [records, setRecords] = useState<CertificationRegistryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verificationResults, setVerificationResults] = useState<
    Record<string, CertificationVerificationResult>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listRegistryRecords(productId);
      setRecords(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load certification records');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleVerify = useCallback(
    async (recordId: string) => {
      setVerifying(recordId);
      try {
        const result = await verifyCertificationRecord(productId, recordId);
        setVerificationResults((prev) => ({ ...prev, [recordId]: result }));
      } catch {
        // Verification error — show as invalid
        const failedRecord = records.find((r) => r.id === recordId);
        if (failedRecord) {
          setVerificationResults((prev) => ({
            ...prev,
            [recordId]: { valid: false, record: failedRecord },
          }));
        }
      } finally {
        setVerifying(null);
      }
    },
    [productId, records],
  );

  const activeRecords = filterActiveRecords(records);
  const revokedRecords = filterRevokedRecords(records);
  const displayedRecords = showRevoked ? records : activeRecords;

  return (
    <section aria-label="Certification registry" data-testid="cert-registry-panel">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[var(--muted)]" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Certification Registry
            {activeRecords.length > 0 && (
              <span
                data-testid="cert-registry-active-count"
                className="ml-2 text-xs font-normal text-[var(--muted)]"
              >
                ({activeRecords.length} active)
              </span>
            )}
          </h3>
        </div>
        <button
          type="button"
          data-testid="cert-registry-refresh"
          onClick={() => void load()}
          disabled={loading}
          className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
          aria-label="Refresh registry records"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div
          data-testid="cert-registry-error"
          className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-4"
        >
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {!loading && !error && records.length === 0 && (
        <p data-testid="cert-registry-empty" className="text-sm text-[var(--muted)]">
          No certification registry records for this product.
        </p>
      )}

      {records.length > 0 && (
        <div data-testid="cert-registry-records-list" className="space-y-3">
          <p className="text-xs text-[var(--muted)]">
            Registry records link this product to external certificates issued by registered
            third-party bodies. Click Verify to confirm authenticity on-chain.
          </p>

          {displayedRecords.map((record) => (
            <RegistryRecordCard
              key={record.id}
              record={record}
              locale={locale}
              onVerify={handleVerify}
              verificationResult={verificationResults[record.id]}
              verifying={verifying === record.id}
            />
          ))}

          {revokedRecords.length > 0 && (
            <button
              type="button"
              data-testid="cert-registry-toggle-revoked"
              onClick={() => setShowRevoked((v) => !v)}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {showRevoked
                ? `Hide ${revokedRecords.length} revoked record${revokedRecords.length !== 1 ? 's' : ''}`
                : `Show ${revokedRecords.length} revoked record${revokedRecords.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
