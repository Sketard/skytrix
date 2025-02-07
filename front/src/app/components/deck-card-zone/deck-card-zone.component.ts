import { CdkDrag, CdkDragDrop, CdkDropList, DragDropModule } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, HostListener, input } from '@angular/core';
import { CardComponent, CardSize } from '../card/card.component';
import { CommonModule } from '@angular/common';
import { DeckBuildService, DeckZone } from '../../services/deck-build.service';
import { CardDisplayType } from '../../core/enums/card-display-type';
import { IndexedCardDetail } from '../../core/model/card-detail';

enum StaticDeckZone {
  OTHER = 'OTHER',
  LOCK = 'LOCK',
}

@Component({
  selector: 'deck-card-zone',
  imports: [CdkDropList, CdkDrag, CommonModule, CardComponent, DragDropModule],
  templateUrl: './deck-card-zone.component.html',
  styleUrl: './deck-card-zone.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckCardZoneComponent {
  readonly label = input<string>('');
  readonly size = input<CardSize>(CardSize.DECK);
  readonly slotNumber = input<number>(60);
  readonly cardDetails = input<Array<IndexedCardDetail>>(new Array<IndexedCardDetail>());
  readonly deckZone = input<DeckZone>();

  readonly staticDeckZone = StaticDeckZone;

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

  public displayMode: CardDisplayType = CardDisplayType.MOSAIC;

  public constructor(public deckBuildService: DeckBuildService) {}

  drop(event: CdkDragDrop<any>) {
    const fromListContainer = event.previousContainer.id === 'cardList';
    const containerId = event.previousContainer.id;
    const deckZone = this.deckZone();
    if (!deckZone) {
      if (fromListContainer) {
        this.deckBuildService.addImage(event.item.data);
      } else if (containerId === this.staticDeckZone.OTHER) {
        const index = event.container.data.index;
        const previousIndex = event.previousContainer.data.index;
        this.deckBuildService.updateImageIndex(index, previousIndex);
      }
    } else {
      if (fromListContainer) {
        this.deckBuildService.addCard(event.item.data, deckZone);
      } else if (containerId === deckZone) {
        const index = event.container.data.index;
        const previousIndex = event.previousContainer.data.index;
        this.deckBuildService.updateCardIndex(deckZone, index, previousIndex);
      }
    }
  }
}
