import { HttpClient } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
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

  constructor(private readonly httpClient: HttpClient) {
    super();
  }

  public resetDeck() {
    this.deckState.set(new Deck());
  }

  public initDeck(deck: Deck) {
    this.deckState.set(deck.sortDeck());
  }

  public addCard(card: CardDetail, zone: DeckZone, targetIndex?: number, animate = false) {
    this.deckState.update(deck => deck.addCard(card, zone, targetIndex, animate));
  }

  public removeCard(index: number, deckZone: DeckZone) {
    this.deckState.update(deck => deck.removeCard(index, deckZone));
  }

  public removeFirstCard(card: CardDetail) {
    this.deckState.update(deck => deck.removeFirstCard(card));
  }

  public updateCardIndex(zone: DeckZone, newIndex: number, previousIndex: number) {
    this.deckState.update(deck => deck.updateCardIndex(zone, newIndex, previousIndex));
  }

  public addImage(card: CardDetail) {
    this.deckState.update(deck => deck.addImage(card));
  }

  public removeImage(index: number) {
    this.deckState.update(deck => deck.removeImage(index));
  }

  public updateImageIndex(index: number, previousIndex: number) {
    this.deckState.update(deck => deck.updateImageIndex(index, previousIndex));
  }

  public save() {
    this.httpClient
      .post<DeckDTO>('/api/decks', new CreateDeckDTO(this.deck()))
      .pipe(take(1))
      .subscribe((deck: DeckDTO) => {
        this.deckState.set(new Deck(deck));
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

  public deleteById(id: number) {
    this.httpClient
      .delete<DeckDTO>('/api/decks/' + id)
      .pipe(take(1))
      .subscribe(() => this.fetchDecks());
  }

  public toggleHandTestOpened() {
    this.handTestOpenedState.update(value => !value);
  }
}
