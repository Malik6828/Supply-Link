import type { Product, TrackingEvent, EventType, Notification } from '@/lib/types';

/**
 * Discriminated union for in-flight fetch state. Replaces the old
 * `{ loading: boolean; error: string | null }` pair, which allowed invalid
 * combinations (e.g. loading === true while error was also set).
 */
export type AsyncStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'success' }
  | { state: 'error'; message: string };

export interface OnboardingChecklistItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
}

export interface OnboardingSlice {
  onboardingCompleted: boolean;
  onboardingChecklist: OnboardingChecklistItem[];
  onboardingProgress: number;
  setOnboardingCompleted: (completed: boolean) => void;
  setOnboardingChecklist: (items: OnboardingChecklistItem[]) => void;
  completeChecklistItem: (itemId: string) => void;
  resetOnboarding: () => void;
}

export interface WalletSlice {
  walletAddress: string | null;
  xlmBalance: string | null;
  networkMismatch: boolean;
  setWalletAddress: (address: string | null) => void;
  setXlmBalance: (balance: string | null) => void;
  setNetworkMismatch: (mismatch: boolean) => void;
  validateWalletConnection: () => Promise<void>;
  disconnect: () => void;
}

export interface ProductsSlice {
  /** Normalized product storage — id -> Product, for O(1) lookups/updates. */
  productsById: Record<string, Product>;
  /** Insertion order of product ids, since object key order isn't a display contract. */
  productOrder: string[];
  productsStatus: AsyncStatus;
  productsLastFetched: number | null;
  productPage: number;
  productPageSize: number;
  productTotal: number;
  setProducts: (products: Product[]) => void;
  addProduct: (product: Product) => void;
  setProductsStatus: (status: AsyncStatus) => void;
  setProductsLastFetched: (ts: number | null) => void;
  updateProductOwner: (productId: string, newOwner: string) => void;
  addOptimisticProduct: (product: Product) => void;
  confirmOptimisticProduct: (productId: string) => void;
  removeOptimisticProduct: (productId: string) => void;
  setProductPage: (page: number) => void;
  setProductPageSize: (size: number) => void;
  setProductTotal: (total: number) => void;
}

export interface EventsSlice {
  /** Normalized event storage — `${productId}__${timestamp}` -> TrackingEvent. */
  eventsById: Record<string, TrackingEvent>;
  /** Insertion order of event keys, since object key order isn't a display contract. */
  eventOrder: string[];
  eventsStatus: AsyncStatus;
  eventsLastFetched: number | null;
  eventPage: number;
  eventPageSize: number;
  eventTotal: number;
  selectedProductId: string | null;
  setEvents: (events: TrackingEvent[]) => void;
  addEvent: (event: TrackingEvent) => void;
  setEventsStatus: (status: AsyncStatus) => void;
  setEventsLastFetched: (ts: number | null) => void;
  addOptimisticEvent: (event: TrackingEvent) => void;
  confirmOptimisticEvent: (productId: string, timestamp: number) => void;
  removeOptimisticEvent: (productId: string, timestamp: number) => void;
  setEventPage: (page: number) => void;
  setEventPageSize: (size: number) => void;
  setEventTotal: (total: number) => void;
  setSelectedProductId: (id: string | null) => void;
}

export interface UISlice {
  searchQuery: string;
  filterEventType: EventType | null;
  sortBy: 'name' | 'timestamp';
  sortOrder: 'asc' | 'desc';
  notifications: Notification[];
  lastFetched: number | null;
  compareIds: string[];
  isAddProductModalOpen: boolean;
  isAddEventModalOpen: boolean;
  activePage: string;
  setSearchQuery: (q: string) => void;
  setFilterEventType: (t: EventType | null) => void;
  setSortBy: (by: 'name' | 'timestamp') => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  addNotifications: (notifications: Notification[]) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  setLastFetched: (ts: number) => void;
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
  setIsAddProductModalOpen: (open: boolean) => void;
  setIsAddEventModalOpen: (open: boolean) => void;
  setActivePage: (page: string) => void;
}

export type SupplyLinkStore = WalletSlice & ProductsSlice & EventsSlice & UISlice & OnboardingSlice;
