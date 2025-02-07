import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, take } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ParameterService {
  constructor(private readonly httpClient: HttpClient) {}

  public fetchDatabaseCards(): Observable<void> {
    return this.httpClient.put<void>('/api/parameters/update/cards', {}).pipe(take(1));
  }

  public fetchDatabaseImages(): Observable<void> {
    return this.httpClient.put<void>('/api/parameters/update/images', {}).pipe(take(1));
  }

  public fetchDatabaseTcgImages(): Observable<void> {
    return this.httpClient.put<void>('/api/parameters/update/images/tcg', {}).pipe(take(1));
  }

  public fetchDatabaseBanlist(): Observable<void> {
    return this.httpClient.put<void>('/api/parameters/update/ban-list', {}).pipe(take(1));
  }
}
