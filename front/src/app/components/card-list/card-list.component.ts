import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, input, OnDestroy, signal } from '@angular/core';
import { DeckBuilderCardComponent, CardSize } from '../card/deck-builder-card.component';
import { CardDisplayType } from '../../core/enums/card-display-type';
import { CdkDropList } from '@angular/cdk/drag-drop';
import { SearchServiceCore } from '../../services/search-service-core.service';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CardDetail } from '../../core/model/card-detail';

@Component({
  selector: 'card-list',
  imports: [CommonModule, DeckBuilderCardComponent, CdkDropList],
  templateUrl: './card-list.component.html',
  styleUrl: './card-list.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardListComponent implements OnDestroy {
  readonly size = input<CardSize>(CardSize.MEDIUM);
  readonly cropped = input<boolean>(false);
  readonly displayMode = input<CardDisplayType>(CardDisplayType.INFORMATIVE);
  readonly deckBuildMode = input<boolean>(false);
  readonly searchService = input<SearchServiceCore>();

  readonly cardsDetails$ = signal<Observable<Array<CardDetail>> | undefined>(undefined);

  constructor(private readonly httpClient: HttpClient) {
    effect(() => {
      const service = this.searchService();
      if (service) {
        this.cardsDetails$.set(service.cardsDetails$);
        service.fetch(this.httpClient);
        service.refreshResearch();
      }
    });
  }

  ngOnDestroy(): void {
    this.searchService()!.clearOffset();
  }
}
