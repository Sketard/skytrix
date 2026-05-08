import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LruMap } from './lru-map.js';

describe('LruMap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic get/set', () => {
    it('returns undefined for absent keys', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000 });
      expect(m.get('missing')).toBeUndefined();
    });

    it('stores and retrieves values', () => {
      const m = new LruMap<string>({ maxEntries: 3, ttlMs: 1000 });
      m.set('a', 'value-a');
      expect(m.get('a')).toBe('value-a');
    });

    it('reports size correctly', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000 });
      expect(m.size).toBe(0);
      m.set('a', 1);
      m.set('b', 2);
      expect(m.size).toBe(2);
    });

    it('has() reflects presence without affecting LRU order or TTL', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000 });
      m.set('a', 1);
      expect(m.has('a')).toBe(true);
      expect(m.has('missing')).toBe(false);
    });
  });

  describe('TTL expiry', () => {
    it('evicts entries after ttlMs', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000 });
      m.set('a', 1);
      vi.advanceTimersByTime(999);
      expect(m.get('a')).toBe(1);
      vi.advanceTimersByTime(1);
      expect(m.get('a')).toBeUndefined();
    });

    it('fires onEvict with reason="ttl" when TTL expires', () => {
      const onEvict = vi.fn();
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000, onEvict });
      m.set('a', 1);
      vi.advanceTimersByTime(1000);
      expect(onEvict).toHaveBeenCalledWith('a', 1, 'ttl');
    });

    it('get() does NOT refresh TTL', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000 });
      m.set('a', 1);
      vi.advanceTimersByTime(500);
      m.get('a'); // read without touch
      vi.advanceTimersByTime(500);
      expect(m.get('a')).toBeUndefined();
    });

    it('touch() refreshes TTL', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000 });
      m.set('a', 1);
      vi.advanceTimersByTime(500);
      m.touch('a');
      vi.advanceTimersByTime(999);
      expect(m.get('a')).toBe(1);
      vi.advanceTimersByTime(1);
      expect(m.get('a')).toBeUndefined();
    });

    it('touch() on absent key is a no-op', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000 });
      expect(() => m.touch('missing')).not.toThrow();
    });
  });

  describe('LRU capacity eviction', () => {
    it('evicts oldest entry when at capacity', () => {
      const m = new LruMap<number>({ maxEntries: 2, ttlMs: 10_000 });
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3); // forces eviction of 'a'
      expect(m.get('a')).toBeUndefined();
      expect(m.get('b')).toBe(2);
      expect(m.get('c')).toBe(3);
    });

    it('fires onEvict with reason="lru" on capacity eviction', () => {
      const onEvict = vi.fn();
      const m = new LruMap<number>({ maxEntries: 2, ttlMs: 10_000, onEvict });
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3);
      expect(onEvict).toHaveBeenCalledWith('a', 1, 'lru');
    });

    it('touch() bumps the entry to most-recent — protects from LRU eviction', () => {
      const m = new LruMap<number>({ maxEntries: 2, ttlMs: 10_000 });
      m.set('a', 1);
      m.set('b', 2);
      m.touch('a'); // 'a' becomes most-recent; 'b' is now oldest
      m.set('c', 3); // evicts 'b'
      expect(m.get('a')).toBe(1);
      expect(m.get('b')).toBeUndefined();
      expect(m.get('c')).toBe(3);
    });

    it('overwrite of existing key does NOT evict another entry', () => {
      const m = new LruMap<number>({ maxEntries: 2, ttlMs: 10_000 });
      m.set('a', 1);
      m.set('b', 2);
      m.set('a', 99); // overwrite, not insert
      expect(m.size).toBe(2);
      expect(m.get('a')).toBe(99);
      expect(m.get('b')).toBe(2);
    });

    it('overwrite of existing key does NOT fire onEvict for the old value', () => {
      const onEvict = vi.fn();
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 10_000, onEvict });
      m.set('a', 1);
      m.set('a', 2);
      expect(onEvict).not.toHaveBeenCalled();
    });

    it('overwrite refreshes TTL on the same key', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000 });
      m.set('a', 1);
      vi.advanceTimersByTime(500);
      m.set('a', 2);
      vi.advanceTimersByTime(999);
      expect(m.get('a')).toBe(2);
      vi.advanceTimersByTime(1);
      expect(m.get('a')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('removes the entry', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 10_000 });
      m.set('a', 1);
      m.delete('a');
      expect(m.get('a')).toBeUndefined();
      expect(m.size).toBe(0);
    });

    it('fires onEvict with reason="delete"', () => {
      const onEvict = vi.fn();
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 10_000, onEvict });
      m.set('a', 1);
      m.delete('a');
      expect(onEvict).toHaveBeenCalledWith('a', 1, 'delete');
    });

    it('clears the TTL timer (no late onEvict for the deleted key)', () => {
      const onEvict = vi.fn();
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000, onEvict });
      m.set('a', 1);
      m.delete('a');
      onEvict.mockClear();
      vi.advanceTimersByTime(2000);
      expect(onEvict).not.toHaveBeenCalled();
    });

    it('is a no-op on absent keys', () => {
      const onEvict = vi.fn();
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 10_000, onEvict });
      m.delete('missing');
      expect(onEvict).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('removes every entry', () => {
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 10_000 });
      m.set('a', 1);
      m.set('b', 2);
      m.clear();
      expect(m.size).toBe(0);
      expect(m.get('a')).toBeUndefined();
      expect(m.get('b')).toBeUndefined();
    });

    it('does NOT fire onEvict (used at shutdown)', () => {
      const onEvict = vi.fn();
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 10_000, onEvict });
      m.set('a', 1);
      m.set('b', 2);
      m.clear();
      expect(onEvict).not.toHaveBeenCalled();
    });

    it('clears all TTL timers', () => {
      const onEvict = vi.fn();
      const m = new LruMap<number>({ maxEntries: 3, ttlMs: 1000, onEvict });
      m.set('a', 1);
      m.set('b', 2);
      m.clear();
      vi.advanceTimersByTime(2000);
      expect(onEvict).not.toHaveBeenCalled();
    });
  });
});
