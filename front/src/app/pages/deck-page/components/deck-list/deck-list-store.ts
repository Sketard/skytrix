import { DestroyRef, Injectable, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { OwnedCardService } from '../../../../services/owned-card.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ShortDeck } from '../../../../core/model/short-deck';
import { ShortDeckDTO } from '../../../../core/model/dto/short-deck-dto';
import { StatItem } from '../../../../components/stats-strip/stats-strip.component';
import { formattedWithoutCaseAndAccent } from '../../../../core/utilities/functions';
import { ListStore } from '../../../../core/store/list-store';

export type DeckSortMode = 'recent' | 'name' | 'legality';
export const DECK_SORT_MODES: ReadonlyArray<DeckSortMode> = ['recent', 'name', 'legality'];

/**
 * Owns the Deck List page state machine. Extends `ListStore<ShortDeck>` for
 * the cross-cutting items/loading/error/search/sort plumbing; adds the
 * deck-specific stats + HTTP error surfacing on top.
 *
 * Provided at component scope (`@Component({ providers: [DeckListStore] })`).
 *
 * Public API (in addition to ListStore base):
 *   - `stats()` — `StatItem[]` ready for `<app-stats-strip>`.
 *   - `start()` — wires the subscription + initial fetch. Called from ngOnInit.
 *   - `fetchSnapshot()` — re-fetch via own HTTP to surface errors that
 *     `DeckBuildService.fetchDecks()` swallows for cache continuity.
 *   - `deleteDeck(deck)` — delegates to the shared service with notification.
 */
@Injectable()
export class DeckListStore extends ListStore<ShortDeck, DeckSortMode> {
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly ownedCardService = inject(OwnedCardService);
  private readonly notify = inject(NotificationService);
  private readonly httpClient = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly sortModes = DECK_SORT_MODES;

  /** Convenience alias for `items()` — clearer at call sites that expect a
   *  domain noun. */
  readonly decks = this.items;
  /** Convenience alias for `filteredItems()` — same. */
  readonly filteredDecks = this.filteredItems;

  readonly stats = computed<StatItem[]>(() => {
    const all = this.items();
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

  constructor() {
    super('recent', 'all');
    // Mirror the canonical loading flag from the shared service via effect.
    effect(() => this.loading.set(this.deckBuildService.isFirstDeckLoad()));
  }

  start(): void {
    // Mirror the shared cache into `items` so ListStore's filteredItems
    // tracks the live deck list. First emit also clears any prior error.
    this.deckBuildService.decks$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(decks => {
        this.items.set(decks ?? []);
        if (this.error() !== null) this.error.set(null);
      });
    this.fetchSnapshot();
  }

  /** Re-fetches the deck list directly via HTTP to surface errors that
   *  `DeckBuildService.fetchDecks()` swallows for cache continuity. On
   *  success the shared cache is refreshed via `fetchDecks(true)` so other
   *  consumers (deck-picker, etc.) stay in sync. */
  async fetchSnapshot(): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.httpClient.get<ShortDeckDTO[]>('/api/decks'));
      this.deckBuildService.fetchDecks(true);
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse
          ? (err.message || 'Failed to load decks')
          : 'Failed to load decks',
      );
    }
  }

  /** Optimistic delete: dispatch via the shared service so cache invalidation
   *  runs centrally. Rollback is implicit (service's success callback calls
   *  fetchDecks(true) which restores the authoritative list). */
  deleteDeck(deck: ShortDeck): void {
    this.deckBuildService.deleteById(
      deck.id!,
      () => this.notify.success('success.DECK_DELETED'),
      (err) => this.notify.error(err),
    );
  }

  // ─── ListStore hooks ──────────────────────────────────────────────────────

  protected override normalizeQuery(raw: string): string {
    return formattedWithoutCaseAndAccent(raw.trim());
  }

  protected searchMatches(deck: ShortDeck, query: string): boolean {
    return formattedWithoutCaseAndAccent(deck.name).includes(query);
  }

  protected passesFilter(): boolean {
    // No filter chips on deck-list yet (decision Axel 2026-05-18: skip v1).
    return true;
  }

  protected sortItems(items: ShortDeck[], mode: DeckSortMode): ShortDeck[] {
    switch (mode) {
      case 'recent':
        // updatedAt is ISO-8601, lexicographic compare is chronological.
        // Falls back to id desc on tie (V016 backfill shares NOW()).
        return items.sort((a, b) => {
          const cmp = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
          return cmp !== 0 ? cmp : (b.id ?? 0) - (a.id ?? 0);
        });
      case 'name':
        return items.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        );
      case 'legality':
        return items.sort((a, b) => {
          const cmp = Number(b.valid) - Number(a.valid);
          return cmp !== 0 ? cmp : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
    }
  }
}
