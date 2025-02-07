import { Pipe, PipeTransform } from '@angular/core';
import { ShortOwnedCardDTO } from '../model/dto/short-owned-card-dto';

@Pipe({
  name: 'findOwnedCard',
  standalone: true,
})
export class FindOwnedCardPipe implements PipeTransform {
  transform(shortOwnedCards: Array<ShortOwnedCardDTO> | null, setId: number): ShortOwnedCardDTO {
    const newOwned = new ShortOwnedCardDTO(setId, 0);
    if (!shortOwnedCards) {
      return newOwned;
    }
    return shortOwnedCards.find((shortOwnedCard: ShortOwnedCardDTO) => shortOwnedCard.cardSetId === setId) || newOwned;
  }
}
