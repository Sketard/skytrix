import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CustomPageable } from '../core/model/custom-pageable';
import { ReplayDTO } from '../core/model/dto/replay-dto';
import { ReplayStatsDTO } from '../core/model/dto/replay-stats-dto';

@Injectable({
  providedIn: 'root',
})
export class ReplayService {
  private readonly httpClient = inject(HttpClient);

  getMatchHistory(offset: number, quantity: number): Observable<CustomPageable<ReplayDTO>> {
    const params = new HttpParams().set('offset', offset).set('quantity', quantity);
    return this.httpClient.get<CustomPageable<ReplayDTO>>('/api/replays', { params });
  }

  getStats(): Observable<ReplayStatsDTO> {
    return this.httpClient.get<ReplayStatsDTO>('/api/replays/stats');
  }

  deleteReplay(id: string): Observable<void> {
    return this.httpClient.delete<void>(`/api/replays/${id}`);
  }
}
