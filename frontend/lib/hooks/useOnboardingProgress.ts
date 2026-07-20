import { useEffect } from 'react';
import { useStore } from '@/lib/state/store';
import { selectWalletAddress } from '@/lib/state/selectors/wallet';
import { selectProductCount } from '@/lib/state/selectors/products';
import { selectEventCount } from '@/lib/state/selectors/events';
import { selectOnboardingChecklist } from '@/lib/state/selectors/onboarding';

/**
 * Hook to automatically update onboarding checklist based on user actions.
 * Tracks wallet connection, product registration, and event creation.
 */
export function useOnboardingProgress() {
  const walletAddress = useStore(selectWalletAddress);
  const productCount = useStore(selectProductCount);
  const eventCount = useStore(selectEventCount);
  const onboardingChecklist = useStore(selectOnboardingChecklist);
  const completeChecklistItem = useStore((s) => s.completeChecklistItem);

  useEffect(() => {
    // Check wallet setup
    if (walletAddress && !onboardingChecklist.find((i) => i.id === 'wallet-setup')?.completed) {
      completeChecklistItem('wallet-setup');
    }
  }, [walletAddress, onboardingChecklist, completeChecklistItem]);

  useEffect(() => {
    // Check first product registration
    if (
      productCount > 0 &&
      !onboardingChecklist.find((i) => i.id === 'register-product')?.completed
    ) {
      completeChecklistItem('register-product');
    }
  }, [productCount, onboardingChecklist, completeChecklistItem]);

  useEffect(() => {
    // Check first event added
    if (eventCount > 0 && !onboardingChecklist.find((i) => i.id === 'add-event')?.completed) {
      completeChecklistItem('add-event');
    }
  }, [eventCount, onboardingChecklist, completeChecklistItem]);
}
