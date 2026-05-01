import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CardSetFilterDTO } from '../core/model/dto/card-filter-dto';

export type CardSetShortDTO = { name: string; code: string };

@Injectable({ providedIn: 'root' })
export class CardSetService {
  private readonly http = inject(HttpClient);

  searchShort(filter: CardSetFilterDTO): Observable<CardSetShortDTO[]> {
    return this.http.post<CardSetShortDTO[]>('/api/card-sets/search/short', filter);
  }
}
