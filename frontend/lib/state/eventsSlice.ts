import { StateCreator } from 'zustand';
import { SupplyLinkStore, EventsSlice } from './types';
import { eventKey } from './keys';

export const createEventsSlice: StateCreator<SupplyLinkStore, [], [], EventsSlice> = (set) => ({
  eventsById: {},
  eventOrder: [],
  eventsStatus: { state: 'idle' },
  eventsLastFetched: null,
  eventPage: 0,
  eventPageSize: 20,
  eventTotal: 0,
  selectedProductId: null,

  setEvents: (events) =>
    set({
      eventsById: Object.fromEntries(events.map((e) => [eventKey(e), e])),
      eventOrder: events.map(eventKey),
    }),

  addEvent: (event) =>
    set((s) => {
      const key = eventKey(event);
      const isNew = !(key in s.eventsById);
      return {
        eventsById: { ...s.eventsById, [key]: event },
        eventOrder: isNew ? [...s.eventOrder, key] : s.eventOrder,
      };
    }),

  setEventsStatus: (eventsStatus) => set({ eventsStatus }),
  setEventsLastFetched: (eventsLastFetched) => set({ eventsLastFetched }),

  addOptimisticEvent: (event) =>
    set((s) => {
      const key = eventKey(event);
      const isNew = !(key in s.eventsById);
      return {
        eventsById: { ...s.eventsById, [key]: { ...event, pending: true } },
        eventOrder: isNew ? [...s.eventOrder, key] : s.eventOrder,
      };
    }),

  confirmOptimisticEvent: (productId, timestamp) =>
    set((s) => {
      const key = eventKey({ productId, timestamp });
      const existing = s.eventsById[key];
      if (!existing) return s;
      return {
        eventsById: { ...s.eventsById, [key]: { ...existing, pending: false } },
      };
    }),

  removeOptimisticEvent: (productId, timestamp) =>
    set((s) => {
      const key = eventKey({ productId, timestamp });
      if (!(key in s.eventsById)) return s;
      const { [key]: _removed, ...rest } = s.eventsById;
      return {
        eventsById: rest,
        eventOrder: s.eventOrder.filter((k) => k !== key),
      };
    }),

  setEventPage: (eventPage) => set({ eventPage }),
  setEventPageSize: (eventPageSize) => set({ eventPageSize }),
  setEventTotal: (eventTotal) => set({ eventTotal }),
  setSelectedProductId: (selectedProductId) => set({ selectedProductId }),
});
