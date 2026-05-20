import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { i18nAttr } from '../i18n';

@Component({
  selector: 'app-deck-zone-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    <div class="deck-zone-skel" aria-hidden="true">
      @for (i of placeholders(); track i) {
        <div class="deck-zone-skel__slot"></div>
      }
    </div>
  `,
})
export class DeckZoneSkeletonComponent {
  /** Number of card slots to fill — pass the zone capacity (e.g. 15 for
   *  extra/side, a sensible sample for main). */
  readonly count = input<number>(15);
  readonly placeholders = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly ariaLabel = i18nAttr('a11y.loadingDeck');
}
