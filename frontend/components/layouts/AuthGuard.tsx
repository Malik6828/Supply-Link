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
  const [hasHydrated, setHasHydrated] = useState(() => useStore.persist.hasHydrated());

  useEffect(() => {
    if (useStore.persist.hasHydrated()) {
      setHasHydrated(true);
      return;
    }
    return useStore.persist.onFinishHydration(() => setHasHydrated(true));
  }, []);

  useEffect(() => {
    if (hasHydrated && walletAddress === null) {
      router.replace('/');
    }
  }, [hasHydrated, walletAddress, router]);

  if (!hasHydrated || !walletAddress) return null;

  return <>{children}</>;
}
