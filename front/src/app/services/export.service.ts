import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, Observable, take } from 'rxjs';
import { ExportDTO } from '../core/model/dto/export-dto';
import { DeckDTO } from '../core/model/dto/deck-dto';
import { ToastrService } from 'ngx-toastr';
import { parseErrorBlob } from '../core/utilities/functions';

@Injectable({
  providedIn: 'root',
})
export class ExportService {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly toastr: ToastrService
  ) {}

  public exportDeckList(dto: ExportDTO): Observable<HttpResponse<Blob>> {
    return this.httpClient
      .post<Blob>('/api/transfers/export/deck', dto, {
        observe: 'response',
        responseType: 'blob' as 'json',
      })
      .pipe(
        take(1),
        catchError(error => parseErrorBlob(error, this.toastr))
      );
  }

  public importDeckList(file: File): Observable<DeckDTO> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.httpClient.post<DeckDTO>('/api/transfers/import/deck', formData).pipe(take(1));
  }
}
