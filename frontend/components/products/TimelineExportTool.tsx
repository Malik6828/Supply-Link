'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface ExportState {
  selectedProducts: string[];
  format: 'json' | 'csv';
  loading: boolean;
  error: string | null;
  success: boolean;
}

export function TimelineExportTool() {
  const [state, setState] = useState<ExportState>({
    selectedProducts: [],
    format: 'json',
    loading: false,
    error: null,
    success: false,
  });

  const handleExport = async () => {
    if (state.selectedProducts.length === 0) {
      setState((s) => ({ ...s, error: 'Select at least one product' }));
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null, success: false }));

    try {
      const res = await fetch('/api/v1/products/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: state.selectedProducts,
          format: state.format,
        }),
      });

      if (!res.ok) {
        throw new Error('Export failed');
      }

      // Get filename from Content-Disposition header
      const contentDisposition = res.headers.get('Content-Disposition');
      const filename = contentDisposition
        ? contentDisposition.split('filename="')[1]?.split('"')[0] || `export.${state.format}`
        : `export.${state.format}`;

      // Download file
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setState((s) => ({ ...s, loading: false, success: true }));
      setTimeout(() => setState((s) => ({ ...s, success: false })), 3000);
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Export failed',
        loading: false,
      }));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Timeline Export for Regulatory Reporting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Select Products</label>
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-3">
              {/* Product selection would go here */}
              <p className="text-sm text-gray-500">Product selector component</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Export Format</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="format"
                  value="json"
                  checked={state.format === 'json'}
                  onChange={(e) =>
                    setState((s) => ({ ...s, format: e.target.value as 'json' | 'csv' }))
                  }
                  className="mr-2"
                />
                <span className="text-sm">JSON</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="format"
                  value="csv"
                  checked={state.format === 'csv'}
                  onChange={(e) =>
                    setState((s) => ({ ...s, format: e.target.value as 'json' | 'csv' }))
                  }
                  className="mr-2"
                />
                <span className="text-sm">CSV</span>
              </label>
            </div>
          </div>

          <Button
            onClick={handleExport}
            disabled={state.loading || state.selectedProducts.length === 0}
          >
            {state.loading ? 'Exporting...' : 'Export Timeline'}
          </Button>

          {state.error && <div className="text-red-600 text-sm">{state.error}</div>}
          {state.success && (
            <div className="text-green-600 text-sm">Export completed successfully!</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <h4 className="font-semibold mb-1">Included Data</h4>
            <ul className="list-disc list-inside space-y-1 text-gray-600">
              <li>Product registration details</li>
              <li>Complete event timeline with timestamps</li>
              <li>Actor information and locations</li>
              <li>Event metadata and classifications</li>
              <li>Ownership history</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-1">Supported Formats</h4>
            <ul className="list-disc list-inside space-y-1 text-gray-600">
              <li>JSON: Structured format for system integration</li>
              <li>CSV: Spreadsheet format for regulatory analysis</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-1">Compliance</h4>
            <p className="text-gray-600">
              Exports include complete audit trails suitable for regulatory compliance and supply
              chain verification.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
