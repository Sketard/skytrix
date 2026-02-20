import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { DeckBuildService, DeckZone } from '../../../../../../services/deck-build.service';
import { DeckCardZoneComponent } from '../../../../../../components/deck-card-zone/deck-card-zone.component';
import { CardDetail } from '../../../../../../core/model/card-detail';

@Component({
  selector: 'deck-viewer',
  imports: [DragDropModule, DeckCardZoneComponent],
  templateUrl: './deck-viewer.component.html',
  styleUrl: './deck-viewer.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckViewerComponent {
  public deckZone = DeckZone;

  readonly cardClicked = output<CardDetail>();

  public constructor(public deckBuildService: DeckBuildService) {}
}
