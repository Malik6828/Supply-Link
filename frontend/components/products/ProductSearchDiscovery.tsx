'use client';

import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { SearchResult, SavedQuery, SearchFilter } from '@/lib/services/searchService';

interface SearchState {
  searchText: string;
  filters: SearchFilter;
  results: SearchResult | null;
  savedQueries: SavedQuery[];
  loading: boolean;
  error: string | null;
}

export function ProductSearchDiscovery() {
  const [state, setState] = useState<SearchState>({
    searchText: '',
    filters: {},
    results: null,
    savedQueries: [],
    loading: false,
    error: null,
  });

  // debounce handle
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (text: string, filters: SearchFilter) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const start = Date.now();

    try {
      const res = await fetch('/api/v1/products/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, filters, offset: 0, limit: 50 }),
      });

      if (!res.ok) throw new Error('Search failed');

      const data: SearchResult = await res.json();
      const elapsed = Date.now() - start;

      // fire-and-forget analytics
      fetch('/api/v1/products/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _track: true,
          query: text,
          filters,
          resultCount: data.total,
          queryTimeMs: elapsed,
        }),
      }).catch(() => null);

      setState((s) => ({ ...s, results: data, loading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Unknown error',
        loading: false,
      }));
    }
  }, []);

  const triggerSearch = (text: string, filters: SearchFilter) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text, filters), 180);
  };

  const handleTextChange = (text: string) => {
    setState((s) => ({ ...s, searchText: text }));
    triggerSearch(text, state.filters);
  };

  const applyFilter = (patch: Partial<SearchFilter>) => {
    const filters = { ...state.filters, ...patch };
    // Remove undefined keys
    Object.keys(filters).forEach((k) => {
      if (filters[k as keyof SearchFilter] === undefined) delete filters[k as keyof SearchFilter];
    });
    setState((s) => ({ ...s, filters }));
    triggerSearch(state.searchText, filters);
  };

  const handleSaveQuery = async () => {
    try {
      const res = await fetch('/api/v1/products/saved-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Search: ${state.searchText || 'All'}`,
          query: { text: state.searchText, filters: state.filters },
        }),
      });
      if (!res.ok) throw new Error('Failed to save query');
      const saved: SavedQuery = await res.json();
      setState((s) => ({ ...s, savedQueries: [...s.savedQueries, saved] }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Failed to save query',
      }));
    }
  };

  const loadSavedQuery = (q: SavedQuery) => {
    const text = q.query.text ?? '';
    const filters = q.query.filters ?? {};
    setState((s) => ({ ...s, searchText: text, filters }));
    runSearch(text, filters);
  };

  const clearFilters = () => {
    setState((s) => ({ ...s, filters: {} }));
    triggerSearch(state.searchText, {});
  };

  const activeFilterCount = Object.values(state.filters).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Search input */}
      <Card>
        <CardHeader>
          <CardTitle>Product Search &amp; Discovery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="search-input" className="block text-sm font-medium mb-1">
              Search
            </label>
            <input
              id="search-input"
              type="search"
              placeholder='e.g. coffee +organic -recalled  |  "fair trade"  |  Ghana AND active'
              value={state.searchText}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch(state.searchText, state.filters)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Full-text product search"
            />
            <p className="text-xs text-gray-500 mt-1">
              Supports <code>+required</code>, <code>-excluded</code>,{' '}
              <code>&quot;exact phrase&quot;</code>, AND / OR / NOT
            </p>
          </div>

          {/* Hard filters */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="filter-category" className="block text-sm font-medium mb-1">
                Category
              </label>
              <select
                id="filter-category"
                value={state.filters.category ?? ''}
                onChange={(e) => applyFilter({ category: e.target.value || undefined })}
                className="w-full px-3 py-2 border rounded"
              >
                <option value="">All Categories</option>
                <option value="agricultural">Agricultural</option>
                <option value="pharmaceutical">Pharmaceutical</option>
                <option value="electronics">Electronics</option>
                <option value="luxury">Luxury</option>
                <option value="fashion">Fashion</option>
              </select>
            </div>

            <div>
              <label htmlFor="filter-status" className="block text-sm font-medium mb-1">
                Status
              </label>
              <select
                id="filter-status"
                value={state.filters.status ?? ''}
                onChange={(e) =>
                  applyFilter({ status: (e.target.value as 'active' | 'inactive') || undefined })
                }
                className="w-full px-3 py-2 border rounded"
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={() => runSearch(state.searchText, state.filters)}
              disabled={state.loading}
            >
              {state.loading ? 'Searching…' : 'Search'}
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="outline" onClick={clearFilters} aria-label="Clear all filters">
                Clear filters ({activeFilterCount})
              </Button>
            )}
            <Button variant="outline" onClick={handleSaveQuery} disabled={!state.results}>
              Save Query
            </Button>
            {state.results && (
              <span className="text-xs text-gray-500 ml-auto">
                {state.results.total} result{state.results.total !== 1 ? 's' : ''}
                {state.results.queryTimeMs !== undefined && ` · ${state.results.queryTimeMs}ms`}
              </span>
            )}
          </div>

          {state.error && (
            <div role="alert" className="text-red-600 text-sm">
              {state.error}
            </div>
          )}
        </CardContent>
      </Card>

      {state.results && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Faceted sidebar */}
          <aside aria-label="Faceted filters" className="lg:col-span-1 space-y-4">
            {Object.keys(state.results.facets.categories).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Category</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {Object.entries(state.results.facets.categories).map(([cat, count]) => (
                    <button
                      key={cat}
                      onClick={() => applyFilter({ category: cat })}
                      className={`block w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-100 ${state.filters.category === cat ? 'font-semibold text-blue-700 bg-blue-50' : 'text-gray-700'}`}
                      aria-pressed={state.filters.category === cat}
                    >
                      {cat} <span className="text-gray-400 float-right">{count}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}

            {Object.keys(state.results.facets.subcategories).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Subcategory</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {Object.entries(state.results.facets.subcategories).map(([sub, count]) => (
                    <button
                      key={sub}
                      onClick={() => applyFilter({ subcategory: sub })}
                      className={`block w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-100 ${state.filters.subcategory === sub ? 'font-semibold text-blue-700 bg-blue-50' : 'text-gray-700'}`}
                      aria-pressed={state.filters.subcategory === sub}
                    >
                      {sub} <span className="text-gray-400 float-right">{count}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}

            {Object.keys(state.results.facets.statuses).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {Object.entries(state.results.facets.statuses).map(([status, count]) => (
                    <button
                      key={status}
                      onClick={() => applyFilter({ status: status as 'active' | 'inactive' })}
                      className={`block w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-100 ${state.filters.status === status ? 'font-semibold text-blue-700 bg-blue-50' : 'text-gray-700'}`}
                      aria-pressed={state.filters.status === status}
                    >
                      {status} <span className="text-gray-400 float-right">{count}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </aside>

          {/* Results list */}
          <section aria-label="Search results" className="lg:col-span-3 space-y-3">
            {state.results.items.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  No products match your search.
                </CardContent>
              </Card>
            ) : (
              state.results.items.map((product) => (
                <div
                  key={product.id}
                  className="border rounded p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold">{product.name}</h4>
                      <p className="text-sm text-gray-600">
                        {product.origin}
                        {product.category && (
                          <span className="ml-2 text-xs bg-gray-100 px-1 rounded">
                            {product.category}
                          </span>
                        )}
                        {product.subcategory && (
                          <span className="ml-1 text-xs bg-gray-100 px-1 rounded">
                            {product.subcategory}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {product.id} · {product.owner.slice(0, 8)}…
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${product.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                    >
                      {product.active ? 'active' : 'inactive'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}

      {/* Saved queries */}
      {state.savedQueries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Saved Queries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {state.savedQueries.map((q) => (
                <button
                  key={q.id}
                  onClick={() => loadSavedQuery(q)}
                  className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
                >
                  {q.name}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
