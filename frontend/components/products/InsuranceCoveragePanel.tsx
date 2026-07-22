'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
} from 'lucide-react';
import type {
  InsuranceCoverage,
  ClaimProof,
  InsuranceStatus,
  ClaimProofStatus,
} from '@/lib/services/insuranceCoverage';
import {
  listCoverageForProduct,
  addCoverage,
  addClaimProof,
  verifyCoverage,
  formatCoverageAmount,
  isCoverageExpired,
  COVERAGE_STATUS_BADGE,
} from '@/lib/services/insuranceCoverage';

// ── Claim proof card ──────────────────────────────────────────────────────────

const CLAIM_STATUS_BADGE: Record<ClaimProofStatus, string> = {
  pending:
    'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300',
  verified:
    'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400',
};

function ClaimProofCard({ proof }: { proof: ClaimProof }) {
  const filedAt = new Date(proof.filedAt).toLocaleDateString();
  return (
    <div className="rounded border border-[var(--card-border)] bg-[var(--muted-bg)] p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-[var(--foreground)] truncate">{proof.description}</p>
          <p className="text-[var(--muted)] mt-0.5">Filed: {filedAt}</p>
          {proof.proofRef && (
            <p className="text-[var(--muted)] mt-0.5 font-mono truncate">
              Ref: {proof.proofRef}
            </p>
          )}
          {proof.verifierNotes && (
            <p className="text-[var(--muted)] mt-0.5 italic">{proof.verifierNotes}</p>
          )}
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${CLAIM_STATUS_BADGE[proof.status]}`}
        >
          {proof.status.charAt(0).toUpperCase() + proof.status.slice(1)}
        </span>
      </div>
    </div>
  );
}

// ── Coverage card ─────────────────────────────────────────────────────────────

interface CoverageCardProps {
  coverage: InsuranceCoverage;
  productId: string;
  onClaimAdded: () => void;
}

function CoverageCard({ coverage, productId, onClaimAdded }: CoverageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [claimDesc, setClaimDesc] = useState('');
  const [claimRef, setClaimRef] = useState('');
  const [claimant, setClaimant] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const expired = isCoverageExpired(coverage);
  const validFrom = new Date(coverage.validFrom).toLocaleDateString();
  const validUntil =
    coverage.validUntil === 0 ? 'No expiry' : new Date(coverage.validUntil).toLocaleDateString();

  async function handleAddClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!claimDesc.trim() || !claimRef.trim() || !claimant.trim()) {
      setClaimError('All fields are required.');
      return;
    }
    setSubmitting(true);
    setClaimError(null);
    try {
      addClaimProof({
        coverageId: coverage.id,
        productId,
        description: claimDesc.trim(),
        proofRef: claimRef.trim(),
        claimant: claimant.trim(),
      });
      setClaimDesc('');
      setClaimRef('');
      setClaimant('');
      setShowClaimForm(false);
      onClaimAdded();
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Failed to add claim');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="coverage-card"
      data-coverage-id={coverage.id}
      data-coverage-status={coverage.status}
      className={`rounded-lg border p-4 ${
        expired
          ? 'border-[var(--card-border)] opacity-70 bg-[var(--muted-bg)]'
          : 'border-[var(--card-border)] bg-[var(--card)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Shield
            size={16}
            className={`shrink-0 mt-0.5 ${expired ? 'text-[var(--muted)]' : 'text-green-600 dark:text-green-400'}`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--foreground)] truncate" data-testid="coverage-provider">
              {coverage.provider}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {coverage.coverageType} · Policy {coverage.policyNumber}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {formatCoverageAmount(coverage.coverageAmount, coverage.currency)} coverage
            </p>
            <p className="text-xs text-[var(--muted)]">
              {validFrom} – {validUntil}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            data-testid="coverage-status-badge"
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${COVERAGE_STATUS_BADGE[coverage.status]}`}
          >
            {coverage.status.charAt(0).toUpperCase() + coverage.status.slice(1)}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            data-testid="coverage-expand-btn"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-3">
          {/* Document reference */}
          {coverage.documentRef && (
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <FileText size={12} aria-hidden="true" />
              <span className="font-medium text-[var(--foreground)]">Policy document:</span>
              <span className="font-mono truncate">{coverage.documentRef}</span>
            </div>
          )}

          {/* Claim proofs */}
          {coverage.claimProofs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--foreground)] mb-2">
                Claim Proofs ({coverage.claimProofs.length})
              </p>
              <div className="space-y-2">
                {coverage.claimProofs.map((proof) => (
                  <ClaimProofCard key={proof.id} proof={proof} />
                ))}
              </div>
            </div>
          )}

          {/* Add claim form */}
          {!showClaimForm ? (
            <button
              type="button"
              onClick={() => setShowClaimForm(true)}
              className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              data-testid="add-claim-btn"
            >
              <Plus size={12} />
              Add claim proof
            </button>
          ) : (
            <form onSubmit={handleAddClaim} className="space-y-2" data-testid="claim-form">
              <p className="text-xs font-semibold text-[var(--foreground)]">New claim proof</p>
              {claimError && (
                <p className="text-xs text-red-600 dark:text-red-400" data-testid="claim-error">{claimError}</p>
              )}
              <input
                type="text"
                value={claimDesc}
                onChange={(e) => setClaimDesc(e.target.value)}
                placeholder="Claim description"
                className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                required
                data-testid="claim-description-input"
              />
              <input
                type="text"
                value={claimRef}
                onChange={(e) => setClaimRef(e.target.value)}
                placeholder="Proof reference (IPFS CID, URL, etc.)"
                className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                required
                data-testid="claim-proof-ref-input"
              />
              <input
                type="text"
                value={claimant}
                onChange={(e) => setClaimant(e.target.value)}
                placeholder="Claimant address (G...)"
                className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                required
                data-testid="claim-claimant-input"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="text-xs font-semibold px-3 py-1.5 rounded bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  data-testid="claim-submit-btn"
                >
                  {submitting ? 'Submitting…' : 'Submit claim'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowClaimForm(false)}
                  className="text-xs px-3 py-1.5 rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add coverage form ─────────────────────────────────────────────────────────

interface AddCoverageFormProps {
  productId: string;
  onAdded: () => void;
  onCancel: () => void;
}

function AddCoverageForm({ productId, onAdded, onCancel }: AddCoverageFormProps) {
  const [provider, setProvider] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [coverageType, setCoverageType] = useState('product liability');
  const [coverageAmount, setCoverageAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [registeredBy, setRegisteredBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!provider.trim() || !policyNumber.trim() || !coverageAmount || !registeredBy.trim()) {
      setError('Provider, policy number, coverage amount, and registrar are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      addCoverage({
        productId,
        provider: provider.trim(),
        policyNumber: policyNumber.trim(),
        coverageType: coverageType.trim(),
        coverageAmount: Math.round(parseFloat(coverageAmount) * 100),
        currency,
        validFrom: validFrom ? new Date(validFrom).getTime() : Date.now(),
        validUntil: validUntil ? new Date(validUntil).getTime() : 0,
        documentRef: documentRef.trim() || undefined,
        registeredBy: registeredBy.trim(),
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add coverage');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 pt-3 border-t border-[var(--card-border)]" data-testid="add-coverage-form">
      <p className="text-xs font-semibold text-[var(--foreground)]">Add insurance coverage</p>
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400" data-testid="add-coverage-error">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[
          { label: 'Provider', value: provider, setter: setProvider, placeholder: 'Acme Insurance' },
          { label: 'Policy number', value: policyNumber, setter: setPolicyNumber, placeholder: 'POL-12345' },
          { label: 'Coverage type', value: coverageType, setter: setCoverageType, placeholder: 'product liability' },
          { label: `Amount (${currency})`, value: coverageAmount, setter: setCoverageAmount, placeholder: '100000', type: 'number' },
          { label: 'Currency', value: currency, setter: setCurrency, placeholder: 'USD' },
          { label: 'Registrar address', value: registeredBy, setter: setRegisteredBy, placeholder: 'G...' },
          { label: 'Valid from', value: validFrom, setter: setValidFrom, placeholder: '', type: 'date' },
          { label: 'Valid until (leave blank = no expiry)', value: validUntil, setter: setValidUntil, placeholder: '', type: 'date' },
        ].map(({ label, value, setter, placeholder, type }) => (
          <div key={label}>
            <label className="block text-xs text-[var(--muted)] mb-1">{label}</label>
            <input
              type={type ?? 'text'}
              value={value}
              onChange={(e) => setter(e.target.value)}
              placeholder={placeholder}
              className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="block text-xs text-[var(--muted)] mb-1">
            Policy document ref (optional)
          </label>
          <input
            type="text"
            value={documentRef}
            onChange={(e) => setDocumentRef(e.target.value)}
            placeholder="IPFS CID or URL"
            className="w-full text-xs rounded border border-[var(--card-border)] bg-[var(--background)] px-2 py-1.5 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs font-semibold px-3 py-1.5 rounded bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          data-testid="add-coverage-submit-btn"
        >
          {submitting ? 'Adding…' : 'Add coverage'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-[var(--card-border)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface InsuranceCoveragePanelProps {
  productId: string;
  /** Whether to show the add coverage form (owner / admin only). */
  canAdd?: boolean;
}

/**
 * Displays insurance coverage metadata and claim proof references for a product.
 * Shows active and historical policies, and allows filing claim proofs.
 */
export function InsuranceCoveragePanel({ productId, canAdd = false }: InsuranceCoveragePanelProps) {
  const [coverages, setCoverages] = useState<InsuranceCoverage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      const data = listCoverageForProduct(productId);
      setCoverages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load coverage');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const verification = verifyCoverage(productId);

  return (
    <section aria-label="Insurance coverage" data-testid="insurance-coverage-panel">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {verification.covered ? (
            <ShieldCheck size={16} className="text-green-600 dark:text-green-400" aria-hidden="true" />
          ) : (
            <ShieldAlert size={16} className="text-[var(--muted)]" aria-hidden="true" />
          )}
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Insurance Coverage
          </h3>
          {verification.covered && (
            <span className="text-xs text-green-700 dark:text-green-400 font-medium" data-testid="insurance-total-coverage">
              · {formatCoverageAmount(verification.totalCoverageAmount, verification.currency)} covered
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
          aria-label="Refresh coverage"
          data-testid="insurance-refresh-btn"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 mb-4" data-testid="insurance-error">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {!loading && coverages.length === 0 && (
        <p className="text-sm text-[var(--muted)]" data-testid="insurance-empty">No insurance coverage registered for this product.</p>
      )}

      {coverages.length > 0 && (
        <div className="space-y-3" data-testid="insurance-coverage-list">
          {coverages.map((coverage) => (
            <CoverageCard
              key={coverage.id}
              coverage={coverage}
              productId={productId}
              onClaimAdded={load}
            />
          ))}
        </div>
      )}

      {canAdd && !showAddForm && (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="mt-3 flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          data-testid="insurance-add-coverage-btn"
        >
          <Plus size={12} />
          Add insurance coverage
        </button>
      )}

      {canAdd && showAddForm && (
        <AddCoverageForm
          productId={productId}
          onAdded={() => { setShowAddForm(false); load(); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </section>
  );
}

export default InsuranceCoveragePanel;
