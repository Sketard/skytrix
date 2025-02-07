import { Card } from './card';
import { CardImageDTO } from './dto/card-image-dto';
import { CardSetDTO } from './dto/card-set-dto';
import { OwnedCardDTO } from './dto/owned-card-dto';

export class OwnedCard {
  cardImage?: CardImageDTO;
  card: Card;
  cardSet?: CardSetDTO;
  number?: number;

  constructor(ownedCardDTO?: OwnedCardDTO) {
    this.card = new Card(ownedCardDTO?.card);
    this.cardSet = ownedCardDTO?.cardSet || new CardSetDTO();
    this.cardImage = ownedCardDTO?.cardImage || new CardImageDTO();
    this.number = ownedCardDTO?.number || 0;
  }
}
