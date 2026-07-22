import { describe, it, expect, beforeEach } from 'vitest';
import type { Product } from '@/lib/types';
import { __resetStores } from '@/lib/store';
import {
  initiateBroadcast,
  getBroadcast,
  getAllBroadcasts,
  getActiveBroadcasts,
  getStakeholderNotifications,
  acknowledgeNotification,
  resolveBroadcast,
  cancelBroadcast,
  getBroadcastStats,
} from '@/lib/services/recallBroadcastService';

const PRODUCT: Product = {
  id: 'prod-1',
  name: 'Coffee Beans',
  origin: 'Ethiopia',
  owner: 'GABC',
  timestamp: 1000,
  active: true,
  authorizedActors: [],
};

function broadcastFixture(stakeholders = ['alice', 'bob']) {
  return initiateBroadcast(PRODUCT, 'contamination', 'high', 'GADMIN', stakeholders, ['batch-1']);
}

describe('recallBroadcastService', () => {
  beforeEach(() => {
    __resetStores();
  });

  it('initiateBroadcast persists the broadcast and per-stakeholder notifications', () => {
    const b = broadcastFixture();
    expect(getBroadcast(b.id)).toEqual(b);
    expect(getStakeholderNotifications('alice')).toHaveLength(1);
    expect(getStakeholderNotifications('bob')).toHaveLength(1);
    expect(getStakeholderNotifications('carol')).toEqual([]);
  });

  it('getAllBroadcasts / getActiveBroadcasts reflect stored state', () => {
    const a = broadcastFixture(['alice']);
    const b = broadcastFixture(['bob']);
    expect(
      getAllBroadcasts()
        .map((x) => x.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(getActiveBroadcasts()).toHaveLength(2);
  });

  it('acknowledgeNotification persists the acknowledgement across a fresh read', () => {
    const b = broadcastFixture(['alice']);
    const ack = acknowledgeNotification('alice', b.id);
    expect(ack?.acknowledged).toBe(true);

    // Re-read from the store (not the returned reference) to prove it persisted.
    const stored = getStakeholderNotifications('alice')[0];
    expect(stored.acknowledged).toBe(true);
    expect(stored.acknowledgedAt).toBeTypeOf('number');

    const logEntry = getBroadcast(b.id)?.broadcastLog.find((e) => e.stakeholder === 'alice');
    expect(logEntry?.status).toBe('acknowledged');
  });

  it('acknowledgeNotification returns undefined for an unknown stakeholder', () => {
    broadcastFixture(['alice']);
    expect(acknowledgeNotification('nobody', 'broadcast-x')).toBeUndefined();
  });

  it('resolveBroadcast persists the resolved status', () => {
    const b = broadcastFixture(['alice']);
    resolveBroadcast(b.id);
    expect(getBroadcast(b.id)?.status).toBe('resolved');
    expect(getActiveBroadcasts()).toHaveLength(0);
  });

  it('cancelBroadcast persists the cancelled status', () => {
    const b = broadcastFixture(['alice']);
    cancelBroadcast(b.id);
    expect(getBroadcast(b.id)?.status).toBe('cancelled');
  });

  it('resolve / cancel return undefined for an unknown id', () => {
    expect(resolveBroadcast('missing')).toBeUndefined();
    expect(cancelBroadcast('missing')).toBeUndefined();
  });

  it('getBroadcastStats aggregates broadcasts and notifications', () => {
    const a = broadcastFixture(['alice', 'bob']);
    broadcastFixture(['carol']);
    acknowledgeNotification('alice', a.id);
    resolveBroadcast(a.id);

    const stats = getBroadcastStats();
    expect(stats.totalBroadcasts).toBe(2);
    expect(stats.activeBroadcasts).toBe(1);
    expect(stats.resolvedBroadcasts).toBe(1);
    expect(stats.totalNotifications).toBe(3);
    expect(stats.acknowledgedNotifications).toBe(1);
  });
});
