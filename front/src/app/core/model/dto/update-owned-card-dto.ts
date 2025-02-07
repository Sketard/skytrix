import { ShortOwnedCardDTO } from './short-owned-card-dto';

export class UpdateOwnedCardDTO {
  cards: Array<ShortOwnedCardDTO>;
  constructor(updateOwnedCardDTO?: UpdateOwnedCardDTO) {
    this.cards = updateOwnedCardDTO?.cards || new Array<ShortOwnedCardDTO>();
  }
}
