import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-deck-card-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    'aria-label': 'Chargement des decks',
  },
  template: `
    @for (i of placeholders(); track i) {
      <div class="deck-card-skel" aria-hidden="true">
        <div class="skel-thumb"></div>
        <div class="skel-name"></div>
        <div class="skel-meta"></div>
      </div>
    }
  `,
  // display: contents — the placeholders flow directly into the parent grid
  // (deck picker uses a CSS grid; we don't introduce an extra wrapper layer).
  styles: [`:host { display: contents; }`],
})
export class DeckCardSkeletonComponent {
  readonly count = input<number>(6);
  readonly placeholders = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
