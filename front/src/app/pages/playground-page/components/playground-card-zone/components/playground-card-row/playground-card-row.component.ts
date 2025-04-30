import {ChangeDetectionStrategy, Component, HostListener, input, OnInit, Signal, signal} from '@angular/core';
import {CardComponent, CardSize} from "../../../../../../components/card/card.component";
import {CdkDrag, CdkDragDrop, CdkDropList, DragDropModule} from "@angular/cdk/drag-drop";
import {CardDetail, IndexedCardDetail} from "../../../../../../core/model/card-detail";
import {CardDisplayType} from "../../../../../../core/enums/card-display-type";
import {CommonModule, NgClass} from "@angular/common";
import {PlaygroundService} from "../../../../../../services/playground.service";
import {PlaygroundZone} from "../../../../../../core/enums/playground-zone.enum";

export type PlaygroundDragData = {
  card: CardDetail,
  source: { zone: PlaygroundZone, index: number }
}

@Component({
  selector: 'playground-card-row',
  imports: [
    NgClass,
    CdkDropList,
    CdkDrag,
    CommonModule,
    CardComponent,
    DragDropModule
  ],
  templateUrl: './playground-card-row.component.html',
  styleUrl: './playground-card-row.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlaygroundCardRowComponent implements OnInit {
  readonly zone = input<PlaygroundZone>(PlaygroundZone.FIRST_ROW);

  public size = signal<CardSize>(CardSize.PLAYGROUND);
  public slotNumber = signal<number>(PlaygroundService.ZONE_SIZE);
  public cardDetails: Signal<Array<IndexedCardDetail>> = signal<Array<IndexedCardDetail>>(new Array<IndexedCardDetail>());
  public displayMode: CardDisplayType = CardDisplayType.MOSAIC;

  constructor(private readonly playgroundService: PlaygroundService) {
  }

  ngOnInit() {
    this.cardDetails = this.playgroundService.cards(this.zone())
  }

  drop(event: CdkDragDrop<{ item: IndexedCardDetail, index: number }>) {
    this.playgroundService.moveCard(event.item.data, this.zone(), event.container.data.index)
  }

  @HostListener('contextmenu', ['$event'])
  onRightClick(event: any, zone: PlaygroundZone | undefined, index: number) {
    event.preventDefault();
    event.stopPropagation();
  }
}
