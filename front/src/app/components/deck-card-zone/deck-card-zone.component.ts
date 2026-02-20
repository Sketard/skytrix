import { CdkDrag, CdkDragDrop, CdkDropList, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, HostListener, input, output } from '@angular/core';
import { CardComponent } from '../card/card.component';
import { NgClass } from '@angular/common';
import { DeckBuildService, DeckZone } from '../../services/deck-build.service';
import { CardDetail, IndexedCardDetail } from '../../core/model/card-detail';
import { toSharedCardData } from '../../core/model/shared-card-data';

enum StaticDeckZone {
  OTHER = 'OTHER',
  LOCK = 'LOCK',
}

@Component({
  selector: 'deck-card-zone',
  imports: [CdkDropList, CdkDrag, NgClass, CardComponent, DragDropModule],
  templateUrl: './deck-card-zone.component.html',
  styleUrl: './deck-card-zone.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardZoneComponent {
  readonly label = input<string>('');
  readonly slotNumber = input<number>(60);
  readonly cardDetails = input<Array<IndexedCardDetail>>(new Array<IndexedCardDetail>());
  readonly deckZone = input<DeckZone>();

  readonly cardClicked = output<CardDetail>();
  readonly isEmpty = computed(() => !!this.deckZone() && this.cardDetails().every(cd => cd.index === -1));

  readonly staticDeckZone = StaticDeckZone;
  readonly toSharedCardData = toSharedCardData;

  @HostListener('contextmenu', ['$event'])
  onRightClick(event: any, zone: DeckZone | undefined, index: number) {
    event.preventDefault();
    event.stopPropagation();
    if (!zone) {
      this.deckBuildService.removeImage(index);
      return;
    }
    this.deckBuildService.removeCard(index, zone);
  }

  public constructor(public deckBuildService: DeckBuildService) {}

  onCardClick(cd: CardDetail): void {
    this.cardClicked.emit(cd);
  }

  drop(event: CdkDragDrop<any>) {
    const fromListContainer = event.previousContainer.data?.source === 'search';
    const sameContainer = event.previousContainer === event.container;
    const deckZone = this.deckZone();
    if (!deckZone) {
      if (fromListContainer) {
        this.deckBuildService.addImage(event.item.data);
      } else if (sameContainer) {
        this.deckBuildService.updateImageIndex(event.currentIndex, event.previousIndex);
      }
    } else {
      if (fromListContainer) {
        this.deckBuildService.addCard(event.item.data, deckZone, event.currentIndex);
      } else if (sameContainer) {
        this.deckBuildService.updateCardIndex(deckZone, event.currentIndex, event.previousIndex);
      }
    }
  }
}
