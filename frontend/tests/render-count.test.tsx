/**
 * Instrumented render-count proof for issue #585.
 *
 * We can't attach React DevTools Profiler from a CLI/CI environment, so this
 * test is the substitute evidence: it renders one component subscribed to the
 * *entire* store (the old, pre-refactor pattern every consumer used to follow)
 * next to one subscribed via a selector (the new pattern), then triggers
 * unrelated state changes and counts renders for each.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn().mockResolvedValue(true),
}));

const { useStore } = await import('@/lib/state/store');
const { useProductsList } = await import('@/lib/state/selectors/products');

beforeEach(() => {
  act(() => {
    useStore.setState({
      productsById: {},
      productOrder: [],
      searchQuery: '',
      filterEventType: null,
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });
});

function BroadSubscriber({ onRender }: { onRender: () => void }) {
  // Old pattern: subscribes to the whole store, so it re-renders on *any*
  // slice mutation, including ones it never reads.
  useStore();
  onRender();
  return null;
}

function SelectorSubscriber({ onRender }: { onRender: () => void }) {
  // New pattern: subscribes only to the derived products list.
  useProductsList();
  onRender();
  return null;
}

function CountingHarness({
  Subscriber,
  countRef,
}: {
  Subscriber: typeof BroadSubscriber;
  countRef: { current: number };
}) {
  return <Subscriber onRender={() => (countRef.current += 1)} />;
}

describe('render-count: broad useStore() vs targeted selector', () => {
  it('a broad useStore() subscriber re-renders on unrelated (UI) state changes', () => {
    const broadCount = { current: 0 };
    render(<CountingHarness Subscriber={BroadSubscriber} countRef={broadCount} />);
    expect(broadCount.current).toBe(1);

    act(() => useStore.getState().setSearchQuery('a'));
    act(() => useStore.getState().setSearchQuery('ab'));
    act(() => useStore.getState().setSortOrder('desc'));

    // Unrelated UI changes still force a re-render of a full-store subscriber.
    expect(broadCount.current).toBe(4);
  });

  it('a selector subscriber does NOT re-render on unrelated (UI) state changes', () => {
    const selectorCount = { current: 0 };
    render(<CountingHarness Subscriber={SelectorSubscriber} countRef={selectorCount} />);
    expect(selectorCount.current).toBe(1);

    act(() => useStore.getState().setSearchQuery('a'));
    act(() => useStore.getState().setSearchQuery('ab'));
    act(() => useStore.getState().setSortOrder('desc'));

    // None of these touch productsById/productOrder, so no re-render fires.
    expect(selectorCount.current).toBe(1);
  });

  it('a selector subscriber DOES re-render when the products it reads actually change', () => {
    const selectorCount = { current: 0 };
    render(<CountingHarness Subscriber={SelectorSubscriber} countRef={selectorCount} />);
    expect(selectorCount.current).toBe(1);

    act(() =>
      useStore.getState().setProducts([
        {
          id: 'p1',
          name: 'Test',
          origin: 'X',
          owner: 'G',
          timestamp: 1,
          active: true,
          authorizedActors: [],
        },
      ]),
    );

    expect(selectorCount.current).toBe(2);
  });
});
