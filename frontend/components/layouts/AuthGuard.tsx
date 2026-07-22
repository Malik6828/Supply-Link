'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/state/store';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const walletAddress = useStore((s) => s.walletAddress);
  const router = useRouter();
  // The wallet address is only known once zustand's persist middleware has
  // rehydrated from localStorage; redirecting before that finishes would
  // bounce an already-connected wallet back to "/" on every hard page load.
  // `useStore.persist` isn't available during server rendering (no localStorage
  // there), so this must default to false on the server rather than crash.
  const [hasHydrated, setHasHydrated] = useState(() => useStore.persist?.hasHydrated() ?? false);

  useEffect(() => {
    // Redirect decisions read the store imperatively (getState/subscribe)
    // rather than relying on the `walletAddress` prop from this render —
    // zustand's hydration-finished flag can flip a render tick before the
    // reactive selector catches up with the just-merged persisted state,
    // which would otherwise bounce an already-connected wallet to "/".
    function redirectIfLoggedOut() {
      if (useStore.getState().walletAddress === null) {
        router.replace('/');
      }
    }

    let unsubscribeHydration: (() => void) | undefined;
    if (useStore.persist.hasHydrated()) {
      setHasHydrated(true);
      redirectIfLoggedOut();
    } else {
      unsubscribeHydration = useStore.persist.onFinishHydration(() => {
        setHasHydrated(true);
        redirectIfLoggedOut();
      });
    }

    // Also redirect if the wallet is disconnected later, after hydration has
    // already settled (e.g. the user clicks "Disconnect wallet").
    const unsubscribeStore = useStore.subscribe((state) => {
      if (useStore.persist.hasHydrated() && state.walletAddress === null) {
        router.replace('/');
      }
    });

    return () => {
      unsubscribeHydration?.();
      unsubscribeStore();
    };
  }, [router]);

  if (!hasHydrated || !walletAddress) return null;

  return <>{children}</>;
}
