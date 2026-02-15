import { Card } from './card';
import { CardSet } from './card-set';
import { CardDetailDTO } from './dto/card-detail-dto';
import { CardImageDTO } from './dto/card-image-dto';
import { CardSetDTO } from './dto/card-set-dto';
import { generateRandomId } from '../utilities/functions';

export class CardDetail {
  card: Card;
  sets: Array<CardSet>;
  images: Array<CardImageDTO>;
  favorite: boolean;

  constructor(cardDetail?: CardDetailDTO) {
    this.card = new Card(cardDetail?.card);
    this.sets = cardDetail?.sets.map((set: CardSetDTO) => new CardSet(set)) || new Array<CardSet>();
    this.images = cardDetail?.images || new Array<CardImageDTO>();
    this.favorite = cardDetail?.favorite || false;
  }
}

export class IndexedCardDetail {
  card: CardDetail;
  index: number;
  id = generateRandomId();
  justAdded = false;

  constructor(cardDetail: CardDetail, index: number) {
    this.card = cardDetail;
    this.index = index;
  }
}
