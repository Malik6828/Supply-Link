import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  kvStore,
  getJSON,
  setJSON,
  listByPrefix,
  namespaceKey,
  namespacePrefix,
  createCollection,
  __resetStores,
} from '@/lib/store';

describe('namespace key builders', () => {
  it('namespaceKey joins namespace and id with the separator', () => {
    expect(namespaceKey('revocation', 'rev-1')).toBe('revocation:rev-1');
  });

  it('namespacePrefix returns the trailing-separator prefix', () => {
    expect(namespacePrefix('revocation')).toBe('revocation:');
  });

  it('shares a keyspace between the KVStore and repository facades', async () => {
    // Both facades read/write the same shared backend, so a namespaced KV
    // write is discoverable through the matching collection's listing. Note
    // the value encodings differ by design: KVStore/setJSON persist
    // serialized strings, while collections hold objects by reference — so a
    // collection reading a setJSON key sees the raw JSON string. Services pick
    // exactly one facade per namespace; this test documents the boundary.
    __resetStores();
    await setJSON(namespaceKey('thing', 'x'), { id: 'x', label: 'L' });
    const things = createCollection<unknown>('thing');
    expect(things.list()).toEqual(['x']);
    expect(things.get('x')).toBe('{"id":"x","label":"L"}');
  });
});

describe('typed JSON helpers', () => {
  beforeEach(() => {
    __resetStores();
  });

  it('round-trips a value through setJSON / getJSON', async () => {
    await setJSON('k', { a: 1, b: ['two'] });
    expect(await getJSON<{ a: number; b: string[] }>('k')).toEqual({
      a: 1,
      b: ['two'],
    });
  });

  it('getJSON returns null for a missing key', async () => {
    expect(await getJSON('nope')).toBeNull();
  });
});

describe('in-memory KVStore', () => {
  beforeEach(() => {
    __resetStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('get/set/del operate on string values', async () => {
    await kvStore.set('k', 'v', 0);
    expect(await kvStore.get('k')).toBe('v');
    await kvStore.del('k');
    expect(await kvStore.get('k')).toBeNull();
  });

  it('listByPrefix returns only matching keys', async () => {
    await kvStore.set('a:1', 'x', 0);
    await kvStore.set('a:2', 'y', 0);
    await kvStore.set('b:1', 'z', 0);
    expect((await listByPrefix('a:')).sort()).toEqual(['a:1', 'a:2']);
  });

  it('honours TTL expiry', async () => {
    vi.useFakeTimers();
    await kvStore.set('k', 'v', 2);
    expect(await kvStore.get('k')).toBe('v');
    vi.advanceTimersByTime(2_001);
    expect(await kvStore.get('k')).toBeNull();
  });
});

describe('__resetStores', () => {
  it('clears state between calls under NODE_ENV=test', () => {
    const c = createCollection<{ id: string }>('reset-check');
    c.set('a', { id: 'a' });
    expect(c.list()).toEqual(['a']);
    __resetStores();
    expect(c.list()).toEqual([]);
  });
});
