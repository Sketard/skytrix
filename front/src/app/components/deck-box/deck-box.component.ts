import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ShortDeck } from '../../core/model/short-deck';
import { DeckSilhouetteComponent } from '../deck-silhouette/deck-silhouette.component';

@Component({
  selector: 'deck-box',
  imports: [MatIconModule, RouterLink, TranslatePipe, DeckSilhouetteComponent],
  templateUrl: './deck-box.component.html',
  styleUrl: './deck-box.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckBoxComponent {
  readonly deck = input<ShortDeck>();
  readonly add = input<boolean>(false);

  readonly statusPill = computed<{ key: string; variant: 'valid' | 'invalid' } | null>(() => {
    const d = this.deck();
    if (!d) return null;
    return d.valid
      ? { key: 'deckBox.legal', variant: 'valid' }
      : { key: 'deckBox.incomplete', variant: 'invalid' };
  });
}
