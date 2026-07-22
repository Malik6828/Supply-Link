'use client';

import { useState } from 'react';
import {
  Shield,
  ShieldOff,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Plus,
  Loader2,
  ExternalLink,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import type { WarrantyInfo, WarrantyClaim, ClaimStatus } from '@/lib/types';
import {
  registerWarranty,
  fileWarrantyClaim,
  updateClaimStatus,
  voidWarranty,
} from '@/lib/stellar/client';
import { useWalletAddress } from '@/lib/state/selectors/wallet';
import { useToast } from '@/lib/hooks/useToast';

interface Props {
  productId: string;
  productTimestamp: number;
  warranty?: WarrantyInfo;
  warrantyClaims?: WarrantyClaim[];
  isOwner?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDuration(seconds: number): string {
  if (seconds === 0) return 'Lifetime';
  const years = Math.floor(seconds / (365 * 24 * 3600));
  const months = Math.floor((seconds % (365 * 24 * 3600)) / (30 * 24 * 3600));
  const days = Math.floor((seconds % (30 * 24 * 3600)) / (24 * 3600));
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  if (days > 0 && years === 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  return parts.join(', ') || '< 1 day';
}

function isActive(warranty: WarrantyInfo, productTimestamp: number): boolean {
  if (warranty.voided) return false;
  if (warranty.durationSeconds === 0) return true;
  const expiryMs = productTimestamp + warranty.durationSeconds * 1000;
  return Date.now() <= expiryMs;
}

function expiryDate(warranty: WarrantyInfo, productTimestamp: number): string | null {
  if (warranty.durationSeconds === 0) return null;
  return fmtDate(productTimestamp + warranty.durationSeconds * 1000);
}

const STATUS_CONFIG: Record<ClaimStatus, { label: string; className: string }> = {
  Pending: { label: 'Pending', className: 'bg-amber-500/10 text-amber-600' },
  Approved: { label: 'Approved', className: 'bg-blue-500/10 text-blue-600' },
  Rejected: { label: 'Rejected', className: 'bg-red-500/10 text-red-500' },
  Resolved: { label: 'Resolved', className: 'bg-green-500/10 text-green-600' },
};

// ── Warranty status badge ─────────────────────────────────────────────────────

function WarrantyStatusBadge({
  warranty,
  productTimestamp,
}: {
  warranty: WarrantyInfo;
  productTimestamp: number;
}) {
  if (warranty.voided) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--muted-bg)] text-[var(--muted)] font-medium">
        <ShieldOff size={11} aria-hidden /> Voided
      </span>
    );
  }
  if (isActive(warranty, productTimestamp)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">
        <ShieldCheck size={11} aria-hidden /> Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
      <AlertTriangle size={11} aria-hidden /> Expired
    </span>
  );
}

// ── Register warranty form ────────────────────────────────────────────────────

interface RegisterWarrantyFormProps {
  productId: string;
  onSuccess: (w: WarrantyInfo) => void;
  onCancel: () => void;
}

function RegisterWarrantyForm({ productId, onSuccess, onCancel }: RegisterWarrantyFormProps) {
  const walletAddress = useWalletAddress();
  const toast = useToast();
  const [durationYears, setDurationYears] = useState('1');
  const [isLifetime, setIsLifetime] = useState(false);
  const [terms, setTerms] = useState('');
  const [termsRef, setTermsRef] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) {
      toast.error('Wallet not connected', 'Connect your Freighter wallet first.');
      return;
    }
    const durationSeconds = isLifetime ? 0 : parseInt(durationYears, 10) * 365 * 24 * 3600;
    setPending(true);
    const toastId = toast.loading('Registering warranty on-chain…');
    try {
      await registerWarranty(productId, durationSeconds, terms, termsRef, walletAddress);
      toast.dismiss(toastId);
      toast.success('Warranty registered', 'Warranty metadata saved on-chain.');
      onSuccess({
        productId,
        durationSeconds,
        issuer: walletAddress,
        issuedAt: Date.now(),
        terms,
        termsRef,
        voided: false,
        voidedAt: 0,
      });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error('Registration failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={isLifetime}
            onChange={(e) => setIsLifetime(e.target.checked)}
            className="w-4 h-4 accent-violet-600"
          />
          Lifetime warranty
        </label>
      </div>
      {!isLifetime && (
        <div className="flex flex-col gap-1">
          <label htmlFor="warranty-duration" className="text-xs font-medium">
            Duration (years)
          </label>
          <input
            id="warranty-duration"
            type="number"
            min="1"
            max="99"
            value={durationYears}
            onChange={(e) => setDurationYears(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 w-32"
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="warranty-terms" className="text-xs font-medium">
          Terms <span className="text-[var(--muted)] font-normal">(optional)</span>
        </label>
        <textarea
          id="warranty-terms"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          rows={2}
          maxLength={1024}
          placeholder="Short warranty terms summary…"
          className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="warranty-ref" className="text-xs font-medium">
          Document reference{' '}
          <span className="text-[var(--muted)] font-normal">(IPFS CID or URL, optional)</span>
        </label>
        <input
          id="warranty-ref"
          type="text"
          value={termsRef}
          onChange={(e) => setTermsRef(e.target.value)}
          maxLength={512}
          placeholder="ipfs://Qm… or https://…"
          className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--card-border)] text-sm font-medium hover:bg-[var(--muted-bg)] transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            'Register Warranty'
          )}
        </button>
      </div>
    </form>
  );
}

// ── File claim form ───────────────────────────────────────────────────────────

interface FileClaimFormProps {
  productId: string;
  onSuccess: (claim: WarrantyClaim) => void;
  onCancel: () => void;
}

function FileClaimForm({ productId, onSuccess, onCancel }: FileClaimFormProps) {
  const walletAddress = useWalletAddress();
  const toast = useToast();
  const [description, setDescription] = useState('');
  const [proofRef, setProofRef] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) {
      toast.error('Wallet not connected', 'Connect your Freighter wallet first.');
      return;
    }
    if (!description.trim()) {
      toast.error('Description required', 'Please describe the issue.');
      return;
    }
    const claimId = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPending(true);
    const toastId = toast.loading('Filing warranty claim on-chain…');
    try {
      await fileWarrantyClaim(productId, claimId, description, proofRef, walletAddress);
      toast.dismiss(toastId);
      toast.success('Claim filed', 'Your warranty claim has been recorded on-chain.');
      onSuccess({
        claimId,
        productId,
        claimant: walletAddress,
        filedAt: Date.now(),
        description,
        proofRef,
        status: 'Pending',
        updatedAt: Date.now(),
      });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error('Claim failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="claim-description" className="text-xs font-medium">
          Issue description
        </label>
        <textarea
          id="claim-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={4096}
          required
          placeholder="Describe the defect or issue…"
          className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="claim-proof" className="text-xs font-medium">
          Proof reference{' '}
          <span className="text-[var(--muted)] font-normal">(IPFS CID or URL, optional)</span>
        </label>
        <input
          id="claim-proof"
          type="text"
          value={proofRef}
          onChange={(e) => setProofRef(e.target.value)}
          maxLength={512}
          placeholder="ipfs://Qm… or https://…"
          className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--card-border)] text-sm font-medium hover:bg-[var(--muted-bg)] transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Filing…
            </>
          ) : (
            'File Claim'
          )}
        </button>
      </div>
    </form>
  );
}

// ── Claims list ───────────────────────────────────────────────────────────────

interface ClaimsListProps {
  claims: WarrantyClaim[];
  productId: string;
  isOwner: boolean;
  onStatusUpdate: (claimId: string, status: ClaimStatus) => void;
}

function ClaimsList({ claims, productId, isOwner, onStatusUpdate }: ClaimsListProps) {
  const walletAddress = useWalletAddress();
  const toast = useToast();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function handleStatusChange(claimId: string, newStatus: ClaimStatus) {
    if (!walletAddress) return;
    setUpdatingId(claimId);
    const toastId = toast.loading('Updating claim status…');
    try {
      await updateClaimStatus(productId, claimId, newStatus, walletAddress);
      toast.dismiss(toastId);
      toast.success('Status updated', `Claim marked as ${newStatus}.`);
      onStatusUpdate(claimId, newStatus);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error('Update failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUpdatingId(null);
    }
  }

  if (claims.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No claims filed yet.</p>;
  }

  return (
    <ul className="space-y-3" aria-label="Warranty claims">
      {claims.map((claim) => {
        const cfg = STATUS_CONFIG[claim.status];
        return (
          <li
            key={claim.claimId}
            className="border border-[var(--card-border)] rounded-lg p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="font-mono text-xs text-[var(--muted)] truncate">
                {claim.claimId}
              </span>
              <span
                className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.className}`}
              >
                {cfg.label}
              </span>
            </div>
            <p className="text-[var(--foreground)] mb-1">{claim.description}</p>
            {claim.proofRef && (
              <a
                href={claim.proofRef}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-500 hover:underline mb-1"
              >
                <ExternalLink size={11} aria-hidden /> View proof
              </a>
            )}
            <p className="text-xs text-[var(--muted)]">
              Filed {fmtDate(claim.filedAt)} · Updated {fmtDate(claim.updatedAt)}
            </p>
            {isOwner && claim.status === 'Pending' && (
              <div className="flex gap-2 mt-2">
                {(['Approved', 'Rejected', 'Resolved'] as ClaimStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={updatingId === claim.claimId}
                    onClick={() => handleStatusChange(claim.claimId, s)}
                    className="px-2 py-1 rounded text-xs border border-[var(--card-border)] hover:bg-[var(--muted-bg)] transition-colors disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function WarrantyPanel({
  productId,
  productTimestamp,
  warranty: initialWarranty,
  warrantyClaims: initialClaims = [],
  isOwner = false,
}: Props) {
  const [warranty, setWarranty] = useState<WarrantyInfo | undefined>(initialWarranty);
  const [claims, setClaims] = useState<WarrantyClaim[]>(initialClaims);
  const [expanded, setExpanded] = useState(true);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [voidingPending, setVoidingPending] = useState(false);
  const walletAddress = useWalletAddress();
  const toast = useToast();

  const active = warranty ? isActive(warranty, productTimestamp) : false;
  const expiry = warranty ? expiryDate(warranty, productTimestamp) : null;

  async function handleVoid() {
    if (!walletAddress || !warranty) return;
    setVoidingPending(true);
    const toastId = toast.loading('Voiding warranty on-chain…');
    try {
      await voidWarranty(productId, walletAddress);
      toast.dismiss(toastId);
      toast.success('Warranty voided', 'The warranty has been voided on-chain.');
      setWarranty({ ...warranty, voided: true, voidedAt: Date.now() });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error('Void failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setVoidingPending(false);
    }
  }

  function handleClaimStatusUpdate(claimId: string, status: ClaimStatus) {
    setClaims((prev) =>
      prev.map((c) => (c.claimId === claimId ? { ...c, status, updatedAt: Date.now() } : c)),
    );
  }

  return (
    <div>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-violet-500" aria-hidden />
          <span className="text-sm font-medium text-[var(--foreground)]">Warranty</span>
          {warranty && (
            <WarrantyStatusBadge warranty={warranty} productTimestamp={productTimestamp} />
          )}
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-[var(--muted)]" aria-hidden />
        ) : (
          <ChevronDown size={16} className="text-[var(--muted)]" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {warranty ? (
            <>
              {/* Warranty details */}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-[var(--muted)]">Coverage</dt>
                  <dd className="font-medium mt-0.5">{fmtDuration(warranty.durationSeconds)}</dd>
                </div>
                {expiry && (
                  <div>
                    <dt className="text-xs text-[var(--muted)]">Expires</dt>
                    <dd className="font-medium mt-0.5 flex items-center gap-1">
                      <Clock size={12} aria-hidden className="text-[var(--muted)]" />
                      {expiry}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-[var(--muted)]">Issued</dt>
                  <dd className="font-medium mt-0.5">{fmtDate(warranty.issuedAt)}</dd>
                </div>
                {warranty.voided && (
                  <div>
                    <dt className="text-xs text-[var(--muted)]">Voided</dt>
                    <dd className="font-medium mt-0.5 text-[var(--muted)]">
                      {fmtDate(warranty.voidedAt)}
                    </dd>
                  </div>
                )}
                {warranty.terms && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-[var(--muted)]">Terms</dt>
                    <dd className="mt-0.5 text-[var(--foreground)]">{warranty.terms}</dd>
                  </div>
                )}
                {warranty.termsRef && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-[var(--muted)]">Document</dt>
                    <dd className="mt-0.5">
                      <a
                        href={warranty.termsRef}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-violet-500 hover:underline"
                      >
                        <ExternalLink size={11} aria-hidden /> {warranty.termsRef}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              {/* Owner actions */}
              {isOwner && !warranty.voided && (
                <button
                  type="button"
                  onClick={handleVoid}
                  disabled={voidingPending}
                  className="flex items-center gap-1.5 text-xs text-red-500 hover:underline disabled:opacity-50"
                >
                  {voidingPending ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden />
                  ) : (
                    <ShieldOff size={12} aria-hidden />
                  )}
                  Void warranty
                </button>
              )}

              {/* Claims section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-[var(--foreground)] uppercase tracking-wide">
                    Claims ({claims.length})
                  </h4>
                  {active && !showClaimForm && (
                    <button
                      type="button"
                      onClick={() => setShowClaimForm(true)}
                      className="flex items-center gap-1 text-xs text-violet-500 hover:underline"
                    >
                      <Plus size={11} aria-hidden /> File claim
                    </button>
                  )}
                </div>
                {showClaimForm && (
                  <FileClaimForm
                    productId={productId}
                    onSuccess={(c) => {
                      setClaims((prev) => [...prev, c]);
                      setShowClaimForm(false);
                    }}
                    onCancel={() => setShowClaimForm(false)}
                  />
                )}
                <ClaimsList
                  claims={claims}
                  productId={productId}
                  isOwner={isOwner}
                  onStatusUpdate={handleClaimStatusUpdate}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--muted)]">
                No warranty registered for this product.
              </p>
              {isOwner && !showRegisterForm && (
                <button
                  type="button"
                  onClick={() => setShowRegisterForm(true)}
                  className="flex items-center gap-1.5 text-xs text-violet-500 hover:underline"
                >
                  <Plus size={12} aria-hidden /> Register warranty
                </button>
              )}
              {showRegisterForm && (
                <RegisterWarrantyForm
                  productId={productId}
                  onSuccess={(w) => {
                    setWarranty(w);
                    setShowRegisterForm(false);
                  }}
                  onCancel={() => setShowRegisterForm(false)}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
