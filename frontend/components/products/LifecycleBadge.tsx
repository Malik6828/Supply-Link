'use client';

import type { LifecycleStage, EventType } from '@/lib/types';

interface LifecycleBadgeProps {
  stage: LifecycleStage;
}

const STAGE_CONFIG: Record<
  LifecycleStage,
  { label: string; color: string; next: EventType | null; nextLabel: string | null }
> = {
  Registered: {
    label: 'Registered',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    next: 'HARVEST',
    nextLabel: 'Add Harvest event',
  },
  Harvested: {
    label: 'Harvested',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    next: 'PROCESSING',
    nextLabel: 'Add Processing event',
  },
  Processing: {
    label: 'Processed',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
    next: 'SHIPPING',
    nextLabel: 'Add Shipping event',
  },
  Shipping: {
    label: 'Shipped',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
    next: 'RETAIL',
    nextLabel: 'Add Retail event',
  },
  Retail: {
    label: 'At Retail',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
    next: null,
    nextLabel: null,
  },
  Sold: {
    label: 'Sold',
    color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400',
    next: null,
    nextLabel: null,
  },
  Recalled: {
    label: 'Recalled',
    color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
    next: null,
    nextLabel: null,
  },
  Deactivated: {
    label: 'Deactivated',
    color: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    next: null,
    nextLabel: null,
  },
};

export function LifecycleBadge({ stage }: LifecycleBadgeProps) {
  const cfg = STAGE_CONFIG[stage];
  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.color}`}
      >
        {cfg.label}
      </span>
      {cfg.nextLabel && <span className="text-xs text-[var(--muted)]">Next: {cfg.nextLabel}</span>}
    </div>
  );
}
