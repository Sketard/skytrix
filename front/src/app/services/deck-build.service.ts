import { HttpClient } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, finalize, map, Observable, Subject, take, takeUntil } from 'rxjs';
import { Deck } from '../core/model/deck';
import { CardDetail } from '../core/model/card-detail';
import { CreateDeckDTO } from '../core/model/dto/create-deck-dto';
import { DeckDTO } from '../core/model/dto/deck-dto';
import { ShortDeckDTO } from '../core/model/dto/short-deck-dto';
import { ShortDeck } from '../core/model/short-deck';
import { SearchServiceCore } from './search-service-core.service';

export enum DeckZone {
  MAIN = 'mainDeck',
  EXTRA = 'extraDeck',
  SIDE = 'sideDeck',
}

// Cache TTL — short enough that another device editing decks shows up within
// half a minute when the lobby is left open, long enough to make the lobby
// → modale → close → modale loop feel instant. Tune here only.
const DECK_LIST_TTL_MS = 30_000;

@Injectable({
  providedIn: 'root',
})
export class DeckBuildService extends SearchServiceCore {
  public deckSubject: BehaviorSubject<Array<ShortDeck>> = new BehaviorSubject(new Array<ShortDeck>());
  public decks$: Observable<Array<ShortDeck>> = this.deckSubject.asObservable();

  // Cache bookkeeping for the deck list. `_cachedAt` is null when the list has
  // never been fetched OR was invalidated; `_isFetching` dedupes concurrent
  // fetchDecks() calls. The subject keeps its last value across invalidation
  // (UX: existing UI keeps showing the previous list until the refetch lands).
  // `_cancelFetch$` lets a `force=true` call abort the in-flight request so a
  // post-mutation refresh is never swallowed by an in-flight stale read.
  private readonly _cachedAt = signal<number | null>(null);
  private readonly _isFetching = signal(false);
  private readonly _cancelFetch$ = new Subject<void>();

  // True until the first decks fetch resolves successfully. Used by the
  // Deck List template to render a skeleton instead of flashing the "no
  // decks" welcome state during the initial round-trip. Stays false
  // after the first fetch even if the cache is invalidated later
  // (post-save/delete) — subsequent refetches show the previous list.
  private readonly _hasLoadedOnce = signal(false);
  readonly isFirstDeckLoad = computed(() => !this._hasLoadedOnce());

  private readonly deckState = signal<Deck>(new Deck());
  readonly deck = this.deckState.asReadonly();
  readonly deckEmpty = computed(() => !this.deck().hasCard);
  readonly isMainValid = computed(() => !this.deck().isMainValid);
  readonly mainCardNumber = computed(() => this.deck().mainCardNumber);
  readonly extraCardNumber = computed(() => this.deck().extraCardNumber);
  readonly sideCardNumber = computed(() => this.deck().sideCardNumber);
  private readonly handTestOpenedState = signal<boolean>(false);
  readonly handTestOpened = this.handTestOpenedState.asReadonly();
  private readonly _isDirty = signal(false);
  readonly isDirty = this._isDirty.asReadonly();
  private readonly _isSaving = signal(false);
  readonly isSaving = this._isSaving.asReadonly();
  private readonly cardDragActiveState = signal(false);
  readonly cardDragActive = this.cardDragActiveState.asReadonly();

  constructor(private readonly httpClient: HttpClient) {
    super();
  }

  markDirty(): void { this._isDirty.set(true); }
  private resetDirty(): void { this._isDirty.set(false); }

  public resetDeck() {
    this.deckState.set(new Deck());
    this.resetDirty();
  }

  public initDeck(deck: Deck) {
    this.deckState.set(deck.sortDeck());
    this.resetDirty();
  }

  public addCard(card: CardDetail, zone: DeckZone, targetIndex?: number, animate = false, selectedImageId?: number) {
    this.deckState.update(deck => deck.addCard(card, zone, targetIndex, animate, selectedImageId));
    this._isDirty.set(true);
  }

  public updateCardImage(zone: DeckZone, slotIndex: number, selectedImageId: number | undefined) {
    this.deckState.update(deck => {
      deck[zone][slotIndex].selectedImageId = selectedImageId;
      return deck.sortDeck();
    });
    this._isDirty.set(true);
  }

  public removeCard(index: number, deckZone: DeckZone) {
    this.deckState.update(deck => deck.removeCard(index, deckZone));
    this._isDirty.set(true);
  }

  public removeFirstCard(card: CardDetail) {
    this.deckState.update(deck => deck.removeFirstCard(card));
    this._isDirty.set(true);
  }

  public updateCardIndex(zone: DeckZone, newIndex: number, previousIndex: number) {
    this.deckState.update(deck => deck.updateCardIndex(zone, newIndex, previousIndex));
    this._isDirty.set(true);
  }

  public sortByType() {
    this.deckState.update(deck => deck.sortByType());
    this._isDirty.set(true);
  }

  public addImage(card: CardDetail) {
    this.deckState.update(deck => deck.addImage(card));
    this._isDirty.set(true);
  }

  public removeImage(index: number) {
    this.deckState.update(deck => deck.removeImage(index));
    this._isDirty.set(true);
  }

  public updateImageIndex(index: number, previousIndex: number) {
    this.deckState.update(deck => deck.updateImageIndex(index, previousIndex));
    this._isDirty.set(true);
  }

  public save(onSuccess?: () => void, onError?: (error: HttpErrorResponse) => void): void {
    this._isSaving.set(true);
    this.httpClient
      .post<DeckDTO>('/api/decks', new CreateDeckDTO(this.deck()))
      .pipe(take(1))
      .subscribe({
        next: (deck: DeckDTO) => {
          this.deckState.set(new Deck(deck));
          this.resetDirty();
          this._isSaving.set(false);
          this.fetchDecks(true);
          onSuccess?.();
        },
        error: (err: HttpErrorResponse) => {
          this._isSaving.set(false);
          onError?.(err);
        },
      });
  }

  // Triggers a network refresh when needed. No-op when the cache is fresh
  // (TTL not expired) unless `force=true`. A `force` call always lands: if a
  // fetch is already in-flight, it is cancelled and replaced — so a save() or
  // delete() that triggers `fetchDecks(true)` is never swallowed by an
  // in-flight stale read. Subscribers consume `decks$`.
  //
  // `onError` is an optional callback for callers that want to surface the
  // failure (e.g., the deck-list page rendering an error empty-state). When
  // omitted, errors stay silent — the cached list stays visible.
  public fetchDecks(force = false, onError?: (err: unknown) => void): void {
    if (!force && (this._isFetching() || this.isCacheFresh())) return;

    if (this._isFetching()) {
      this._cancelFetch$.next();
    }
    this._isFetching.set(true);
    this.httpClient
      .get<Array<ShortDeckDTO>>('/api/decks')
      .pipe(
        take(1),
        takeUntil(this._cancelFetch$),
        finalize(() => this._isFetching.set(false)),
      )
      .subscribe({
        next: (decks: Array<ShortDeck>) => {
          this.deckSubject.next(decks);
          this._cachedAt.set(Date.now());
          this._hasLoadedOnce.set(true);
        },
        // On transient errors, the previous cache value stays visible —
        // callers consuming `decks$` see the last good list. Callers can
        // pass `onError` when they want to surface the failure (deck-list
        // page error empty-state).
        error: (err: unknown) => onError?.(err),
      });
  }

  // Marks the cache as stale without clearing the subject. The next
  // `fetchDecks()` (with or without force) will hit the network. Subscribers
  // keep seeing the last good value in the meantime.
  public invalidateDeckList(): void {
    this._cachedAt.set(null);
  }

  // Hard reset — wipes both the subject and the cache marker. Call on logout
  // so a different user signing in does not briefly see the previous user's
  // decks before the first fetch lands.
  public clearDeckList(): void {
    this.deckSubject.next([]);
    this._cachedAt.set(null);
    this._hasLoadedOnce.set(false);
  }

  private isCacheFresh(): boolean {
    const at = this._cachedAt();
    return at !== null && Date.now() - at < DECK_LIST_TTL_MS;
  }

  public getById(id: number): Observable<Deck> {
    return this.httpClient.get<DeckDTO>('/api/decks/' + id).pipe(
      take(1),
      map((deck: DeckDTO) => new Deck(deck))
    );
  }

  public deleteById(id: number, onSuccess?: () => void, onError?: (error: HttpErrorResponse) => void) {
    this.httpClient
      .delete<DeckDTO>('/api/decks/' + id)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.fetchDecks(true);
          onSuccess?.();
        },
        error: (err: HttpErrorResponse) => onError?.(err),
      });
  }

  public toggleHandTestOpened() {
    this.handTestOpenedState.update(value => !value);
  }

  public setCardDragActive(active: boolean) {
    this.cardDragActiveState.set(active);
  }
}
