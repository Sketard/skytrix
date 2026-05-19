import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class CardSetService {
  private readonly http = inject(HttpClient);

  private allNames$?: Observable<string[]>;

  fetchAllNames(): Observable<string[]> {
    if (!this.allNames$) {
      this.allNames$ = this.http
        .get<string[]>('/api/card-sets/names')
        .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    }
    return this.allNames$;
  }
}
