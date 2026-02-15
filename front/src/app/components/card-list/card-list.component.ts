import { ChangeDetectionStrategy, Component, effect, ElementRef, input, OnDestroy, output, signal } from '@angular/core';
import { CardComponent } from '../card/card.component';
import { CardDisplayType } from '../../core/enums/card-display-type';
import { CdkDrag, CdkDragDrop, CdkDragStart, CdkDropList } from '@angular/cdk/drag-drop';
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
import { MatIconModule } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';

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
    MatIconModule,
    MatIconButton,
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

  onDoubleClick(cd: CardDetail, event: MouseEvent): void {
    if (!this.deckBuildMode()) return;
    const zone = cd.card.extraCard ? DeckZone.EXTRA : DeckZone.MAIN;
    this.deckBuildService.addCard(cd, zone, undefined, true);

    const wrapper = event.currentTarget as HTMLElement;
    wrapper.classList.remove('added-flash');
    void wrapper.offsetWidth;
    wrapper.classList.add('added-flash');

    this.flyCardToZone(wrapper, zone);
  }

  private flyCardToZone(wrapper: HTMLElement, zone: DeckZone): void {
    const sourceEl = wrapper.querySelector('app-card') as HTMLElement;
    if (!sourceEl) return;

    const sourceRect = sourceEl.getBoundingClientRect();

    const clone = sourceEl.cloneNode(true) as HTMLElement;
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${sourceRect.left}px`,
      top: `${sourceRect.top}px`,
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`,
      zIndex: '10000',
      pointerEvents: 'none',
    });
    document.body.appendChild(clone);

    // Wait for Angular to render the new card so we can read its position
    requestAnimationFrame(() => {
      const targetCard = document.querySelector(`#${zone} .just-added`) as HTMLElement;
      const fallbackEl = document.getElementById(zone);
      const targetRect = targetCard?.getBoundingClientRect() ?? fallbackEl?.getBoundingClientRect();

      if (!targetRect) {
        clone.remove();
        return;
      }

      clone.style.transition = 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
      void clone.offsetWidth;

      Object.assign(clone.style, {
        left: `${targetRect.left}px`,
        top: `${targetRect.top}px`,
        width: `${targetRect.width}px`,
        height: `${targetRect.height}px`,
        opacity: '0',
      });

      clone.addEventListener('transitionend', () => clone.remove(), { once: true });
      setTimeout(() => clone.remove(), 500);
    });
  }

  onDrop(event: CdkDragDrop<any>): void {
    if (event.previousContainer === event.container) return;
    const zone = Object.values(DeckZone).find(z => z === event.previousContainer.id);
    if (zone) {
      this.deckBuildService.removeCard(event.previousIndex, zone);
    } else if (event.previousContainer.id === 'OTHER') {
      this.deckBuildService.removeImage(event.previousIndex);
    }
  }

  increaseQuantity(number: number, cardSetId: number, currentNumber: number): void {
    const newQuantity = Math.max(0, currentNumber + number);
    this.ownedCardService.update(cardSetId, newQuantity);
  }

  ngOnDestroy(): void {
    this.searchService()?.clearOffset();
  }
}
