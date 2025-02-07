export class ShortOwnedCardDTO {
  cardSetId: number;
  number: number;

  constructor(cardSetId?: number, number?: number) {
    this.cardSetId = cardSetId || 0;
    this.number = number || 0;
  }
}
