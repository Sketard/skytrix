import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { DeckBuildService, DeckZone } from '../../../../../../services/deck-build.service';
import { DeckCardZoneComponent } from '../../../../../../components/deck-card-zone/deck-card-zone.component';
import { IndexedCardDetail } from '../../../../../../core/model/card-detail';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'deck-viewer',
  imports: [DragDropModule, DeckCardZoneComponent, TranslatePipe],
  templateUrl: './deck-viewer.component.html',
  styleUrl: './deck-viewer.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckViewerComponent {
  public deckZone = DeckZone;

  readonly cardClicked = output<IndexedCardDetail>();

  public constructor(public deckBuildService: DeckBuildService) {}
}
