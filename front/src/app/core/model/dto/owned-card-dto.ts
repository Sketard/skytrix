import { CardDTO } from './card-dto';
import { CardImageDTO } from './card-image-dto';
import { CardSetDTO } from './card-set-dto';

export class OwnedCardDTO {
  cardImage?: CardImageDTO;
  card: CardDTO;
  cardSet?: CardSetDTO;
  number?: number;

  constructor(ownedCardDTO?: OwnedCardDTO) {
    this.cardImage = ownedCardDTO?.cardImage || new CardImageDTO();
    this.card = ownedCardDTO?.card || new CardDTO();
    this.cardSet = ownedCardDTO?.cardSet || new CardSetDTO();
    this.number = ownedCardDTO?.number || 0;
  }
}
