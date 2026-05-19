import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { OwnedCardService } from '../../../../services/owned-card.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ShortDeck } from '../../../../core/model/short-deck';
import { ShortDeckDTO } from '../../../../core/model/dto/short-deck-dto';
import { StatItem } from '../../../../components/stats-strip/stats-strip.component';
import { formattedWithoutCaseAndAccent } from '../../../../core/utilities/functions';

export type DeckSortMode = 'recent' | 'name' | 'legality';
export const DECK_SORT_MODES: ReadonlyArray<DeckSortMode> = ['recent', 'name', 'legality'];

/**
 * Owns the Deck List page state machine: subscribes to the shared
 * `DeckBuildService.decks$` cache, derives search/sort signals, surfaces
 * loading/error state, and exposes the stats payload feeding
 * `<app-stats-strip>`. Mirror of `ReplayHubStore` (same shape & semantics).
 *
 * Provided at component scope (`@Component({ providers: [DeckListStore] })`)
 * so the subscription teardown follows navigation.
 *
 * Public API:
 *   - `decks()`, `loading()`, `error()` — display state.
 *   - `filteredDecks()` — search + sort applied product.
 *   - `stats()` — `StatItem[]` ready for `<app-stats-strip>`.
 *   - `hasSearchActive()`, `showEmptyState()`, `showNoResultsState()` — view guards.
 *   - `start()` — wires the subscription + initial fetch. Called from ngOnInit.
 *   - `fetchSnapshot()` — re-fetch + clear error.
 *   - `setSearchQuery`, `setSortMode`, `clearSearch` — UI bindings.
 *   - `deleteDeck(id)` — optimistic delete with rollback on error.
 */
@Injectable()
export class DeckListStore {
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly ownedCardService = inject(OwnedCardService);
  private readonly notify = inject(NotificationService);
  private readonly httpClient = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly decks = toSignal(this.deckBuildService.decks$, { initialValue: [] as ShortDeck[] });
  readonly loading = this.deckBuildService.isFirstDeckLoad;
  readonly error = signal<string | null>(null);

  readonly searchQuery = signal('');
  readonly sortMode = signal<DeckSortMode>('recent');
  readonly sortModes = DECK_SORT_MODES;

  readonly hasSearchActive = computed(() => this.searchQuery().trim().length > 0);

  readonly filteredDecks = computed<ShortDeck[]>(() => {
    const term = this.searchQuery().trim();
    const all = this.decks();
    const filtered = term
      ? all.filter(d => formattedWithoutCaseAndAccent(d.name).includes(formattedWithoutCaseAndAccent(term)))
      : [...all];
    switch (this.sortMode()) {
      case 'recent':
        // Latest save first. updatedAt is ISO-8601 so lexicographic compare
        // is chronological. Falls back to id desc when timestamps tie (new
        // decks before V016 backfill would all share NOW()).
        return filtered.sort((a, b) => {
          const cmp = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
          return cmp !== 0 ? cmp : (b.id ?? 0) - (a.id ?? 0);
        });
      case 'name':
        return filtered.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        );
      case 'legality':
        // Legal first (true > false → invert sign), then alphabetical.
        return filtered.sort((a, b) => {
          const cmp = Number(b.valid) - Number(a.valid);
          return cmp !== 0 ? cmp : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
    }
  });

  readonly stats = computed<StatItem[]>(() => {
    const all = this.decks();
    const ownedSum = Array.from(this.ownedCardService.ownedMap().values())
      .reduce((acc, n) => acc + n, 0);
    return [
      {
        labelKey: 'deckStats.decks',
        value: all.length,
        icon: 'folder_special',
        iconVariant: 'total',
        surfaceAccent: 'cyan',
      },
      {
        labelKey: 'deckStats.cardsOwned',
        value: ownedSum,
        icon: 'style',
        iconVariant: 'win',
        valueVariant: 'gold',
        surfaceAccent: 'gold',
      },
      {
        labelKey: 'deckStats.legalDecks',
        value: all.filter(d => d.valid).length,
        icon: 'check_circle',
        iconVariant: 'winrate',
        valueVariant: 'gold',
        surfaceAccent: 'gold',
      },
    ];
  });

  readonly showEmptyState = computed(() =>
    !this.loading() && !this.error() && this.decks().length === 0);

  readonly showNoResultsState = computed(() =>
    !this.loading() && !this.error()
    && this.decks().length > 0 && this.filteredDecks().length === 0);

  start(): void {
    // The shared service may already have a cached value — subscribe to
    // detect transient errors that bypass the cache fallback. The cache
    // itself is owned by DeckBuildService and survives across navigations.
    this.deckBuildService.decks$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // First emit clears any prior error — we're showing live data.
        if (this.error() !== null) this.error.set(null);
      });
    this.fetchSnapshot();
  }

  /** Re-fetches the deck list directly via HTTP to surface errors that
   *  `DeckBuildService.fetchDecks()` swallows for cache continuity. The
   *  payload is then pushed into the shared cache via `fetchDecks(true)`
   *  on success so other consumers stay in sync. */
  async fetchSnapshot(): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.httpClient.get<ShortDeckDTO[]>('/api/decks'));
      // Refresh the shared cache so deck-picker, etc. see the same data.
      this.deckBuildService.fetchDecks(true);
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse
          ? (err.message || 'Failed to load decks')
          : 'Failed to load decks',
      );
    }
  }

  setSearchQuery(q: string): void { this.searchQuery.set(q); }
  setSortMode(m: DeckSortMode): void { this.sortMode.set(m); }
  clearSearch(): void { this.searchQuery.set(''); }

  /** Optimistic delete: dispatch the HTTP DELETE via the shared service so
   *  the cache invalidation runs centrally; rollback is implicit since the
   *  service's success callback calls `fetchDecks(true)` which restores the
   *  authoritative list. Notifications stay here. */
  deleteDeck(deck: ShortDeck): void {
    this.deckBuildService.deleteById(
      deck.id!,
      () => this.notify.success('success.DECK_DELETED'),
      (err) => this.notify.error(err),
    );
  }
}
