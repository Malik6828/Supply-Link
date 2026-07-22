import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCollection, __resetStores } from '@/lib/store';

interface Item {
  id: string;
  label: string;
  count?: number;
}

describe('createCollection', () => {
  beforeEach(() => {
    __resetStores();
  });

  it('exposes the namespace it was created with', () => {
    const c = createCollection<Item>('widget');
    expect(c.namespace).toBe('widget');
  });

  it('stores and retrieves a record by id', () => {
    const c = createCollection<Item>('widget');
    const item = { id: 'a', label: 'Alpha' };
    c.set(item.id, item);
    expect(c.get('a')).toEqual(item);
  });

  it('returns null for an unknown id', () => {
    const c = createCollection<Item>('widget');
    expect(c.get('missing')).toBeNull();
  });

  it('overwrites an existing record on set', () => {
    const c = createCollection<Item>('widget');
    c.set('a', { id: 'a', label: 'first' });
    c.set('a', { id: 'a', label: 'second' });
    expect(c.get('a')?.label).toBe('second');
    expect(c.list()).toEqual(['a']);
  });

  it('delete removes the record and reports prior existence', () => {
    const c = createCollection<Item>('widget');
    c.set('a', { id: 'a', label: 'Alpha' });
    expect(c.delete('a')).toBe(true);
    expect(c.get('a')).toBeNull();
    expect(c.delete('a')).toBe(false);
  });

  it('list returns bare ids, all returns records', () => {
    const c = createCollection<Item>('widget');
    c.set('a', { id: 'a', label: 'Alpha' });
    c.set('b', { id: 'b', label: 'Beta' });
    expect(c.list().sort()).toEqual(['a', 'b']);
    expect(
      c
        .all()
        .map((i) => i.label)
        .sort(),
    ).toEqual(['Alpha', 'Beta']);
  });

  it('clear removes every record in the namespace', () => {
    const c = createCollection<Item>('widget');
    c.set('a', { id: 'a', label: 'Alpha' });
    c.set('b', { id: 'b', label: 'Beta' });
    c.clear();
    expect(c.list()).toEqual([]);
    expect(c.all()).toEqual([]);
  });

  it('isolates namespaces so collections never observe each other', () => {
    const widgets = createCollection<Item>('widget');
    const gadgets = createCollection<Item>('gadget');
    widgets.set('a', { id: 'a', label: 'widget-a' });
    gadgets.set('a', { id: 'a', label: 'gadget-a' });

    expect(widgets.get('a')?.label).toBe('widget-a');
    expect(gadgets.get('a')?.label).toBe('gadget-a');
    expect(widgets.list()).toEqual(['a']);
    expect(gadgets.list()).toEqual(['a']);

    widgets.clear();
    expect(widgets.all()).toEqual([]);
    expect(gadgets.all()).toHaveLength(1);
  });

  it('preserves reference semantics: mutating a returned object is visible on next get', () => {
    const c = createCollection<Item>('widget');
    c.set('a', { id: 'a', label: 'Alpha', count: 1 });
    const fetched = c.get('a')!;
    fetched.count = 42;
    expect(c.get('a')?.count).toBe(42);
  });

  it('does not leak an id from one namespace into a same-suffixed one', () => {
    // "user" and "user-role" both begin with "user" but must not cross-list.
    const users = createCollection<Item>('user');
    const roles = createCollection<Item>('user-role');
    users.set('1', { id: '1', label: 'u' });
    roles.set('1', { id: '1', label: 'r' });
    expect(users.list()).toEqual(['1']);
    expect(roles.list()).toEqual(['1']);
  });

  describe('TTL', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('treats omitted / 0 TTL as no expiry', () => {
      vi.useFakeTimers();
      const c = createCollection<Item>('widget');
      c.set('a', { id: 'a', label: 'Alpha' });
      vi.advanceTimersByTime(10 * 365 * 24 * 60 * 60 * 1000);
      expect(c.get('a')).not.toBeNull();
    });

    it('expires a record after its TTL elapses', () => {
      vi.useFakeTimers();
      const c = createCollection<Item>('widget');
      c.set('a', { id: 'a', label: 'Alpha' }, 5);
      expect(c.get('a')).not.toBeNull();
      vi.advanceTimersByTime(5_001);
      expect(c.get('a')).toBeNull();
      // Expired entries drop out of listings too.
      expect(c.list()).toEqual([]);
      expect(c.all()).toEqual([]);
    });
  });
});
