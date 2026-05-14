import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { i18nAttr } from '../i18n';

/**
 * Skeleton placeholder for the Replay Hub list. Mirrors the DOM structure of
 * `.replay-card` (avatar + 2-line info + result pill + meta column + actions)
 * so the page reserves the same vertical space and the swap to the real list
 * doesn't shift the layout. Each `count` placeholder card occupies one
 * REPLAY_CARD_ITEM_SIZE_PX slot (104px), matching the virtual-scroll itemSize.
 *
 * The shimmer animation is provided by `%skel-block` in shared/skel/skel.scss.
 * Reduced motion is honored globally via `_a11y.scss` (DS Wave 1).
 */
@Component({
  selector: 'app-replay-card-skeleton',
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
      <div class="replay-card-skel" aria-hidden="true">
        <div class="skel-avatar"></div>
        <div class="skel-lines">
          <div class="skel skel--text-md skel--w-60"></div>
          <div class="skel skel--text-sm skel--w-80"></div>
        </div>
        <div class="skel skel--pill skel-pill"></div>
        <div class="skel-meta">
          <div class="skel skel--text-sm skel--w-60"></div>
          <div class="skel skel--text-sm skel--w-40"></div>
        </div>
        <div class="skel-action"></div>
      </div>
    }
  `,
  styles: [`:host { display: flex; flex-direction: column; gap: 12px; }`],
})
export class ReplayCardSkeletonComponent {
  readonly count = input<number>(4);
  readonly placeholders = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly ariaLabel = i18nAttr('a11y.loadingReplays');
}
