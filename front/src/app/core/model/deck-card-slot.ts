import { CardDetail } from './card-detail';

export class DeckCardSlot {
  cardDetail: CardDetail | undefined;
  constructor(cardDetail?: CardDetail) {
    this.cardDetail = cardDetail || new CardDetail();
  }
}
