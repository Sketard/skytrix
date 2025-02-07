import { CardSetDTO } from './dto/card-set-dto';

export class CardSet {
  id: number;
  name?: string;
  code?: string;
  rarity?: string;
  rarityCode?: string;
  price?: number;
  cardId?: number;
  cssRarityCode: string;

  constructor(cardSetDTO: CardSetDTO) {
    this.id = cardSetDTO.id;
    this.name = cardSetDTO.name;
    this.code = cardSetDTO.code;
    this.rarity = cardSetDTO.rarity;
    this.rarityCode = cardSetDTO.rarityCode;
    this.price = cardSetDTO.price;
    this.cardId = cardSetDTO.cardId;
    this.cssRarityCode = cardSetDTO.rarityCode?.replace('(', '').replace(')', '') || '';
  }
}
