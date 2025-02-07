import { Injectable, OnDestroy } from '@angular/core';
import { SearchServiceCore } from './search-service-core.service';

@Injectable({
  providedIn: 'root',
})
export class CardSearchService extends SearchServiceCore implements OnDestroy {}
