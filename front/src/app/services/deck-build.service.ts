import { HttpClient } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, map, Observable, take } from 'rxjs';
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

@Injectable({
  providedIn: 'root',
})
export class DeckBuildService extends SearchServiceCore {
  public deckSubject: BehaviorSubject<Array<ShortDeck>> = new BehaviorSubject(new Array<ShortDeck>());
  public decks$: Observable<Array<ShortDeck>> = this.deckSubject.asObservable();
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

  public addCard(card: CardDetail, zone: DeckZone, targetIndex?: number, animate = false) {
    this.deckState.update(deck => deck.addCard(card, zone, targetIndex, animate));
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
          onSuccess?.();
        },
        error: (err: HttpErrorResponse) => {
          this._isSaving.set(false);
          onError?.(err);
        },
      });
  }

  public getAllDecks(): Observable<Array<ShortDeck>> {
    return this.httpClient.get<Array<ShortDeckDTO>>('/api/decks').pipe(take(1));
  }

  public fetchDecks(): void {
    this.getAllDecks().subscribe((decks: Array<ShortDeck>) => this.deckSubject.next(decks));
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
          this.fetchDecks();
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
