import { useShallow } from 'zustand/react/shallow';
import type { EventType, Notification } from '@/lib/types';
import type { SupplyLinkStore } from '../types';
import { useStore } from '../store';
import { createSelector } from '../createSelector';

// ── Base selectors ──────────────────────────────────────────────────────────

export function selectSearchQuery(state: SupplyLinkStore): string {
  return state.searchQuery;
}

export function selectFilterEventType(state: SupplyLinkStore): EventType | null {
  return state.filterEventType;
}

export function selectCompareIds(state: SupplyLinkStore): string[] {
  return state.compareIds;
}

export function selectNotifications(state: SupplyLinkStore): Notification[] {
  return state.notifications;
}

export function selectActivePage(state: SupplyLinkStore): string {
  return state.activePage;
}

export interface ProductFilters {
  searchQuery: string;
  filterEventType: EventType | null;
  sortBy: 'name' | 'timestamp';
  sortOrder: 'asc' | 'desc';
}

/** Grouped read of the products-page search/filter/sort controls — one
 *  useShallow subscription instead of four separate `useStore` calls. */
export function selectProductFilters(state: SupplyLinkStore): ProductFilters {
  return {
    searchQuery: state.searchQuery,
    filterEventType: state.filterEventType,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

// ── Memoized derived selectors ──────────────────────────────────────────────

export const selectUnreadNotificationsCount = createSelector<
  SupplyLinkStore,
  [Notification[]],
  number
>([selectNotifications], (notifications) => notifications.filter((n) => !n.read).length);

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useProductFilters(): ProductFilters {
  return useStore(useShallow(selectProductFilters));
}

export function useCompareIds(): string[] {
  return useStore(useShallow(selectCompareIds));
}

export function useNotificationsList(): Notification[] {
  return useStore(useShallow(selectNotifications));
}

export function useUnreadNotificationsCount(): number {
  return useStore(selectUnreadNotificationsCount);
}
