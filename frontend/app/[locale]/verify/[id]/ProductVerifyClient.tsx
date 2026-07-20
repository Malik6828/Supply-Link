'use client';

import { useEffect, useState } from 'react';
import { recordScan } from '@/lib/services/scanTracking';
import type { Product } from '@/lib/types';
import { EmergencyAlertBanner } from '@/components/products/EmergencyAlertBanner';
import { listActiveAlerts } from '@/lib/services/emergencyAlerts';
import { acknowledgeAlert } from '@/lib/services/emergencyAlerts';
import type { EmergencyAlert } from '@/lib/services/emergencyAlerts';

interface ProductVerifyClientProps {
  product: Product;
  children: React.ReactNode;
}

type Mode = 'online' | 'offline';

export default function ProductVerifyClient({ product, children }: ProductVerifyClientProps) {
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [mode, setMode] = useState<Mode>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online',
  );

  useEffect(() => {
    // Load active emergency alerts for this product
    setAlerts(listActiveAlerts(product.id));
  }, [product.id]);

  useEffect(() => {
    // Keep mode in sync with network status
    function handleOnline() {
      setMode('online');
    }
    function handleOffline() {
      setMode('offline');
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    // Record scan for recall notifications (online only)
    if (mode !== 'online') return;
    (async () => {
      try {
        // Get client IP (requires x-forwarded-for or similar from middleware)
        const response = await fetch('/api/client-ip');
        const { ip } = await response.json();

        if (ip) {
          await recordScan(product.id, ip);
        }
      } catch {
        // Silently fail - don't disrupt user experience
        console.debug('Could not record scan');
      }
    })();
  }, [product.id, mode]);

  function handleAcknowledge(alertId: string) {
    acknowledgeAlert(alertId, 'public-viewer');
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }

  function handleDismiss(alertId: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }

  return (
    <>
      {/* Emergency alert banners — shown above everything else */}
      {alerts.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pt-4" data-testid="emergency-alerts-container">
          <EmergencyAlertBanner
            alerts={alerts}
            onAcknowledge={handleAcknowledge}
            onDismiss={handleDismiss}
          />
        </div>
      )}

      {/* RECALLED Banner for deactivated products */}
      {!product.active && (
        <div
          data-testid="product-recalled-banner"
          className="w-full bg-gradient-to-r from-red-600 to-red-700 text-white px-6 py-4 mb-6 rounded-lg border-2 border-red-800"
        >
          <div className="max-w-2xl mx-auto flex items-start gap-3">
            <div className="text-2xl">⚠️</div>
            <div>
              <h2 className="text-lg font-bold mb-1" data-testid="product-recalled-title">
                PRODUCT RECALLED
              </h2>
              <p className="text-sm text-red-50" data-testid="product-recalled-description">
                This product has been recalled and removed from sale. Do not use this product.
                Please return it or dispose of it safely.
              </p>
            </div>
          </div>
        </div>
      )}

      {children}
    </>
  );
}
