import { useShallow } from 'zustand/react/shallow';
import type { Product } from '@/lib/types';
import type { AsyncStatus, SupplyLinkStore } from '../types';
import { useStore } from '../store';
import { createSelector, createParameterizedSelector } from '../createSelector';

// ── Base selectors ──────────────────────────────────────────────────────────

export function selectProductsMap(state: SupplyLinkStore): Record<string, Product> {
  return state.productsById;
}

export function selectProductOrder(state: SupplyLinkStore): string[] {
  return state.productOrder;
}

export function selectProductsStatus(state: SupplyLinkStore): AsyncStatus {
  return state.productsStatus;
}

export function selectProductsLoading(state: SupplyLinkStore): boolean {
  return state.productsStatus.state === 'loading';
}

export function selectProductsError(state: SupplyLinkStore): string | null {
  return state.productsStatus.state === 'error' ? state.productsStatus.message : null;
}

export function selectProductCount(state: SupplyLinkStore): number {
  return state.productOrder.length;
}

/** O(1) lookup for a single product, e.g. compare/detail views. */
export const makeSelectProductById =
  (productId: string) =>
  (state: SupplyLinkStore): Product | undefined =>
    state.productsById[productId];

// ── Memoized derived selectors ──────────────────────────────────────────────

/** All products as an array, in insertion order. Reference-stable across
 *  renders that don't touch productsById/productOrder. */
export const selectProducts = createSelector<
  SupplyLinkStore,
  [Record<string, Product>, string[]],
  Product[]
>([selectProductsMap, selectProductOrder], (productsById, productOrder) =>
  productOrder.map((id) => productsById[id]),
);

/** Filtered + sorted products (#50), reference-stable unless products or the
 *  filter/sort inputs actually change. */
export const selectFilteredProducts = createSelector<
  SupplyLinkStore,
  [
    Product[],
    string,
    SupplyLinkStore['filterEventType'],
    SupplyLinkStore['sortBy'],
    SupplyLinkStore['sortOrder'],
  ],
  Product[]
>(
  [
    selectProducts,
    (s) => s.searchQuery,
    (s) => s.filterEventType,
    (s) => s.sortBy,
    (s) => s.sortOrder,
  ],
  (products, searchQuery, filterEventType, sortBy, sortOrder): Product[] => {
    const result = products.filter((p) => {
      const matchesSearch =
        searchQuery === '' ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = filterEventType === null || true;
      return matchesSearch && matchesFilter;
    });

    return [...result].sort((a, b) => {
      const av = sortBy === 'name' ? a.name : a.timestamp;
      const bv = sortBy === 'name' ? b.name : b.timestamp;
      if (av < bv) return sortOrder === 'asc' ? -1 : 1;
      if (av > bv) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  },
);

/** Products matching a given set of ids (e.g. compare selection), in id order. */
export const makeSelectProductsByIds = createParameterizedSelector<
  SupplyLinkStore,
  string[],
  [Record<string, Product>, string[]],
  Product[]
>([selectProductsMap, (_state, ids) => ids], (productsById, ids) =>
  ids.map((id) => productsById[id]).filter((p): p is Product => !!p),
);

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useProductsList(): Product[] {
  return useStore(selectProducts);
}

export function useFilteredProducts(): Product[] {
  return useStore(selectFilteredProducts);
}

export function useProductsMap(): Record<string, Product> {
  return useStore(selectProductsMap);
}

export function useProductById(productId: string): Product | undefined {
  return useStore(makeSelectProductById(productId));
}

export function useProductsStatus(): AsyncStatus {
  return useStore(useShallow(selectProductsStatus));
}
