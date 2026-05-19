import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { i18nAttr } from '../i18n';

@Component({
  selector: 'app-deck-stats-strip-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    <div class="deck-stats-strip-skel" aria-hidden="true">
      @for (i of placeholders(); track i) {
        <div class="deck-stats-strip-skel__item">
          <div class="deck-stats-strip-skel__value"></div>
          <div class="deck-stats-strip-skel__label"></div>
        </div>
      }
    </div>
  `,
  styles: [`:host { display: block; width: 100%; }`],
})
export class DeckStatsStripSkeletonComponent {
  readonly count = input<number>(3);
  readonly placeholders = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly ariaLabel = i18nAttr('a11y.loadingDecks');
}
