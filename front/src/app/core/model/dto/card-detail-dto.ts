import { CardDTO } from './card-dto';
import { CardSetDTO } from './card-set-dto';
import { CardImageDTO } from './card-image-dto';

export type CardDetailDTOPage = {
  size: number;
  elements: Array<CardDetailDTO>;
};

export class CardDetailDTO {
  card: CardDTO;
  sets: Array<CardSetDTO>;
  images: Array<CardImageDTO>;
  favorite: boolean;

  constructor(card: CardDTO, sets?: Array<CardSetDTO>, images?: Array<CardImageDTO>, favorite?: boolean) {
    this.card = card;
    this.sets = sets || new Array<CardSetDTO>();
    this.images = images || new Array<CardImageDTO>();
    this.favorite = favorite || false;
  }
}

export class IndexedCardDetailDTO {
  card: CardDetailDTO;
  index: number;

  constructor(indexedCard: IndexedCardDetailDTO) {
    this.card = indexedCard.card;
    this.index = indexedCard.index;
  }
}
