import { Deck } from '../deck';

export class CreateDeckDTO {
  id: number | undefined;
  name: string;
  imageIds: Array<CardIndexDTO>;
  mainIds: Array<CardIndexDTO>;
  extraIds: Array<CardIndexDTO>;
  sideIds: Array<CardIndexDTO>;

  constructor(deck: Deck) {
    this.id = deck.id;
    this.name = deck.name;
    this.imageIds = deck.cleanSlotsAndMap(deck.images, true);
    this.mainIds = deck.cleanSlotsAndMap(deck.mainDeck);
    this.extraIds = deck.cleanSlotsAndMap(deck.extraDeck);
    this.sideIds = deck.cleanSlotsAndMap(deck.sideDeck);
  }
}

export class CardIndexDTO {
  id: number;
  index: number;

  constructor(id: number, index: number) {
    this.id = id;
    this.index = index;
  }
}
