import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn().mockResolvedValue(true),
}));

const { useStore } = await import('@/lib/state/store');
const { selectProducts, selectFilteredProducts, makeSelectProductById } =
  await import('@/lib/state/selectors/products');
const { selectEvents, selectEventsForProductRaw } = await import('@/lib/state/selectors/events');
const { selectUnreadNotificationsCount } = await import('@/lib/state/selectors/ui');
const { createSelector } = await import('@/lib/state/createSelector');

const PRODUCT_A = {
  id: 'prod-a',
  name: 'Aged Cheddar',
  origin: 'UK',
  owner: 'GOWNER',
  timestamp: 1000,
  active: true,
  authorizedActors: [],
};
const PRODUCT_B = {
  id: 'prod-b',
  name: 'Basmati Rice',
  origin: 'India',
  owner: 'GOWNER',
  timestamp: 2000,
  active: true,
  authorizedActors: [],
};

const EVENT_A = {
  productId: 'prod-a',
  location: 'Farm',
  actor: 'GACTOR',
  timestamp: 1500,
  eventType: 'HARVEST' as const,
  metadata: '{}',
};

beforeEach(() => {
  act(() => {
    useStore.setState({
      productsById: {},
      productOrder: [],
      eventsById: {},
      eventOrder: [],
      productsStatus: { state: 'idle' },
      eventsStatus: { state: 'idle' },
      searchQuery: '',
      filterEventType: null,
      sortBy: 'name',
      sortOrder: 'asc',
      notifications: [],
    });
  });
});

describe('selectProducts / selectEvents memoization', () => {
  it('returns a reference-stable array across calls when nothing changed', () => {
    act(() => useStore.getState().setProducts([PRODUCT_A, PRODUCT_B]));
    const state = useStore.getState();
    const first = selectProducts(state);
    const second = selectProducts(state);
    expect(first).toBe(second);
  });

  it('returns a new reference only after productsById/productOrder change', () => {
    act(() => useStore.getState().setProducts([PRODUCT_A]));
    const before = selectProducts(useStore.getState());

    act(() => useStore.getState().setProducts([PRODUCT_A, PRODUCT_B]));
    const after = selectProducts(useStore.getState());

    expect(before).not.toBe(after);
    expect(after).toHaveLength(2);
  });

  it('is unaffected by unrelated state changes (e.g. UI slice)', () => {
    act(() => useStore.getState().setProducts([PRODUCT_A]));
    const before = selectProducts(useStore.getState());

    act(() => useStore.getState().setSearchQuery('cheddar'));
    const after = selectProducts(useStore.getState());

    expect(before).toBe(after);
  });

  it('selectEvents is reference-stable the same way', () => {
    act(() => useStore.getState().setEvents([EVENT_A]));
    const state = useStore.getState();
    expect(selectEvents(state)).toBe(selectEvents(state));
  });
});

describe('selectFilteredProducts', () => {
  beforeEach(() => {
    act(() => useStore.getState().setProducts([PRODUCT_A, PRODUCT_B]));
  });

  it('filters by search query (case-insensitive, name or id)', () => {
    act(() => useStore.getState().setSearchQuery('rice'));
    const result = selectFilteredProducts(useStore.getState());
    expect(result.map((p) => p.id)).toEqual(['prod-b']);
  });

  it('sorts by name ascending/descending', () => {
    act(() => useStore.getState().setSortBy('name'));
    act(() => useStore.getState().setSortOrder('asc'));
    expect(selectFilteredProducts(useStore.getState()).map((p) => p.id)).toEqual([
      'prod-a',
      'prod-b',
    ]);

    act(() => useStore.getState().setSortOrder('desc'));
    expect(selectFilteredProducts(useStore.getState()).map((p) => p.id)).toEqual([
      'prod-b',
      'prod-a',
    ]);
  });

  it('memoizes: same reference when filter/sort inputs are unchanged', () => {
    const first = selectFilteredProducts(useStore.getState());
    const second = selectFilteredProducts(useStore.getState());
    expect(first).toBe(second);
  });

  it('recomputes when the search query changes', () => {
    const before = selectFilteredProducts(useStore.getState());
    act(() => useStore.getState().setSearchQuery('cheddar'));
    const after = selectFilteredProducts(useStore.getState());
    expect(before).not.toBe(after);
    expect(after.map((p) => p.id)).toEqual(['prod-a']);
  });
});

describe('makeSelectProductById', () => {
  it('does an O(1) lookup and returns undefined for missing ids', () => {
    act(() => useStore.getState().setProducts([PRODUCT_A]));
    const state = useStore.getState();
    expect(makeSelectProductById('prod-a')(state)?.name).toBe('Aged Cheddar');
    expect(makeSelectProductById('missing')(state)).toBeUndefined();
  });
});

describe('selectEventsForProductRaw', () => {
  it('filters events for a single product', () => {
    act(() =>
      useStore.getState().setEvents([EVENT_A, { ...EVENT_A, productId: 'prod-b', timestamp: 999 }]),
    );
    const state = useStore.getState();
    expect(selectEventsForProductRaw(state, 'prod-a')).toHaveLength(1);
    expect(selectEventsForProductRaw(state, 'prod-b')).toHaveLength(1);
    expect(selectEventsForProductRaw(state, 'prod-c')).toHaveLength(0);
  });
});

describe('selectUnreadNotificationsCount', () => {
  it('counts only unread notifications and memoizes on the notifications reference', () => {
    act(() =>
      useStore.getState().addNotifications([
        {
          id: 'n1',
          productId: 'prod-a',
          productName: 'A',
          eventType: 'HARVEST',
          location: '',
          actor: '',
          timestamp: 1,
          read: false,
        },
        {
          id: 'n2',
          productId: 'prod-a',
          productName: 'A',
          eventType: 'HARVEST',
          location: '',
          actor: '',
          timestamp: 2,
          read: true,
        },
      ]),
    );
    const state = useStore.getState();
    expect(selectUnreadNotificationsCount(state)).toBe(1);
    expect(selectUnreadNotificationsCount(state)).toBe(selectUnreadNotificationsCount(state));
  });
});

describe('createSelector', () => {
  it('only recomputes when an input changes, by reference', () => {
    let calls = 0;
    const selectDoubled = createSelector<{ n: number }, [number], number>([(s) => s.n], (n) => {
      calls++;
      return n * 2;
    });

    const stateA = { n: 1 };
    expect(selectDoubled(stateA)).toBe(2);
    expect(selectDoubled(stateA)).toBe(2);
    expect(calls).toBe(1); // second call hit the cache

    const stateB = { n: 2 };
    expect(selectDoubled(stateB)).toBe(4);
    expect(calls).toBe(2);
  });
});
