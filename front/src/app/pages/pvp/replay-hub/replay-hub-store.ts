import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ReplayService } from '../../../services/replay.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReplayDTO } from '../../../core/model/dto/replay-dto';
import { ReplayStatsDTO } from '../../../core/model/dto/replay-stats-dto';
import { DuelResult } from '../../../core/enums/duel-result.enum';
import { ListStore } from '../../../core/store/list-store';

const PAGE_SIZE = 20;
const NEXT_PAGE_TRIGGER_OFFSET = 5;
const LAST_7_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type ReplaySortMode = 'newest' | 'oldest' | 'mostTurns';
export type ReplayFilter = 'all' | 'favorites' | 'wins' | 'losses' | 'solo' | 'last7days';

/**
 * Owns the Replay Hub state machine. Extends `ListStore<ReplayDTO>` for the
 * cross-cutting items/loading/error/search/sort/filter plumbing; adds the
 * replay-specific REST pagination, stats fetch, and optimistic delete with
 * rollback on top. Lives at the `ReplayHubPageComponent` route scope
 * (provided in the component) so the subscription teardown is scoped to
 * navigation away.
 *
 * Public API (in addition to the ListStore base):
 *   - `replays()` — alias of `items()`. `filteredReplays()` — alias of
 *     `filteredItems()`. Domain-named for the template + computeds.
 *   - `stats()` — win/loss aggregate; null until fetched / on fetch error.
 *   - `hasMore()` — paginate guard for the scroll-driven loadNextPage.
 *   - `fetchingMore()` — drives the inline pagination skeleton.
 *   - `start()` — wires initial fetch (snapshot + stats). Called from ngOnInit.
 *   - `fetchSnapshot()`, `loadNextPage()` — pagination drivers.
 *   - `deleteReplay(id)` — optimistic delete with rollback on error.
 */
@Injectable()
export class ReplayHubStore extends ListStore<ReplayDTO, ReplaySortMode, ReplayFilter> {
  private readonly replayService = inject(ReplayService);
  private readonly authService = inject(AuthService);
  private readonly notify = inject(NotificationService);

  /** Domain-named alias of `items()` — clearer at call sites. */
  readonly replays = this.items;
  /** Domain-named alias of `filteredItems()`. */
  readonly filteredReplays = this.filteredItems;

  readonly stats = signal<ReplayStatsDTO | null>(null);

  private readonly currentOffset = signal(0);
  private readonly totalElements = signal<number | null>(null);
  private readonly _fetchingMore = signal(false);

  /** ID of the replay currently being toggled (HTTP in-flight), or null.
   *  Drives the per-row spinner in the favorite icon-button — same pattern
   *  as `deletingId` in the component, kept in the store so the page reload
   *  doesn't lose mid-flight state (mirrors the optimistic update model). */
  readonly favoritingId = signal<string | null>(null);

  /** Public read-only view of the "loading more" flag — drives the inline
   *  skeleton at the bottom of the virtual-scroll viewport (Q6-3). The
   *  internal `_fetchingMore` stays private so writes go through
   *  `loadNextPage()` exclusively. */
  readonly fetchingMore = this._fetchingMore.asReadonly();

  readonly hasMore = computed(() => {
    const total = this.totalElements();
    return total === null ? false : this.replays().length < total;
  });

  constructor() {
    super('newest', 'all');
  }

  start(): void {
    this.fetchSnapshot();
    this.fetchStats();
  }

  /** Re-fetches the entire first page (clears the list). When the active
   *  filter is `'favorites'`, the source endpoint is `/replays/favorites` —
   *  paginated server-side. Otherwise the full match-history endpoint. */
  fetchSnapshot(): void {
    this.setLoading(true);
    this.error.set(null);
    this.currentOffset.set(0);
    this.pageFetcher(0).subscribe({
      next: page => {
        this.items.set(page.elements);
        this.totalElements.set(page.size);
        // `currentOffset` tracks the Spring page index (0-based). After page 0
        // landed, the next page to request is index 1. See `loadNextPage` for
        // the protocol — the back's `offset` query param is actually a page
        // index, not a row offset (see ReplayController.java:50).
        this.currentOffset.set(1);
        this.setLoading(false);
      },
      error: err => {
        this.error.set(err?.message ?? 'Failed to load replays');
        this.setLoading(false);
      },
    });
  }

  /** Routes paginated fetches to the right endpoint based on `activeFilter`.
   *  `'favorites'` hits `/replays/favorites` (server-side filter — pagination
   *  is correct even when the user has 500 replays and 10 favorites); every
   *  other filter mode runs against the full `/replays` list with the
   *  filter applied client-side. */
  private pageFetcher(pageIndex: number) {
    return this.activeFilter() === 'favorites'
      ? this.replayService.getFavoritedReplays(pageIndex, PAGE_SIZE)
      : this.replayService.getMatchHistory(pageIndex, PAGE_SIZE);
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
    this.pageFetcher(pageIndex).subscribe({
      next: page => {
        this.items.update(prev => [...prev, ...page.elements]);
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

  /** Override the base `setActiveFilter` to re-fetch when crossing the
   *  `favorites` boundary — the two filter modes use different endpoints, so
   *  swapping between them requires a fresh page-0 fetch. Other filters
   *  (wins/losses/solo/last7days) keep the in-memory list and only re-run
   *  `passesFilter` via the `filteredItems` computed. */
  override setActiveFilter(filter: ReplayFilter): void {
    const previous = this.activeFilter();
    if (previous === filter) return;
    super.setActiveFilter(filter);
    if (previous === 'favorites' || filter === 'favorites') {
      this.fetchSnapshot();
    }
  }

  /** Optimistic favorite toggle. Flips `isFavorite` locally + fires HTTP;
   *  rollbacks on error. When the active filter is `'favorites'` and the
   *  user un-favorites a replay, we ALSO remove it from the visible list
   *  (server-side it disappears from the next page fetch — keeping it
   *  on-screen would lie to the user). */
  async toggleFavorite(id: string): Promise<void> {
    const current = this.replays().find(r => r.id === id);
    if (!current) return;
    const willBeFavorited = !current.isFavorite;
    const snapshot = this.replays();
    const wasFavoritesFilter = this.activeFilter() === 'favorites';

    this.items.update(list => list.map(r => r.id === id ? { ...r, isFavorite: willBeFavorited } : r));
    if (wasFavoritesFilter && !willBeFavorited) {
      this.items.update(list => list.filter(r => r.id !== id));
      this.totalElements.update(n => (n === null ? null : Math.max(0, n - 1)));
    }

    this.favoritingId.set(id);
    try {
      await firstValueFrom(
        willBeFavorited
          ? this.replayService.addFavorite(id)
          : this.replayService.removeFavorite(id),
      );
    } catch (err) {
      this.items.set(snapshot);
      if (wasFavoritesFilter && !willBeFavorited) {
        this.totalElements.update(n => (n === null ? null : n + 1));
      }
      this.notify.error(err instanceof HttpErrorResponse ? err : String(err));
    } finally {
      this.favoritingId.set(null);
    }
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

  /**
   * Optimistic delete: remove from list immediately, rollback on backend
   * error. Stats are refreshed asynchronously since the totals shift.
   */
  async deleteReplay(id: string): Promise<void> {
    const snapshot = this.replays();
    this.items.update(list => list.filter(r => r.id !== id));
    this.totalElements.update(n => (n === null ? null : Math.max(0, n - 1)));
    try {
      await firstValueFrom(this.replayService.deleteReplay(id));
      this.fetchStats();
    } catch (err) {
      // Rollback
      this.items.set(snapshot);
      this.totalElements.update(n => (n === null ? null : n + 1));
      this.notify.error(err instanceof HttpErrorResponse ? err : String(err));
    }
  }

  // ─── ListStore hooks ──────────────────────────────────────────────────────

  /** Search matches against the opponent username + both deck names
   *  (case-insensitive contains). `query` is already trimmed + lowercased. */
  protected searchMatches(r: ReplayDTO, query: string): boolean {
    const { oppSide, mySide } = this.sides(r);
    const oppName = (r.metadata.playerUsernames[oppSide] ?? '').toLowerCase();
    const oppDeck = (r.metadata.deckNames[oppSide] ?? '').toLowerCase();
    const myDeck = (r.metadata.deckNames[mySide] ?? '').toLowerCase();
    return oppName.includes(query) || oppDeck.includes(query) || myDeck.includes(query);
  }

  protected passesFilter(r: ReplayDTO, mode: ReplayFilter): boolean {
    const result = r.metadata.result;
    switch (mode) {
      // Solo replays have an arbitrary win/loss result (the user plays both
      // sides), so they are excluded from wins/losses — same rationale as
      // their exclusion from the win/loss stats.
      case 'wins':
        return !isSolo(r) && isWin(result);
      case 'losses':
        return !isSolo(r) && isLoss(result);
      case 'solo':
        return isSolo(r);
      case 'last7days':
        return new Date(r.createdAt).getTime() >= Date.now() - LAST_7_DAYS_MS;
      // Items already come from `/replays/favorites` server-side, so this
      // predicate is normally a no-op pass — but during the optimistic
      // un-favorite window the flipped item must drop out of the list.
      case 'favorites':
        return r.isFavorite === true;
      case 'all':
      default:
        return true;
    }
  }

  protected sortItems(items: ReplayDTO[], mode: ReplaySortMode): ReplayDTO[] {
    switch (mode) {
      case 'oldest':
        return items.sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      case 'mostTurns':
        return items.sort((a, b) => b.metadata.turnCount - a.metadata.turnCount);
      case 'newest':
      default:
        return items.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }
  }

  /** Resolve which metadata index (0/1) is the current user vs the opponent.
   *  The user is `player1` when their id matches `player1Id`, else `player2`. */
  private sides(r: ReplayDTO): { mySide: 0 | 1; oppSide: 0 | 1 } {
    const userId = this.authService.user()?.id ?? -1;
    const isP1 = r.player1Id === userId;
    return isP1 ? { mySide: 0, oppSide: 1 } : { mySide: 1, oppSide: 0 };
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

/** A solo "quick duel" — same user on both sides. Excluded from win/loss
 *  stats and from the wins/losses filters (arbitrary result). */
function isSolo(r: ReplayDTO): boolean {
  return r.player1Id === r.player2Id;
}
