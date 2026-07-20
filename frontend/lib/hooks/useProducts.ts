'use client';

import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/lib/state/store';
import { useProductsList, useProductsStatus } from '@/lib/state/selectors/products';
import { listProducts } from '@/lib/stellar/client';
import { MOCK_PRODUCTS } from '@/lib/mock/products';
import { withRetry, RetriesExhaustedError } from '@/lib/resilience';
import type { Product } from '@/lib/types';

const CACHE_TTL_MS = 60_000;

export function useProducts() {
  const products = useProductsList();
  const status = useProductsStatus();
  const productsLastFetched = useStore((s) => s.productsLastFetched);
  const {
    setProducts,
    setProductsStatus,
    setProductsLastFetched,
    addOptimisticProduct,
    confirmOptimisticProduct,
    removeOptimisticProduct,
  } = useStore(
    useShallow((s) => ({
      setProducts: s.setProducts,
      setProductsStatus: s.setProductsStatus,
      setProductsLastFetched: s.setProductsLastFetched,
      addOptimisticProduct: s.addOptimisticProduct,
      confirmOptimisticProduct: s.confirmOptimisticProduct,
      removeOptimisticProduct: s.removeOptimisticProduct,
    })),
  );

  const [retrying, setRetrying] = useState(false);

  const fetchProducts = useCallback(async () => {
    setProductsStatus({ state: 'loading' });
    setRetrying(false);
    try {
      const { products: onChain } = await withRetry(() => listProducts(), {
        maxAttempts: 3,
        onRetry: () => setRetrying(true),
      });
      setRetrying(false);
      setProducts(onChain.length > 0 ? onChain : MOCK_PRODUCTS);
      setProductsLastFetched(Date.now());
      setProductsStatus({ state: 'success' });
    } catch (err) {
      setRetrying(false);
      const msg =
        err instanceof RetriesExhaustedError
          ? `Failed to load products after retries: ${err.cause instanceof Error ? err.cause.message : 'network error'}`
          : err instanceof Error
            ? err.message
            : 'Failed to load products';
      setProductsStatus({ state: 'error', message: msg });
      // Degrade gracefully to mock data
      setProducts(MOCK_PRODUCTS);
    }
  }, [setProducts, setProductsStatus, setProductsLastFetched]);

  useEffect(() => {
    const now = Date.now();
    if (productsLastFetched && now - productsLastFetched < CACHE_TTL_MS) return;
    fetchProducts();
  }, [productsLastFetched, fetchProducts]);

  const refresh = useCallback(() => {
    setProductsLastFetched(null);
  }, [setProductsLastFetched]);

  const registerOptimistic = useCallback(
    async (product: Product, txFn: () => Promise<void>, onError: (msg: string) => void) => {
      addOptimisticProduct(product);
      try {
        await txFn();
        confirmOptimisticProduct(product.id);
      } catch (err) {
        removeOptimisticProduct(product.id);
        onError(err instanceof Error ? err.message : 'Transaction failed');
      }
    },
    [addOptimisticProduct, confirmOptimisticProduct, removeOptimisticProduct],
  );

  return {
    products,
    loading: status.state === 'loading',
    retrying,
    error: status.state === 'error' ? status.message : null,
    refresh,
    registerOptimistic,
  };
}
