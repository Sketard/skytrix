import {Injectable, Signal, signal} from '@angular/core';
import {Deck} from '../core/model/deck';
import {CardDetail, IndexedCardDetail} from "../core/model/card-detail";
import {PlaygroundZone} from "../core/enums/playground-zone.enum";
import {PlaygroundDragData} from "../pages/playground-page/components/playground-card-zone/components/playground-card-row/playground-card-row.component";

@Injectable({
  providedIn: 'root',
})
export class PlaygroundService {
  public static readonly ZONE_SIZE = 7;
  private readonly deckState = signal<Deck>(new Deck());
  readonly deck = this.deckState.asReadonly();
  private readonly firstRowState = signal<Array<IndexedCardDetail>>(this.createFixedSizeArray(PlaygroundService.ZONE_SIZE));
  private readonly firstRow = this.firstRowState.asReadonly();
  private readonly secondRowState = signal<Array<IndexedCardDetail>>(this.createFixedSizeArray(PlaygroundService.ZONE_SIZE));
  private readonly secondRow = this.secondRowState.asReadonly();

  constructor() {
  }

  public setDeck(deck: Deck) {
    this.deckState.set(deck);
  }

  public cards(zone: PlaygroundZone): Signal<Array<IndexedCardDetail>> {
    switch (zone) {
      case PlaygroundZone.FIRST_ROW:
        return this.firstRow
      case PlaygroundZone.SECOND_ROW:
        return this.secondRow
      default:
        throw new Error("This playground zone does not exists")
    }
  }

  public moveCard(data: PlaygroundDragData, zone: PlaygroundZone, index: number) {
    this.updateCard(data.card, zone, index);
    const source = data.source;
    if (source) {
      this.updateCard(new CardDetail(), source.zone, source.index);
    }
  }

  private updateCard(card: CardDetail, zone: PlaygroundZone, index: number): void {
    switch (zone) {
      case PlaygroundZone.FIRST_ROW:
        this.firstRowState.update(row => this.replaceCard(row, card, index));
        break;
      case PlaygroundZone.SECOND_ROW:
        this.secondRowState.update(row => this.replaceCard(row, card, index));
        break;
      case PlaygroundZone.MAIN_DECK:
        break;
      default:
        console.error('This playground zone does not exists')
    }
  }

  private createFixedSizeArray(size: number): Array<IndexedCardDetail> {
    return Array(size).fill(new IndexedCardDetail(new CardDetail(), -1));
  }

  private replaceCard(cards: Array<IndexedCardDetail>, card: CardDetail, index: number) {
    return cards.map((value: IndexedCardDetail, currentIndex: number) => {
        if (index === currentIndex) {
          return {...value, card};
        }
        return value;
      }
    )
  }
}
