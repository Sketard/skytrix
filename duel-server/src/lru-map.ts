/**
 * Bounded LRU map with per-entry TTL.
 *
 * Audit finding M4 — replaces the inline-on-Map LRU pattern in `server.ts`
 * (4 delete sites + 2 set sites manipulating the timer + insertion order
 * by hand). Centralizes the invariants (Map iteration order is the LRU
 * order; TTL must be cleared on every removal path) so callers can reason
 * about `get`/`touch`/`set`/`delete` without knowing the implementation.
 *
 * Iteration order = insertion order in JS Maps. We rely on that to find
 * "oldest" via `keys().next().value` when capacity is exceeded.
 *
 * `get` does NOT refresh TTL (used by paths that just need to read without
 * extending lifetime, e.g. error eviction or auth re-check). Callers that
 * want LRU-touch semantics call `touch` after `get`.
 */
export interface LruMapOptions<V> {
  /** Maximum entries before LRU eviction kicks in. */
  maxEntries: number;
  /** Per-entry TTL in milliseconds. */
  ttlMs: number;
  /** Optional callback fired when an entry is evicted (TTL expiry OR LRU
   *  capacity OR explicit delete). NOT fired for `set` overwrites of the
   *  same key. */
  onEvict?: (key: string, value: V, reason: 'ttl' | 'lru' | 'delete') => void;
}

interface Entry<V> {
  value: V;
  timer: ReturnType<typeof setTimeout>;
}

export class LruMap<V> {
  private readonly _map = new Map<string, Entry<V>>();
  constructor(private readonly opts: LruMapOptions<V>) {}

  /** Number of entries currently stored. */
  get size(): number {
    return this._map.size;
  }

  /** Read without affecting LRU order or TTL. Returns undefined if absent. */
  get(key: string): V | undefined {
    return this._map.get(key)?.value;
  }

  /** Whether the key is present (no LRU/TTL effect). */
  has(key: string): boolean {
    return this._map.has(key);
  }

  /** Refresh TTL and bump the entry to the most-recent end of LRU order.
   *  No-op if the key is absent. */
  touch(key: string): void {
    const entry = this._map.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this._map.delete(key);
    const timer = setTimeout(() => this._evict(key, 'ttl'), this.opts.ttlMs);
    this._map.set(key, { value: entry.value, timer });
  }

  /** Insert or overwrite. If at capacity, evicts the oldest entry first
   *  (with reason='lru'). Overwriting an existing key does NOT fire onEvict
   *  for the old value. */
  set(key: string, value: V): void {
    const existing = this._map.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this._map.delete(key);
    } else if (this._map.size >= this.opts.maxEntries) {
      const oldestKey = this._map.keys().next().value;
      if (oldestKey !== undefined) this._evict(oldestKey, 'lru');
    }
    const timer = setTimeout(() => this._evict(key, 'ttl'), this.opts.ttlMs);
    this._map.set(key, { value, timer });
  }

  /** Remove an entry. Fires onEvict with reason='delete'. No-op if absent. */
  delete(key: string): void {
    this._evict(key, 'delete');
  }

  /** Clear every entry without firing onEvict. Used at shutdown. */
  clear(): void {
    for (const entry of this._map.values()) clearTimeout(entry.timer);
    this._map.clear();
  }

  private _evict(key: string, reason: 'ttl' | 'lru' | 'delete'): void {
    const entry = this._map.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this._map.delete(key);
    this.opts.onEvict?.(key, entry.value, reason);
  }
}
