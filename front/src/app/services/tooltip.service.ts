import { Injectable, signal } from '@angular/core';
import { CardDetail } from '../core/model/card-detail';
import { SearchServiceCore } from './search-service-core.service';

@Injectable({
  providedIn: 'root',
})
export class TooltipService {
  private readonly cardDetailState = signal<CardDetail | undefined>(undefined);
  public readonly cardDetail = this.cardDetailState.asReadonly();
  private readonly activeSearchServiceState = signal<SearchServiceCore | undefined>(undefined);
  public readonly activeSearchService = this.activeSearchServiceState.asReadonly();

  public setCardDetail(cardDetail: CardDetail | undefined) {
    this.cardDetailState.set(cardDetail);
  }

  public setActiveSearchService(searchServiceCore: SearchServiceCore) {
    this.activeSearchServiceState.set(searchServiceCore);
  }
}
