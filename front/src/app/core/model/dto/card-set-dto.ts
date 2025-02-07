export class CardSetDTO {
  id: number;
  name?: string;
  code?: string;
  rarity?: string;
  rarityCode?: string;
  price?: number;
  cardId?: number;

  constructor(
    id: number,
    name?: string,
    code?: string,
    rarity?: string,
    rarityCode?: string,
    price?: number,
    cardId?: number
  ) {
    this.id = id;
    this.name = name;
    this.code = code;
    this.rarity = rarity;
    this.rarityCode = rarityCode;
    this.price = price;
    this.cardId = cardId;
  }
}
