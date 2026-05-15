import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ReplayService } from '../../../services/replay.service';
import { AuthService } from '../../../services/auth.service';
import { DeckBuildService } from '../../../services/deck-build.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReplayDTO } from '../../../core/model/dto/replay-dto';
import { ReplayStatsDTO } from '../../../core/model/dto/replay-stats-dto';
import { DuelResult } from '../../../core/enums/duel-result.enum';

const PAGE_SIZE = 20;
const NEXT_PAGE_TRIGGER_OFFSET = 5;

export type ReplaySortMode = 'newest' | 'oldest' | 'mostTurns';
export type ReplayFilter = 'all' | 'wins' | 'losses' | 'myDeck' | 'last7days';

/**
 * Owns the Replay Hub state machine: REST pagination, search/filter/sort
 * derivation, and optimistic delete with rollback. Lives at the
 * `ReplayHubPageComponent` route scope (provided in the component) so the
 * subscription teardown is scoped to navigation away.
 *
 * Public API:
 *   - `replays()`, `stats()`, `loading()`, `error()` — display state.
 *   - `filteredReplays()` — computed product of search + filter + sort.
 *   - `hasMore()` — paginate guard for the scroll-driven loadNextPage.
 *   - `start()` — wires initial fetch (snapshot + stats). Called from ngOnInit.
 *   - `fetchSnapshot()`, `loadNextPage()` — pagination drivers.
 *   - `setSearchQuery`, `setSortMode`, `setActiveFilter` — UI bindings.
 *   - `deleteReplay(id)` — optimistic delete with rollback on error.
 */
@Injectable()
export class ReplayHubStore {
  private readonly replayService = inject(ReplayService);
  private readonly authService = inject(AuthService);
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly replays = signal<ReplayDTO[]>([]);
  readonly stats = signal<ReplayStatsDTO | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly searchQuery = signal('');
  readonly sortMode = signal<ReplaySortMode>('newest');
  readonly activeFilter = signal<ReplayFilter>('all');

  private readonly currentOffset = signal(0);
  private readonly totalElements = signal<number | null>(null);
  private readonly _fetchingMore = signal(false);

  /** Public read-only view of the "loading more" flag — drives the inline
   *  skeleton at the bottom of the virtual-scroll viewport (Q6-3). The
   *  internal `_fetchingMore` stays private so writes go through
   *  `loadNextPage()` exclusively. */
  readonly fetchingMore = this._fetchingMore.asReadonly();

  // Default deck name (first in user's deck list, refreshed when decks$ fires).
  // Used by the "myDeck" filter — falls back to '' when the user has no decks.
  private readonly defaultDeckName = signal<string>('');

  readonly hasMore = computed(() => {
    const total = this.totalElements();
    return total === null ? false : this.replays().length < total;
  });

  readonly hasDecks = computed(() => this.defaultDeckName().length > 0);

  /**
   * Filtered + sorted product of the source list. Search matches against
   * opponent username + opposing deck name (case-insensitive contains).
   */
  readonly filteredReplays = computed(() => {
    const userId = this.authService.user()?.id ?? -1;
    const query = this.searchQuery().toLowerCase().trim();
    const filter = this.activeFilter();
    const sort = this.sortMode();
    const defaultDeck = this.defaultDeckName();
    const now = Date.now();
    const last7Cutoff = now - 7 * 24 * 60 * 60 * 1000;

    const filtered = this.replays().filter(r => {
      const isP1 = r.player1Id === userId;
      const mySide = isP1 ? 0 : 1;
      const oppSide = isP1 ? 1 : 0;

      // Search
      if (query) {
        const oppName = (r.metadata.playerUsernames[oppSide] ?? '').toLowerCase();
        const oppDeck = (r.metadata.deckNames[oppSide] ?? '').toLowerCase();
        const myDeck = (r.metadata.deckNames[mySide] ?? '').toLowerCase();
        if (!oppName.includes(query) && !oppDeck.includes(query) && !myDeck.includes(query)) {
          return false;
        }
      }

      // Active filter
      const result = r.metadata.result;
      switch (filter) {
        case 'wins':
          if (!isWin(result)) return false;
          break;
        case 'losses':
          if (!isLoss(result)) return false;
          break;
        case 'myDeck':
          if (defaultDeck && r.metadata.deckNames[mySide] !== defaultDeck) return false;
          break;
        case 'last7days':
          if (new Date(r.createdAt).getTime() < last7Cutoff) return false;
          break;
        case 'all':
        default:
          break;
      }

      return true;
    });

    // Sort
    switch (sort) {
      case 'oldest':
        return filtered.slice().sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      case 'mostTurns':
        return filtered.slice().sort((a, b) =>
          b.metadata.turnCount - a.metadata.turnCount,
        );
      case 'newest':
      default:
        return filtered.slice().sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }
  });

  start(): void {
    this.subscribeToDeckList();
    this.fetchSnapshot();
    this.fetchStats();
  }

  /** Re-fetches the entire first page (clears the list). */
  fetchSnapshot(): void {
    this.loading.set(true);
    this.error.set(null);
    this.currentOffset.set(0);
    this.replayService.getMatchHistory(0, PAGE_SIZE).subscribe({
      next: page => {
        this.replays.set(page.elements);
        this.totalElements.set(page.size);
        // `currentOffset` tracks the Spring page index (0-based). After page 0
        // landed, the next page to request is index 1. See `loadNextPage` for
        // the protocol — the back's `offset` query param is actually a page
        // index, not a row offset (see ReplayController.java:50).
        this.currentOffset.set(1);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.message ?? 'Failed to load replays');
        this.loading.set(false);
      },
    });
  }

  fetchStats(): void {
    this.replayService.getStats().subscribe({
      next: stats => this.stats.set(stats),
      // Stats are best-effort — never block the UI on a stats fetch failure.
      error: () => this.stats.set(null),
    });
  }

  loadNextPage(): void {
    if (this.fetchingMore() || !this.hasMore() || this.loading()) return;
    this._fetchingMore.set(true);
    // `currentOffset` is the *page index* to request next (0-based, see
    // fetchSnapshot). The back's `offset` query param is mapped to
    // `PageRequest.of(page, size)` — Spring page semantics. Sending a row
    // offset (e.g. 20 after one page of 20) would resolve to page=20 and
    // return an empty array, which was the Q5-6 bug.
    const pageIndex = this.currentOffset();
    this.replayService.getMatchHistory(pageIndex, PAGE_SIZE).subscribe({
      next: page => {
        this.replays.update(prev => [...prev, ...page.elements]);
        this.currentOffset.set(pageIndex + 1);
        // Refresh totalElements in case rows landed mid-scroll.
        this.totalElements.set(page.size);
        this._fetchingMore.set(false);
      },
      error: err => {
        this.notify.error(err);
        this._fetchingMore.set(false);
      },
    });
  }

  /** Threshold check used by the virtual-scroll `(scrolledIndexChange)` host.
   *
   *  `renderedEndIndex` is the last index visible in the viewport — measured
   *  against `filteredReplays()` (what the `*cdkVirtualFor` actually renders),
   *  NOT `replays()`. Comparing to `replays().length` was a Q4 bug: under any
   *  active filter the rendered list is shorter, so the threshold was never
   *  reached and infinite scroll silently stalled. */
  shouldLoadMore(renderedEndIndex: number): boolean {
    return renderedEndIndex >= this.filteredReplays().length - NEXT_PAGE_TRIGGER_OFFSET
      && this.hasMore()
      && !this.fetchingMore()
      && !this.loading();
  }

  setSearchQuery(q: string): void { this.searchQuery.set(q); }
  setSortMode(m: ReplaySortMode): void { this.sortMode.set(m); }
  setActiveFilter(f: ReplayFilter): void { this.activeFilter.set(f); }
  clearSearch(): void { this.searchQuery.set(''); }
  clearFilters(): void {
    this.searchQuery.set('');
    this.activeFilter.set('all');
  }

  /**
   * Optimistic delete: remove from list immediately, rollback on backend
   * error. Stats are refreshed asynchronously since the totals shift.
   */
  async deleteReplay(id: string): Promise<void> {
    const snapshot = this.replays();
    this.replays.update(list => list.filter(r => r.id !== id));
    this.totalElements.update(n => (n === null ? null : Math.max(0, n - 1)));
    try {
      await firstValueFrom(this.replayService.deleteReplay(id));
      this.fetchStats();
    } catch (err) {
      // Rollback
      this.replays.set(snapshot);
      this.totalElements.update(n => (n === null ? null : n + 1));
      this.notify.error(err instanceof HttpErrorResponse ? err : String(err));
    }
  }

  private subscribeToDeckList(): void {
    // Reactive to deck list changes — keeps the "myDeck" filter targeted
    // at the first deck of the user's collection. Falls back to '' when the
    // collection is empty (chip disabled in the template).
    this.deckBuildService.decks$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(decks => {
        this.defaultDeckName.set(decks?.[0]?.name ?? '');
      });
  }
}

function isWin(r: DuelResult): boolean {
  return r === DuelResult.VICTORY
    || r === DuelResult.OPPONENT_TIMEOUT
    || r === DuelResult.OPPONENT_DISCONNECT
    || r === DuelResult.OPPONENT_SURRENDER;
}

function isLoss(r: DuelResult): boolean {
  return r === DuelResult.DEFEAT
    || r === DuelResult.TIMEOUT
    || r === DuelResult.DISCONNECT
    || r === DuelResult.SURRENDER;
}
