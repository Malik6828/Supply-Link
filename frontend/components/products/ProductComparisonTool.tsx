'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ProductComparison } from '@/lib/services/comparisonService';

interface ComparisonState {
  selectedProducts: string[];
  comparison: {
    products: ProductComparison[];
    networkTrustSignals: {
      sharedActors: Record<string, number>;
      sharedLocations: Record<string, number>;
      trustPathStrength: number;
    };
  } | null;
  loading: boolean;
  error: string | null;
}

export function ProductComparisonTool() {
  const [state, setState] = useState<ComparisonState>({
    selectedProducts: [],
    comparison: null,
    loading: false,
    error: null,
  });

  const handleCompare = async () => {
    if (state.selectedProducts.length < 2) {
      setState((s) => ({ ...s, error: 'Select at least 2 products' }));
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await fetch('/api/v1/products/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: state.selectedProducts }),
      });

      if (!res.ok) {
        throw new Error('Comparison failed');
      }

      const data = await res.json();
      setState((s) => ({ ...s, comparison: data, loading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Unknown error',
        loading: false,
      }));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cross-Product Provenance Comparison</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Select Products</label>
            <div className="space-y-2">
              {/* Product selection would go here */}
              <p className="text-sm text-gray-500">Product selector component</p>
            </div>
          </div>

          <Button onClick={handleCompare} disabled={state.loading}>
            {state.loading ? 'Comparing...' : 'Compare Products'}
          </Button>

          {state.error && <div className="text-red-600 text-sm">{state.error}</div>}
        </CardContent>
      </Card>

      {state.comparison && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Provenance Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {state.comparison.products.map((product) => (
                  <div key={product.productId} className="border rounded p-4">
                    <h3 className="font-semibold mb-3">{product.name}</h3>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-600">Events:</span>
                        <span className="ml-2 font-medium">{product.metrics.eventCount}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Actors:</span>
                        <span className="ml-2 font-medium">{product.metrics.actorCount}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Locations:</span>
                        <span className="ml-2 font-medium">{product.metrics.locationCount}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Trust Score:</span>
                        <span className="ml-2 font-medium">
                          {product.metrics.trustScore.toFixed(1)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Completeness:</span>
                        <span className="ml-2 font-medium">
                          {product.metrics.completenessScore.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Network Trust Signals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Trust Path Strength</h4>
                <div className="w-full bg-gray-200 rounded h-2">
                  <div
                    className="bg-green-600 h-2 rounded"
                    style={{
                      width: `${state.comparison.networkTrustSignals.trustPathStrength}%`,
                    }}
                  />
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {state.comparison.networkTrustSignals.trustPathStrength.toFixed(1)}%
                </p>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Shared Actors</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(state.comparison.networkTrustSignals.sharedActors).map(
                    ([actor, count]) => (
                      <span
                        key={actor}
                        className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs"
                      >
                        {actor.slice(0, 8)}... ({count})
                      </span>
                    ),
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Shared Locations</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(state.comparison.networkTrustSignals.sharedLocations).map(
                    ([location, count]) => (
                      <span
                        key={location}
                        className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs"
                      >
                        {location} ({count})
                      </span>
                    ),
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
