import type { Product } from '@/lib/types';
import { createCollection } from '@/lib/store';

export interface SearchFilter {
  category?: string;
  subcategory?: string;
  owner?: string;
  status?: 'active' | 'inactive';
  minTrustScore?: number;
  dateRange?: {
    from: number;
    to: number;
  };
}

export interface SearchQuery {
  text?: string;
  filters?: SearchFilter;
  offset?: number;
  limit?: number;
}

export interface SavedQuery {
  id: string;
  name: string;
  query: SearchQuery;
  createdAt: number;
  userId: string;
}

export interface SearchFacets {
  categories: Record<string, number>;
  statuses: Record<string, number>;
  owners: Record<string, number>;
  subcategories: Record<string, number>;
}

export interface ScoredProduct {
  product: Product;
  score: number;
}

export interface SearchResult {
  items: Product[];
  total: number;
  offset: number;
  limit: number;
  facets: SearchFacets;
  queryTimeMs?: number;
}

export interface SearchAnalyticsEvent {
  query: string;
  filters: SearchFilter;
  resultCount: number;
  queryTimeMs: number;
  timestamp: number;
  userId?: string;
}

// Persistent storage for saved queries (shared KV repository).
const savedQueries = createCollection<SavedQuery>('saved-query');

// In-memory analytics ring buffer (last 200 events).
// Deliberately process-local: a short-lived best-effort telemetry buffer, not
// a persistence store — losing it on restart is acceptable.
const analyticsBuffer: SearchAnalyticsEvent[] = [];
const ANALYTICS_BUFFER_SIZE = 200;

// Local per-process result cache: key → { result, ts }.
// Deliberately a plain Map, NOT the KV repository — this is a 5s in-process
// memoization of a pure computation, so cross-invocation persistence would add
// cost without benefit. Safe to lose at any time.
const resultCache = new Map<string, { result: SearchResult; ts: number }>();
const CACHE_TTL_MS = 5_000; // 5 s

/**
 * Parse a boolean query string into required (+), excluded (-), and optional terms.
 *
 * Syntax:
 *  - `+term`  – must match
 *  - `-term`  – must NOT match
 *  - `"exact phrase"` – exact phrase match
 *  - bare `term` – optional (boosts score)
 *  - `AND`, `OR`, `NOT` keywords are mapped to +/- prefixes
 */
export interface ParsedQuery {
  required: string[];
  excluded: string[];
  optional: string[];
  phrases: string[];
}

export function parseQuerySyntax(text: string): ParsedQuery {
  const result: ParsedQuery = { required: [], excluded: [], optional: [], phrases: [] };
  if (!text.trim()) return result;

  // Extract quoted phrases first
  const withoutPhrases = text.replace(/"([^"]+)"/g, (_, phrase: string) => {
    result.phrases.push(phrase.toLowerCase());
    return ' ';
  });

  // Normalise boolean keywords – keep operator attached to next token
  const normalised = withoutPhrases
    .replace(/\bAND\s+/g, '+')
    .replace(/\bNOT\s+/g, '-')
    .replace(/\bOR\b/g, ' ');

  // Tokenise
  const tokens = normalised.match(/[+-]?\S+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('+')) {
      const term = token.slice(1).toLowerCase();
      if (term) result.required.push(term);
    } else if (token.startsWith('-')) {
      const term = token.slice(1).toLowerCase();
      if (term) result.excluded.push(term);
    } else {
      result.optional.push(token.toLowerCase());
    }
  }

  return result;
}

/** Return all searchable text fields of a product as a single lowercase string. */
function productSearchCorpus(p: Product): string {
  const parts = [
    p.id,
    p.name,
    p.origin,
    p.owner,
    p.category ?? '',
    p.subcategory ?? '',
    p.hazardClassification ?? '',
    p.recallReason ?? '',
  ];
  // Include certification types if present
  if (p.certifications) {
    parts.push(...p.certifications.map((c) => c.certType));
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Score a product against a parsed query.
 * Returns -1 if the product is disqualified (required term missing or excluded term present).
 */
function scoreProduct(p: Product, parsed: ParsedQuery): number {
  const corpus = productSearchCorpus(p);

  // Excluded terms veto the result immediately
  for (const term of parsed.excluded) {
    if (corpus.includes(term)) return -1;
  }

  // All required terms must be present
  for (const term of parsed.required) {
    if (!corpus.includes(term)) return -1;
  }

  // All phrases must be present
  for (const phrase of parsed.phrases) {
    if (!corpus.includes(phrase)) return -1;
  }

  // Score based on matches
  let score = 0;

  // Required terms: high weight
  for (const term of parsed.required) {
    if (p.name.toLowerCase().includes(term)) score += 10;
    if (p.origin.toLowerCase().includes(term)) score += 5;
    if (p.id.toLowerCase().includes(term)) score += 4;
    score += 3; // base for passing required filter
  }

  // Optional terms: medium weight
  for (const term of parsed.optional) {
    if (corpus.includes(term)) {
      if (p.name.toLowerCase().includes(term)) score += 8;
      else if (p.origin.toLowerCase().includes(term)) score += 4;
      else score += 2;
    }
  }

  // Phrase matches: highest weight
  for (const phrase of parsed.phrases) {
    if (p.name.toLowerCase().includes(phrase)) score += 15;
    else if (corpus.includes(phrase)) score += 7;
  }

  // Boost active products slightly
  if (p.active) score += 1;

  return score;
}

function buildCacheKey(query: SearchQuery): string {
  return JSON.stringify(query);
}

export function searchProducts(products: Product[], query: SearchQuery): SearchResult {
  const start = Date.now();

  // Cache check
  const cacheKey = buildCacheKey(query);
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.result, queryTimeMs: 0 };
  }

  const parsed = parseQuerySyntax(query.text ?? '');
  const hasTextQuery = !!query.text?.trim();

  // Score & filter
  let scored: ScoredProduct[] = [];
  for (const p of products) {
    // Apply hard filters first (fast path)
    if (query.filters) {
      const f = query.filters;
      if (f.category && p.category !== f.category) continue;
      if (f.subcategory && p.subcategory !== f.subcategory) continue;
      if (f.owner && p.owner !== f.owner) continue;
      if (f.status) {
        const pStatus = p.active ? 'active' : 'inactive';
        if (pStatus !== f.status) continue;
      }
      if (f.dateRange) {
        if (p.timestamp < f.dateRange.from || p.timestamp > f.dateRange.to) continue;
      }
    }

    if (hasTextQuery) {
      const s = scoreProduct(p, parsed);
      if (s >= 0) scored.push({ product: p, score: s });
    } else {
      scored.push({ product: p, score: 0 });
    }
  }

  // Sort by relevance (desc), then by timestamp (desc) as tiebreaker
  if (hasTextQuery) {
    scored.sort((a, b) => b.score - a.score || b.product.timestamp - a.product.timestamp);
  } else {
    scored.sort((a, b) => b.product.timestamp - a.product.timestamp);
  }

  // Build facets from the full filtered result set (before pagination)
  const facets: SearchFacets = {
    categories: {},
    statuses: {},
    owners: {},
    subcategories: {},
  };
  for (const { product: p } of scored) {
    if (p.category) facets.categories[p.category] = (facets.categories[p.category] ?? 0) + 1;
    if (p.subcategory)
      facets.subcategories[p.subcategory] = (facets.subcategories[p.subcategory] ?? 0) + 1;
    const status = p.active ? 'active' : 'inactive';
    facets.statuses[status] = (facets.statuses[status] ?? 0) + 1;
    facets.owners[p.owner] = (facets.owners[p.owner] ?? 0) + 1;
  }

  // Pagination
  const offset = query.offset ?? 0;
  const limit = Math.min(query.limit ?? 50, 100);
  const items = scored.slice(offset, offset + limit).map((s) => s.product);

  const queryTimeMs = Date.now() - start;

  const result: SearchResult = {
    items,
    total: scored.length,
    offset,
    limit,
    facets,
    queryTimeMs,
  };

  // Store in cache
  resultCache.set(cacheKey, { result, ts: Date.now() });

  return result;
}

/** Track a search analytics event. */
export function trackSearchEvent(event: SearchAnalyticsEvent): void {
  analyticsBuffer.push(event);
  if (analyticsBuffer.length > ANALYTICS_BUFFER_SIZE) {
    analyticsBuffer.shift();
  }
}

/** Get recent analytics events (for dashboard / optimisation). */
export function getSearchAnalytics(limit: number = 50): SearchAnalyticsEvent[] {
  return analyticsBuffer.slice(-limit);
}

/** Return popular search terms from the analytics buffer. */
export function getPopularSearchTerms(topN: number = 10): Array<{ term: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const ev of analyticsBuffer) {
    if (ev.query.trim()) {
      const term = ev.query.trim().toLowerCase();
      counts[term] = (counts[term] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([term, count]) => ({ term, count }));
}

/** Return queries that produced zero results. */
export function getZeroResultQueries(limit: number = 20): SearchAnalyticsEvent[] {
  return analyticsBuffer.filter((e) => e.resultCount === 0).slice(-limit);
}

export function saveQuery(userId: string, name: string, query: SearchQuery): SavedQuery {
  const id = `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const saved: SavedQuery = { id, name, query, createdAt: Date.now(), userId };
  savedQueries.set(id, saved);
  return saved;
}

export function getSavedQueries(userId: string): SavedQuery[] {
  return savedQueries.all().filter((q) => q.userId === userId);
}

export function getSavedQuery(id: string): SavedQuery | undefined {
  return savedQueries.get(id) ?? undefined;
}

export function deleteSavedQuery(id: string): boolean {
  return savedQueries.delete(id);
}

export function getRecentSearches(_userId: string, _limit: number = 5): SearchQuery[] {
  // In production this would query a per-user store
  return [];
}
