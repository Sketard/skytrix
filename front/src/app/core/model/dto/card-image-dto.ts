export class CardImageDTO {
  id: number;
  imageId: number;
  url: string;
  smallUrl: string;
  cardId: number;

  constructor(cardImageDTO?: CardImageDTO) {
    this.id = cardImageDTO?.id ?? 0;
    this.imageId = cardImageDTO?.imageId ?? 0;
    this.url = cardImageDTO?.url ?? '';
    this.smallUrl = cardImageDTO?.smallUrl ?? '';
    this.cardId = cardImageDTO?.cardId ?? 0;
  }
}

export class IndexedCardImageDTO {
  id: number;
  index: number;
  image: CardImageDTO;

  constructor(IndexedCardImageDTO: IndexedCardImageDTO) {
    this.id = IndexedCardImageDTO.id;
    this.index = IndexedCardImageDTO.index;
    this.image = IndexedCardImageDTO.image;
  }
}
