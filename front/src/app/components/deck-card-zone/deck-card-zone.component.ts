import { CdkDrag, CdkDragDrop, CdkDropList, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CardComponent } from '../card/card.component';
import { NgClass } from '@angular/common';
import { DeckBuildService, DeckZone } from '../../services/deck-build.service';
import { IndexedCardDetail } from '../../core/model/card-detail';
import { toSharedCardData } from '../../core/model/shared-card-data';
import { LongPressDragDirective } from '../../core/directives/long-press-drag.directive';
import { TranslatePipe } from '@ngx-translate/core';

enum StaticDeckZone {
  OTHER = 'OTHER',
  LOCK = 'LOCK',
}

@Component({
  selector: 'deck-card-zone',
  imports: [CdkDropList, CdkDrag, NgClass, CardComponent, DragDropModule, LongPressDragDirective, TranslatePipe],
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

  readonly cardClicked = output<IndexedCardDetail>();
  readonly isEmpty = computed(() => !!this.deckZone() && this.cardDetails().every(cd => cd.index === -1));

  readonly staticDeckZone = StaticDeckZone;
  readonly toSharedCardData = toSharedCardData;

  onRightClick(event: MouseEvent, zone: DeckZone | undefined, index: number) {
    event.preventDefault();
    event.stopPropagation();
    if (!zone) {
      this.deckBuildService.removeImage(index);
      return;
    }
    this.deckBuildService.removeCard(index, zone);
  }

  public constructor(public deckBuildService: DeckBuildService) {}

  onCardClick(icd: IndexedCardDetail): void {
    this.cardClicked.emit(icd);
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
