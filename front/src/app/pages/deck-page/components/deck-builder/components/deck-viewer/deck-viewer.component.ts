import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CardSize } from '../../../../../../components/card/card.component';
import { CommonModule } from '@angular/common';
import { DeckBuildService, DeckZone } from '../../../../../../services/deck-build.service';
import { DeckCardZoneComponent } from '../../../../../../components/deck-card-zone/deck-card-zone.component';

@Component({
  selector: 'deck-viewer',
  imports: [CommonModule, DragDropModule, DeckCardZoneComponent],
  templateUrl: './deck-viewer.component.html',
  styleUrl: './deck-viewer.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckViewerComponent {
  public size: CardSize = CardSize.DECK;
  public extraSize: CardSize = CardSize.DECK_EXTRA_SIDE;
  public deckZone = DeckZone;

  public constructor(public deckBuildService: DeckBuildService) {}
}
