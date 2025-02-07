import { ShortOwnedCardDTO } from './../core/model/dto/short-owned-card-dto';
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, take } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class OwnedCardService {
  private shortOwnedCardsSubject = new BehaviorSubject<Array<ShortOwnedCardDTO>>(new Array());
  readonly shortOwnedCards$ = this.shortOwnedCardsSubject.asObservable();

  get shortOwnedCards(): Array<ShortOwnedCardDTO> {
    return this.shortOwnedCardsSubject.value;
  }

  set shortOwnedCards(ownedCards: Array<ShortOwnedCardDTO>) {
    this.shortOwnedCardsSubject.next(ownedCards);
  }

  constructor(private readonly httpClient: HttpClient) {
    this.getAllShort().subscribe(
      (shortOwnedCards: Array<ShortOwnedCardDTO>) => (this.shortOwnedCards = shortOwnedCards)
    );
  }

  private getAllShort(): Observable<Array<ShortOwnedCardDTO>> {
    return this.httpClient.get<Array<ShortOwnedCardDTO>>(`/api/possessed/short`).pipe(take(1));
  }

  public findOwnedCardBySetId(setId: number): ShortOwnedCardDTO | undefined {
    return this.shortOwnedCards.find((shortOwnedCards: ShortOwnedCardDTO) => shortOwnedCards.cardSetId === setId);
  }

  public update(setId: number, newQuantity: number): void {
    if (this.findOwnedCardBySetId(setId)) {
      this.shortOwnedCards = this.shortOwnedCards.map((shortOwnedCard: ShortOwnedCardDTO) =>
        shortOwnedCard.cardSetId === setId ? { ...shortOwnedCard, number: newQuantity || 0 } : shortOwnedCard
      );
    } else {
      this.shortOwnedCards = [...this.shortOwnedCards, new ShortOwnedCardDTO(setId, newQuantity)];
    }

    this.httpClient
      .put<Array<ShortOwnedCardDTO>>(`/api/possessed`, { cards: this.shortOwnedCards })
      .pipe(take(1))
      .subscribe((shortOwnedCards: Array<ShortOwnedCardDTO>) => {});
  }
}
