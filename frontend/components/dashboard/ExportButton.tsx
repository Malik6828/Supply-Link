'use client';

import { Download } from 'lucide-react';
import type { TrackingEvent } from '@/lib/types';
import { exportToCSV, exportToJSON } from '@/lib/utils/export';

interface ExportButtonProps {
  events: TrackingEvent[];
  format?: 'json' | 'csv';
}

export function ExportButton({ events, format = 'csv' }: ExportButtonProps) {
  function handleExport() {
    const date = new Date().toISOString().slice(0, 10);
    const filename = `supply-link-events-${date}`;
    if (format === 'json') {
      exportToJSON(events, `${filename}.json`);
    } else {
      exportToCSV(events, `${filename}.csv`);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={events.length === 0}
      aria-label={`Export events as ${format.toUpperCase()}`}
      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border border-[var(--card-border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted-bg)] disabled:opacity-40 transition-colors"
    >
      <Download size={13} />
      Export {format.toUpperCase()}
    </button>
  );
}
