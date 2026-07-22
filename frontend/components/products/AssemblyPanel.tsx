'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Package, ChevronDown, ChevronUp, GitBranch, Plus, X, Loader2 } from 'lucide-react';
import type { ProductAssembly, Product } from '@/lib/types';
import { registerAssembly } from '@/lib/stellar/client';
import { useWalletAddress } from '@/lib/state/selectors/wallet';
import { useToast } from '@/lib/hooks/useToast';

interface Props {
  productId: string;
  assembly?: ProductAssembly;
  /** All products available for selection as components */
  allProducts?: Product[];
  /** Whether the current user is the product owner */
  isOwner?: boolean;
}

/** Truncate a Stellar address for display */
function shortAddr(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Format a Unix-ms timestamp */
function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── Component provenance row ──────────────────────────────────────────────────

function ComponentRow({ componentId }: { componentId: string }) {
  return (
    <li className="flex items-center gap-3 py-2 border-b border-[var(--card-border)] last:border-0">
      <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
        <Package size={14} className="text-violet-500" aria-hidden />
      </span>
      <Link
        href={`/products/${componentId}`}
        className="font-mono text-xs text-violet-500 hover:underline truncate flex-1"
      >
        {componentId}
      </Link>
      <Link
        href={`/products/${componentId}`}
        className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors shrink-0"
        aria-label={`View provenance for ${componentId}`}
      >
        View provenance →
      </Link>
    </li>
  );
}

// ── Register assembly form ────────────────────────────────────────────────────

interface RegisterFormProps {
  productId: string;
  allProducts: Product[];
  onSuccess: (assembly: ProductAssembly) => void;
  onCancel: () => void;
}

function RegisterAssemblyForm({ productId, allProducts, onSuccess, onCancel }: RegisterFormProps) {
  const walletAddress = useWalletAddress();
  const toast = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);

  const eligible = allProducts.filter((p) => p.id !== productId);

  function toggleComponent(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) {
      toast.error('Wallet not connected', 'Connect your Freighter wallet first.');
      return;
    }
    if (selectedIds.length === 0) {
      toast.error('No components selected', 'Select at least one component product.');
      return;
    }

    setPending(true);
    const toastId = toast.loading('Registering assembly on-chain…');
    try {
      await registerAssembly(productId, selectedIds, description, walletAddress);
      toast.dismiss(toastId);
      toast.success('Assembly registered', 'Component relationships saved on-chain.');
      onSuccess({
        parentId: productId,
        componentIds: selectedIds,
        registeredBy: walletAddress,
        registeredAt: Date.now(),
        description,
      });
    } catch (err) {
      toast.dismiss(toastId);
      toast.error('Registration failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium text-[var(--foreground)] mb-2">
          Select component products
        </p>
        {eligible.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No other products available.</p>
        ) : (
          <ul className="max-h-48 overflow-y-auto border border-[var(--card-border)] rounded-lg divide-y divide-[var(--card-border)]">
            {eligible.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--muted-bg)] transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(p.id)}
                    onChange={() => toggleComponent(p.id)}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-[var(--foreground)] block truncate">
                      {p.name}
                    </span>
                    <span className="font-mono text-xs text-[var(--muted)]">{p.id}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="assembly-description"
          className="text-xs font-medium text-[var(--foreground)]"
        >
          Description <span className="text-[var(--muted)] font-normal">(optional)</span>
        </label>
        <textarea
          id="assembly-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={4096}
          placeholder="Describe how these components are assembled…"
          className="px-3 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
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
          disabled={pending || selectedIds.length === 0}
          className="flex-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            'Save Assembly'
          )}
        </button>
      </div>
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function AssemblyPanel({
  productId,
  assembly: initialAssembly,
  allProducts = [],
  isOwner = false,
}: Props) {
  const [assembly, setAssembly] = useState<ProductAssembly | undefined>(initialAssembly);
  const [expanded, setExpanded] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const hasAssembly = assembly && assembly.componentIds.length > 0;

  return (
    <div>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full text-left group"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-violet-500" aria-hidden />
          <span className="text-sm font-medium text-[var(--foreground)]">Assembly Structure</span>
          {hasAssembly && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 font-medium">
              {assembly.componentIds.length} component
              {assembly.componentIds.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-[var(--muted)]" aria-hidden />
        ) : (
          <ChevronDown size={16} className="text-[var(--muted)]" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="mt-4">
          {hasAssembly ? (
            <>
              {/* Assembly metadata */}
              <div className="mb-3 text-xs text-[var(--muted)] space-y-1">
                {assembly.description && (
                  <p className="text-[var(--foreground)] text-sm">{assembly.description}</p>
                )}
                <p>
                  Registered by{' '}
                  <span className="font-mono">{shortAddr(assembly.registeredBy)}</span>
                  {' · '}
                  {fmtDate(assembly.registeredAt)}
                </p>
              </div>

              {/* Component list */}
              <ul className="mb-3" aria-label="Component products">
                {assembly.componentIds.map((id) => (
                  <ComponentRow key={id} componentId={id} />
                ))}
              </ul>

              {/* Provenance note */}
              <p className="text-xs text-[var(--muted)] bg-[var(--muted-bg)] rounded-lg px-3 py-2">
                Each component carries its own on-chain provenance trail. Click a component to
                inspect its full supply-chain history.
              </p>

              {/* Owner: allow updating */}
              {isOwner && !showForm && (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="mt-3 flex items-center gap-1.5 text-xs text-violet-500 hover:underline"
                >
                  <Plus size={12} aria-hidden /> Update assembly
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No assembly relationship registered for this product.
            </p>
          )}

          {/* Register / update form */}
          {isOwner && showForm && (
            <RegisterAssemblyForm
              productId={productId}
              allProducts={allProducts}
              onSuccess={(a) => {
                setAssembly(a);
                setShowForm(false);
              }}
              onCancel={() => setShowForm(false)}
            />
          )}

          {/* Show register button when no assembly yet */}
          {isOwner && !hasAssembly && !showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="mt-3 flex items-center gap-1.5 text-xs text-violet-500 hover:underline"
            >
              <Plus size={12} aria-hidden /> Register assembly
            </button>
          )}
        </div>
      )}
    </div>
  );
}
