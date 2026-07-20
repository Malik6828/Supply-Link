import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWalletSlice } from './walletSlice';
import { createProductsSlice } from './productsSlice';
import { createEventsSlice } from './eventsSlice';
import { createUISlice } from './uiSlice';
import { createOnboardingSlice } from './onboardingSlice';
import { SupplyLinkStore } from './types';

export const useStore = create<SupplyLinkStore>()(
  persist(
    (...a) => ({
      ...createWalletSlice(...a),
      ...createProductsSlice(...a),
      ...createEventsSlice(...a),
      ...createUISlice(...a),
      ...createOnboardingSlice(...a),
    }),
    {
      name: 'supply-link-store',
      partialize: (state) => ({
        walletAddress: state.walletAddress,
        notifications: state.notifications,
        onboardingCompleted: state.onboardingCompleted,
        onboardingChecklist: state.onboardingChecklist,
      }),
    },
  ),
);

// Derived/memoized data no longer lives here — see `lib/state/selectors/` for the
// per-slice selector modules (e.g. `useFilteredProducts` moved to `selectors/products.ts`).
// Re-exported for backwards compatibility with existing imports of `./store`.
export { useFilteredProducts, selectFilteredProducts } from './selectors/products';
