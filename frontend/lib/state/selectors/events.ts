import { useShallow } from 'zustand/react/shallow';
import type { TrackingEvent } from '@/lib/types';
import type { AsyncStatus, SupplyLinkStore } from '../types';
import { useStore } from '../store';
import { createSelector } from '../createSelector';

// ── Base selectors ──────────────────────────────────────────────────────────

export function selectEventsMap(state: SupplyLinkStore): Record<string, TrackingEvent> {
  return state.eventsById;
}

export function selectEventOrder(state: SupplyLinkStore): string[] {
  return state.eventOrder;
}

export function selectEventsStatus(state: SupplyLinkStore): AsyncStatus {
  return state.eventsStatus;
}

export function selectEventsLoading(state: SupplyLinkStore): boolean {
  return state.eventsStatus.state === 'loading';
}

export function selectEventsError(state: SupplyLinkStore): string | null {
  return state.eventsStatus.state === 'error' ? state.eventsStatus.message : null;
}

export function selectEventCount(state: SupplyLinkStore): number {
  return state.eventOrder.length;
}

// ── Memoized derived selectors ──────────────────────────────────────────────

/** All events as an array, in insertion order. Reference-stable across renders
 *  that don't touch eventsById/eventOrder. */
export const selectEvents = createSelector<
  SupplyLinkStore,
  [Record<string, TrackingEvent>, string[]],
  TrackingEvent[]
>([selectEventsMap, selectEventOrder], (eventsById, eventOrder) =>
  eventOrder.map((key) => eventsById[key]),
);

/** Events for a single product — the hot path for the tracking page. */
export function selectEventsForProductRaw(
  state: SupplyLinkStore,
  productId: string,
): TrackingEvent[] {
  return selectEvents(state).filter((e) => e.productId === productId);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useEventsList(): TrackingEvent[] {
  return useStore(selectEvents);
}

export function useEventsMap(): Record<string, TrackingEvent> {
  return useStore(selectEventsMap);
}

export function useEventsStatus(): AsyncStatus {
  return useStore(useShallow(selectEventsStatus));
}

/** Memoized per-product event list — stable reference unless that product's
 *  events (or the underlying event set) actually change. */
export function useEventsForProduct(productId: string): TrackingEvent[] {
  return useStore(
    useShallow((state: SupplyLinkStore) => selectEventsForProductRaw(state, productId)),
  );
}
