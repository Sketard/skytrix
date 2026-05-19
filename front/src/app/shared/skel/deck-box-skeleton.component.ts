import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { i18nAttr } from '../i18n';

@Component({
  selector: 'app-deck-box-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    @for (i of placeholders(); track i) {
      <div class="deck-box-skel" aria-hidden="true">
        <div class="deck-box-skel__rail"></div>
        <div class="deck-box-skel__cover">
          <div class="deck-box-skel__silhouette"></div>
        </div>
        <div class="deck-box-skel__name"></div>
        <div class="deck-box-skel__meta">
          <div class="deck-box-skel__pill"></div>
          <div class="deck-box-skel__pill"></div>
        </div>
      </div>
    }
  `,
  styles: [`:host { display: contents; }`],
})
export class DeckBoxSkeletonComponent {
  readonly count = input<number>(6);
  readonly placeholders = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly ariaLabel = i18nAttr('a11y.loadingDecks');
}
