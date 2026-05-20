import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ShortDeck } from '../../core/model/short-deck';
import { DeckSilhouetteComponent } from '../deck-silhouette/deck-silhouette.component';
import { PillComponent } from '../pill/pill.component';

@Component({
  selector: 'deck-box',
  imports: [MatIconModule, RouterLink, TranslatePipe, DeckSilhouetteComponent, PillComponent],
  templateUrl: './deck-box.component.html',
  styleUrl: './deck-box.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckBoxComponent {
  readonly deck = input<ShortDeck>();
  readonly add = input<boolean>(false);

  // Tripartite legality: count-incomplete (red) takes priority over a
  // ban-list breach (orange); only a count-valid AND ban-list-legal deck
  // shows the green "legal" pill.
  readonly statusPill = computed<{ key: string; variant: 'valid' | 'invalid' | 'warning' } | null>(() => {
    const d = this.deck();
    if (!d) return null;
    if (!d.valid) {
      return { key: 'deckBox.incomplete', variant: 'invalid' };
    }
    if (!d.banlistLegal) {
      return { key: 'deckBox.banlistIllegal', variant: 'warning' };
    }
    return { key: 'deckBox.legal', variant: 'valid' };
  });
}
