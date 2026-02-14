import { ChangeDetectionStrategy, Component, effect, input, OnDestroy, output, signal } from '@angular/core';
import { CardComponent } from '../card/card.component';
import { CardDisplayType } from '../../core/enums/card-display-type';
import { CdkDrag, CdkDragStart, CdkDropList } from '@angular/cdk/drag-drop';
import { SearchServiceCore } from '../../services/search-service-core.service';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CardDetail } from '../../core/model/card-detail';
import { toSharedCardData } from '../../core/model/shared-card-data';
import { DeckBuildService, DeckZone } from '../../services/deck-build.service';
import { OwnedCardService } from '../../services/owned-card.service';
import { FindOwnedCardPipe } from '../../core/pipes/find-owned-card.pipe';
import { FindGroupedOwnedCardPipe } from '../../core/pipes/find-grouped-owned-card';
import { AsyncPipe, NgClass } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'card-list',
  imports: [
    CardComponent,
    CdkDropList,
    CdkDrag,
    AsyncPipe,
    NgClass,
    FindOwnedCardPipe,
    FindGroupedOwnedCardPipe,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    FormsModule,
  ],
  templateUrl: './card-list.component.html',
  styleUrl: './card-list.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardListComponent implements OnDestroy {
  readonly displayMode = input<CardDisplayType>(CardDisplayType.INFORMATIVE);
  readonly deckBuildMode = input<boolean>(false);
  readonly searchService = input<SearchServiceCore>();

  readonly cardClicked = output<CardDetail>();

  readonly cardsDetails$ = signal<Observable<Array<CardDetail>> | undefined>(undefined);

  readonly toSharedCardData = toSharedCardData;
  readonly displayType = CardDisplayType;
  private dragging = false;

  constructor(
    private readonly httpClient: HttpClient,
    public readonly ownedCardService: OwnedCardService,
    private readonly deckBuildService: DeckBuildService
  ) {
    effect(() => {
      const service = this.searchService();
      if (service) {
        this.cardsDetails$.set(service.cardsDetails$);
        service.fetch(this.httpClient);
        service.refreshResearch();
      }
    });
  }

  onDragStart(_event: CdkDragStart): void {
    this.dragging = true;
  }

  onCardClick(cd: CardDetail): void {
    if (this.dragging) {
      this.dragging = false;
      return;
    }
    this.cardClicked.emit(cd);
  }

  onDoubleClick(cd: CardDetail): void {
    if (!this.deckBuildMode()) return;
    this.deckBuildService.addCard(cd, cd.card.extraCard ? DeckZone.EXTRA : DeckZone.MAIN);
  }

  updateQuantity(event: FocusEvent, cardSetId: number): void {
    this.ownedCardService.update(cardSetId, parseInt((event.target as HTMLInputElement).value));
  }

  increaseQuantity(number: number, cardSetId: number, currentNumber: number): void {
    const newQuantity = Math.max(0, currentNumber + number);
    this.ownedCardService.update(cardSetId, newQuantity);
  }

  ngOnDestroy(): void {
    this.searchService()!.clearOffset();
  }
}
