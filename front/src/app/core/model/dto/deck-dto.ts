import { IndexedCardDetailDTO } from './card-detail-dto';
import { IndexedCardImageDTO } from './card-image-dto';

export class DeckDTO {
  id: number;
  name: string;
  images: Array<IndexedCardImageDTO>;
  mainDeck: Array<IndexedCardDetailDTO>;
  extraDeck: Array<IndexedCardDetailDTO>;
  sideDeck: Array<IndexedCardDetailDTO>;

  constructor(deckDTO: DeckDTO) {
    this.id = deckDTO.id;
    this.name = deckDTO.name;
    this.images = deckDTO.images;
    this.mainDeck = deckDTO.mainDeck;
    this.extraDeck = deckDTO.extraDeck;
    this.sideDeck = deckDTO.sideDeck;
  }
}
