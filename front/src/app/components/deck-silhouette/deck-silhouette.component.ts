import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DeckTheme, pickDeckTheme } from '../../core/utilities/deck-theme';

@Component({
  selector: 'app-deck-silhouette',
  templateUrl: './deck-silhouette.component.html',
  styleUrl: './deck-silhouette.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckSilhouetteComponent {
  readonly deckId = input<number | undefined | null>(null);
  /** Override the auto-derived theme (useful for placeholders / `[add]` tile). */
  readonly theme = input<DeckTheme | null>(null);

  readonly resolvedTheme = computed<DeckTheme>(
    () => this.theme() ?? pickDeckTheme(this.deckId()),
  );
}
