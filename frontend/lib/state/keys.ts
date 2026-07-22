import type { Product, TrackingEvent } from '@/lib/types';

/** Entity key for normalized product storage — products already have a stable `id`. */
export function productKey(product: Pick<Product, 'id'>): string {
  return product.id;
}

/**
 * Entity key for normalized event storage. TrackingEvent has no guaranteed unique `id`
 * (the optional `stableId` isn't populated by all sources), so events are keyed by the
 * same (productId, timestamp) pair the slice already treats as the identity for
 * optimistic confirm/remove operations.
 */
export function eventKey(event: Pick<TrackingEvent, 'productId' | 'timestamp'>): string {
  return `${event.productId}__${event.timestamp}`;
}
