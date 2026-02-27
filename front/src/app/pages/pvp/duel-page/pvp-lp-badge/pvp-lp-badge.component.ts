import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-pvp-lp-badge',
  templateUrl: './pvp-lp-badge.component.html',
  styleUrl: './pvp-lp-badge.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvpLpBadgeComponent {
  readonly lp = input.required<number>();
  readonly side = input.required<'player' | 'opponent'>();

  readonly formattedLp = computed(() => {
    const value = this.lp();
    if (value >= 10000) {
      return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return String(value);
  });
}
