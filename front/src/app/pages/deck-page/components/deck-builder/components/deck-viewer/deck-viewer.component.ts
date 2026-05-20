import { ChangeDetectionStrategy, Component, computed, output } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { DeckBuildService, DeckZone } from '../../../../../../services/deck-build.service';
import { DeckCardZoneComponent } from '../../../../../../components/deck-card-zone/deck-card-zone.component';
import { IndexedCardDetail } from '../../../../../../core/model/card-detail';
import { DeckZoneSkeletonComponent } from '../../../../../../shared/skel';
import { TranslatePipe } from '@ngx-translate/core';
import { PillComponent } from '../../../../../../components/pill/pill.component';

@Component({
  selector: 'deck-viewer',
  imports: [DragDropModule, DeckCardZoneComponent, DeckZoneSkeletonComponent, TranslatePipe, PillComponent],
  templateUrl: './deck-viewer.component.html',
  styleUrl: './deck-viewer.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckViewerComponent {
  public deckZone = DeckZone;

  readonly cardClicked = output<IndexedCardDetail>();

  public constructor(public deckBuildService: DeckBuildService) {}

  readonly mainPillVariant = computed<'valid' | 'invalid'>(() => {
    const c = this.deckBuildService.mainCardNumber();
    return c >= 40 && c <= 60 ? 'valid' : 'invalid';
  });

  readonly extraPillVariant = computed<'valid' | 'invalid'>(() => {
    const c = this.deckBuildService.extraCardNumber();
    return c <= 15 ? 'valid' : 'invalid';
  });

  readonly sidePillVariant = computed<'valid' | 'invalid'>(() => {
    const c = this.deckBuildService.sideCardNumber();
    return c <= 15 ? 'valid' : 'invalid';
  });
}
