import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, take, throwError } from 'rxjs';
import { ExportDTO } from '../core/model/dto/export-dto';
import { DeckDTO } from '../core/model/dto/deck-dto';
import { NotificationService } from '../core/services/notification.service';

@Injectable({
  providedIn: 'root',
})
export class ExportService {
  private readonly httpClient = inject(HttpClient);
  private readonly notify = inject(NotificationService);

  public exportDeckList(dto: ExportDTO): Observable<HttpResponse<Blob>> {
    return this.httpClient
      .post<Blob>('/api/transfers/export/deck', dto, {
        observe: 'response',
        responseType: 'blob' as 'json',
      })
      .pipe(
        take(1),
        catchError((error: HttpErrorResponse) => {
          this.notify.error(error);
          return throwError(() => error);
        })
      );
  }

  public importDeckList(file: File): Observable<DeckDTO> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.httpClient.post<DeckDTO>('/api/transfers/import/deck', formData).pipe(take(1));
  }
}
