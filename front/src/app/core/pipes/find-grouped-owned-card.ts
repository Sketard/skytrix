import { CardDetail } from './../model/card-detail';
import { Pipe, PipeTransform } from '@angular/core';
import { ShortOwnedCardDTO } from '../model/dto/short-owned-card-dto';
import { CardSet } from '../model/card-set';

@Pipe({
  name: 'findGroupedOwnedCard',
  standalone: true,
})
export class FindGroupedOwnedCardPipe implements PipeTransform {
  transform(shortOwnedCards: Array<ShortOwnedCardDTO> | null, cardDetail: CardDetail): number {
    const ids = cardDetail.sets.map((set: CardSet) => set.id);
    return (
      shortOwnedCards?.reduce((acc: number, value: ShortOwnedCardDTO) => {
        if (ids.includes(value.cardSetId)) {
          return acc + value.number;
        }
        return acc;
      }, 0) || 0
    );
  }
}
