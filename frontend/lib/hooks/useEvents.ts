'use client';

import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/lib/state/store';
import { useEventsList, useEventsStatus } from '@/lib/state/selectors/events';
import { MOCK_EVENTS } from '@/lib/mock/products';
import { notifyWebhooksOfNewEvent } from '@/lib/webhooks/client';
import { withRetry, RetriesExhaustedError } from '@/lib/resilience';
import type { TrackingEvent } from '@/lib/types';

const CACHE_TTL_MS = 60_000;

export function useEvents() {
  const events = useEventsList();
  const status = useEventsStatus();
  const eventsLastFetched = useStore((s) => s.eventsLastFetched);
  const {
    setEvents,
    setEventsStatus,
    setEventsLastFetched,
    addOptimisticEvent,
    confirmOptimisticEvent,
    removeOptimisticEvent,
  } = useStore(
    useShallow((s) => ({
      setEvents: s.setEvents,
      setEventsStatus: s.setEventsStatus,
      setEventsLastFetched: s.setEventsLastFetched,
      addOptimisticEvent: s.addOptimisticEvent,
      confirmOptimisticEvent: s.confirmOptimisticEvent,
      removeOptimisticEvent: s.removeOptimisticEvent,
    })),
  );

  const [retrying, setRetrying] = useState(false);

  const fetchEvents = useCallback(async () => {
    setEventsStatus({ state: 'loading' });
    setRetrying(false);
    try {
      await withRetry(
        async () => {
          // Replace with real Soroban RPC call when available
          setEvents(MOCK_EVENTS);
          setEventsLastFetched(Date.now());
        },
        {
          maxAttempts: 3,
          onRetry: () => setRetrying(true),
        },
      );
      setRetrying(false);
      setEventsStatus({ state: 'success' });
    } catch (err) {
      setRetrying(false);
      const msg =
        err instanceof RetriesExhaustedError
          ? `Failed to load events after retries: ${err.cause instanceof Error ? err.cause.message : 'network error'}`
          : err instanceof Error
            ? err.message
            : 'Failed to load events';
      setEventsStatus({ state: 'error', message: msg });
      setEvents(MOCK_EVENTS);
    }
  }, [setEvents, setEventsStatus, setEventsLastFetched]);

  useEffect(() => {
    const now = Date.now();
    if (eventsLastFetched && now - eventsLastFetched < CACHE_TTL_MS) return;
    fetchEvents();
  }, [eventsLastFetched, fetchEvents]);

  const refresh = useCallback(() => {
    setEventsLastFetched(null);
  }, [setEventsLastFetched]);

  const addEventOptimistic = useCallback(
    async (event: TrackingEvent, txFn: () => Promise<void>, onError: (msg: string) => void) => {
      addOptimisticEvent(event);
      try {
        await txFn();
        confirmOptimisticEvent(event.productId, event.timestamp);

        try {
          await notifyWebhooksOfNewEvent(event);
        } catch (webhookErr) {
          console.error('Webhook notification error (non-blocking):', webhookErr);
        }
      } catch (err) {
        removeOptimisticEvent(event.productId, event.timestamp);
        onError(err instanceof Error ? err.message : 'Transaction failed');
      }
    },
    [addOptimisticEvent, confirmOptimisticEvent, removeOptimisticEvent],
  );

  return {
    events,
    loading: status.state === 'loading',
    retrying,
    error: status.state === 'error' ? status.message : null,
    refresh,
    addEventOptimistic,
  };
}
