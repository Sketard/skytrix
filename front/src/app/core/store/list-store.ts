import { Signal, computed, signal } from '@angular/core';

/**
 * Abstract state machine shared by every index-page store (lobby rooms,
 * replay hub, deck list). Owns the cross-cutting state — items / loading /
 * error / search / sort / filter — and the derived `filteredItems`
 * computed. Concrete stores implement the 3 hooks (`searchMatches`,
 * `passesFilter`, `sortItems`) and add their own fetch + mutation methods.
 *
 * The generic parameter `FilterMode` defaults to `'all'` for stores that
 * don't have a filter-chip row; pass a union (`'all' | 'wins' | …`) when
 * you do.
 *
 * Usage:
 * ```ts
 * @Injectable()
 * export class DeckListStore extends ListStore<ShortDeck, 'all'> {
 *   constructor() { super('recent', 'all'); }
 *
 *   protected searchMatches(item, query) {
 *     return formattedWithoutCaseAndAccent(item.name).includes(query);
 *   }
 *   protected passesFilter(_item, _mode) { return true; }
 *   protected sortItems(items, mode) { ... }
 * }
 * ```
 */
export abstract class ListStore<T, SortMode extends string = string, FilterMode extends string = 'all'> {
  /** Raw items signal. Concrete stores write to it via setters or in `start()`. */
  readonly items = signal<T[]>([]);
  readonly error = signal<string | null>(null);

  /** Loading flag. Defaults to a writable signal seeded `true`; concrete
   *  stores write it via `setLoading()`. A subclass that already owns a
   *  loading signal elsewhere (e.g. a shared service's `isFirstDeckLoad`)
   *  can override this property with a plain `Signal<boolean>` alias —
   *  hence the public type is the read-only `Signal<boolean>`. */
  readonly loading: Signal<boolean> = signal<boolean>(true);

  /** Mutate the default `loading` signal. No-op contract violation if a
   *  subclass overrode `loading` with a non-writable alias — those stores
   *  manage their own loading source and must not call this. */
  protected setLoading(value: boolean): void {
    (this.loading as ReturnType<typeof signal<boolean>>).set(value);
  }

  readonly searchQuery = signal<string>('');
  readonly sortMode: ReturnType<typeof signal<SortMode>>;
  readonly activeFilter: ReturnType<typeof signal<FilterMode>>;
  private readonly _initialFilter: FilterMode;

  /** Read-only view of the filtered + sorted items. Drives the template's
   *  `*ngFor` / virtual scroll. */
  readonly filteredItems: Signal<T[]>;

  readonly hasSearchActive = computed(() => this.searchQuery().trim().length > 0);

  /** True when the source list is empty (no items at all) and we're not
   *  loading or erroring. Use for the welcome / first-run empty state. */
  readonly showEmptyState = computed(() =>
    !this.loading() && !this.error() && this.items().length === 0,
  );

  /** True when the source list has items but the filter pipeline excludes
   *  them all. Use for the no-results state with a "clear filters" CTA. */
  readonly showNoResultsState = computed(() =>
    !this.loading() && !this.error()
    && this.items().length > 0
    && this.filteredItems().length === 0,
  );

  constructor(initialSort: SortMode, initialFilter: FilterMode) {
    this.sortMode = signal(initialSort);
    this.activeFilter = signal(initialFilter);
    this._initialFilter = initialFilter;

    this.filteredItems = computed(() => {
      const query = this.normalizeQuery(this.searchQuery());
      const filter = this.activeFilter();
      const mode = this.sortMode();
      // `Array.prototype.filter` already returns a fresh array — `sortItems`
      // receives an array it fully owns and may mutate in place (e.g. via
      // `.sort()`). It never aliases `items()`, so an in-place sort here can
      // never mutate the source signal.
      const filtered = this.items().filter(item => {
        if (query && !this.searchMatches(item, query)) return false;
        if (!this.passesFilter(item, filter)) return false;
        return true;
      });
      return this.sortItems(filtered, mode);
    });
  }

  // ─── Public mutators ──────────────────────────────────────────────────────

  setSearchQuery(q: string): void { this.searchQuery.set(q); }
  setSortMode(m: SortMode): void { this.sortMode.set(m); }
  setActiveFilter(f: FilterMode): void { this.activeFilter.set(f); }
  clearSearch(): void { this.searchQuery.set(''); }

  /** Reset both search and filter (filter reset is no-op when FilterMode is 'all'). */
  clearFilters(): void {
    this.searchQuery.set('');
    this.activeFilter.set(this._initialFilter);
  }

  // ─── Hooks for concrete stores ────────────────────────────────────────────

  /** Normalize the raw search input before passing it to `searchMatches`.
   *  Default: trim + lowercase. Override for accent-insensitive matching. */
  protected normalizeQuery(raw: string): string {
    return raw.trim().toLowerCase();
  }

  /** Return true when `item` matches `query`. `query` is the normalized
   *  output of `normalizeQuery` (never empty here — the caller short-circuits). */
  protected abstract searchMatches(item: T, query: string): boolean;

  /** Return true when `item` passes the active filter. Stores without a
   *  filter-chip row override to `return true`. */
  protected abstract passesFilter(item: T, mode: FilterMode): boolean;

  /** Return the input array sorted according to `mode`. Mutates `items` in
   *  place — the caller already passes a fresh shallow copy. */
  protected abstract sortItems(items: T[], mode: SortMode): T[];
}
