import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class OwnedCardService {
  private readonly _ownedMap = signal<Map<number, number>>(new Map());
  readonly ownedMap = this._ownedMap.asReadonly();

  constructor(private readonly httpClient: HttpClient) {}

  loadAll(): void {
    this.httpClient.get<Record<string, number>>('/api/cards/possessed')
      .pipe(take(1))
      .subscribe(res => {
        this._ownedMap.set(new Map(Object.entries(res).map(([k, v]) => [+k, v])));
      });
  }

  resetMap(): void {
    this._ownedMap.set(new Map());
  }

  updateOwned(cardId: number, newCount: number): void {
    const current = new Map(this._ownedMap());
    if (newCount === 0) {
      current.delete(cardId);
    } else {
      current.set(cardId, newCount);
    }
    this._ownedMap.set(current); // optimistic update
    this.httpClient.put(`/api/cards/possessed/${cardId}`, null, { params: { number: newCount } })
      .pipe(take(1))
      .subscribe();
  }
}
