import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { i18nAttr } from '../i18n';

@Component({
  selector: 'app-card-grid-skeleton',
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
      <div class="card-grid-skel" aria-hidden="true"></div>
    }
  `,
  // display: contents — the placeholder tiles flow directly into the parent
  // card grid (`.cardsContainer.GRID`); no extra wrapper layer is introduced.
  styles: [`:host { display: contents; }`],
})
export class CardGridSkeletonComponent {
  readonly count = input<number>(18);
  readonly placeholders = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly ariaLabel = i18nAttr('a11y.loadingCards');
}
