// === Import : NPM
import { Injectable, signal } from '@angular/core';
import { HttpRequest } from '@angular/common/http';

@Injectable({
  providedIn: 'root',
})
export class LoaderService {
  public isLoading = signal<boolean>(false);
  public readonly requests: HttpRequest<unknown>[] = [];
}
