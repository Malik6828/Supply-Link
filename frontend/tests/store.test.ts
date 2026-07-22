import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn().mockResolvedValue(true),
}));

// Import after mock
const { useStore } = await import('@/lib/state/store');
const { selectProducts } = await import('@/lib/state/selectors/products');
const { selectEvents } = await import('@/lib/state/selectors/events');

const PRODUCT = {
  id: 'prod-1',
  name: 'Coffee Beans',
  origin: 'Ethiopia',
  owner: 'GABC123',
  timestamp: 1000,
  active: true,
  authorizedActors: [],
};

const EVENT = {
  productId: 'prod-1',
  location: 'Addis Ababa',
  actor: 'GABC123',
  timestamp: 2000,
  eventType: 'HARVEST' as const,
  metadata: '{}',
};

beforeEach(() => {
  act(() => {
    useStore.setState({
      walletAddress: null,
      xlmBalance: null,
      networkMismatch: false,
      productsById: {},
      productOrder: [],
      eventsById: {},
      eventOrder: [],
      productsStatus: { state: 'idle' },
      eventsStatus: { state: 'idle' },
      productsLastFetched: null,
      eventsLastFetched: null,
    });
  });
});

// ── walletSlice ───────────────────────────────────────────────────────────────

describe('walletSlice', () => {
  it('setWalletAddress updates walletAddress', () => {
    const { result } = renderHook(() => useStore());
    act(() => result.current.setWalletAddress('GABC123'));
    expect(result.current.walletAddress).toBe('GABC123');
  });

  it('disconnect clears wallet and resets normalized product/event storage', () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.setWalletAddress('GABC123');
      result.current.addProduct(PRODUCT);
      result.current.disconnect();
    });
    expect(result.current.walletAddress).toBeNull();
    expect(result.current.productsById).toEqual({});
    expect(result.current.productOrder).toEqual([]);
  });
});

// ── productsSlice ─────────────────────────────────────────────────────────────

describe('productsSlice', () => {
  it('addProduct appends a product', () => {
    const { result } = renderHook(() => useStore());
    act(() => result.current.addProduct(PRODUCT));
    expect(selectProducts(result.current)).toHaveLength(1);
    expect(result.current.productsById['prod-1'].id).toBe('prod-1');
  });

  it('addProduct is idempotent for the order array when re-adding the same id', () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.addProduct(PRODUCT);
      result.current.addProduct({ ...PRODUCT, name: 'Updated name' });
    });
    expect(result.current.productOrder).toEqual(['prod-1']);
    expect(result.current.productsById['prod-1'].name).toBe('Updated name');
  });

  it('setProducts replaces the list', () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.addProduct(PRODUCT);
      result.current.setProducts([{ ...PRODUCT, id: 'prod-2' }]);
    });
    expect(selectProducts(result.current)).toHaveLength(1);
    expect(selectProducts(result.current)[0].id).toBe('prod-2');
    expect(result.current.productsById['prod-1']).toBeUndefined();
  });

  it('updateProductOwner updates a single entry in O(1) without touching others', () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.setProducts([PRODUCT, { ...PRODUCT, id: 'prod-2' }]);
      result.current.updateProductOwner('prod-1', 'GNEWOWNER');
    });
    expect(result.current.productsById['prod-1'].owner).toBe('GNEWOWNER');
    expect(result.current.productsById['prod-2'].owner).toBe(PRODUCT.owner);
    expect(result.current.productOrder).toEqual(['prod-1', 'prod-2']);
  });

  it('addOptimisticProduct / confirmOptimisticProduct / removeOptimisticProduct manage pending state', () => {
    const { result } = renderHook(() => useStore());
    act(() => result.current.addOptimisticProduct(PRODUCT));
    expect(result.current.productsById['prod-1'].pending).toBe(true);

    act(() => result.current.confirmOptimisticProduct('prod-1'));
    expect(result.current.productsById['prod-1'].pending).toBe(false);

    act(() => result.current.removeOptimisticProduct('prod-1'));
    expect(result.current.productsById['prod-1']).toBeUndefined();
    expect(result.current.productOrder).toEqual([]);
  });

  it('setProductsStatus transitions through the discriminated union', () => {
    const { result } = renderHook(() => useStore());
    act(() => result.current.setProductsStatus({ state: 'loading' }));
    expect(result.current.productsStatus).toEqual({ state: 'loading' });

    act(() => result.current.setProductsStatus({ state: 'error', message: 'fetch failed' }));
    expect(result.current.productsStatus).toEqual({ state: 'error', message: 'fetch failed' });

    act(() => result.current.setProductsStatus({ state: 'success' }));
    expect(result.current.productsStatus).toEqual({ state: 'success' });
  });

  it('setProductsLastFetched invalidates cache when set to null', () => {
    const { result } = renderHook(() => useStore());
    act(() => result.current.setProductsLastFetched(Date.now()));
    expect(result.current.productsLastFetched).not.toBeNull();
    act(() => result.current.setProductsLastFetched(null));
    expect(result.current.productsLastFetched).toBeNull();
  });
});

// ── eventsSlice ───────────────────────────────────────────────────────────────

describe('eventsSlice', () => {
  it('addEvent appends an event', () => {
    const { result } = renderHook(() => useStore());
    act(() => result.current.addEvent(EVENT));
    expect(selectEvents(result.current)).toHaveLength(1);
    expect(selectEvents(result.current)[0].eventType).toBe('HARVEST');
  });

  it('setEvents replaces the list', () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.addEvent(EVENT);
      result.current.setEvents([{ ...EVENT, eventType: 'SHIPPING' }]);
    });
    expect(selectEvents(result.current)).toHaveLength(1);
    expect(selectEvents(result.current)[0].eventType).toBe('SHIPPING');
  });

  it('confirmOptimisticEvent / removeOptimisticEvent target the (productId, timestamp) key in O(1)', () => {
    const { result } = renderHook(() => useStore());
    act(() => result.current.addOptimisticEvent(EVENT));
    expect(selectEvents(result.current)[0].pending).toBe(true);

    act(() => result.current.confirmOptimisticEvent(EVENT.productId, EVENT.timestamp));
    expect(selectEvents(result.current)[0].pending).toBe(false);

    act(() => result.current.removeOptimisticEvent(EVENT.productId, EVENT.timestamp));
    expect(selectEvents(result.current)).toHaveLength(0);
  });

  it('setEventsStatus transitions through the discriminated union', () => {
    const { result } = renderHook(() => useStore());
    act(() => result.current.setEventsStatus({ state: 'loading' }));
    expect(result.current.eventsStatus).toEqual({ state: 'loading' });
    act(() => result.current.setEventsStatus({ state: 'error', message: 'network error' }));
    expect(result.current.eventsStatus).toEqual({ state: 'error', message: 'network error' });
  });

  it('setEventsLastFetched updates cache timestamp', () => {
    const { result } = renderHook(() => useStore());
    const ts = Date.now();
    act(() => result.current.setEventsLastFetched(ts));
    expect(result.current.eventsLastFetched).toBe(ts);
  });
});
