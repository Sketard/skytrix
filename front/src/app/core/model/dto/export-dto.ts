import { ExportMode } from '../../enums/export.mode.enum';
import { Deck } from '../deck';

export class ExportDTO {
  name: string;
  mainIds: Array<number>;
  extraIds: Array<number>;
  sideIds: Array<number>;
  transferType: ExportMode;

  constructor(deck: Deck, type: ExportMode) {
    this.name = deck.name;
    this.mainIds = deck.cleanSlotsAndMapIds(deck.mainDeck);
    this.extraIds = deck.cleanSlotsAndMapIds(deck.extraDeck);
    this.sideIds = deck.cleanSlotsAndMapIds(deck.sideDeck);
    this.transferType = type;
  }
}
