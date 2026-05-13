import { ChangeDetectionStrategy, Component } from '@angular/core';
import { i18nAttr } from '../i18n';

@Component({
  selector: 'app-dice-arena-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'aria-live': 'polite',
    'aria-busy': 'true',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    <div class="dice-arena-skel" aria-hidden="true">
      <div class="skel-die"></div>
      <div class="skel-die"></div>
    </div>
  `,
  styles: [`:host { display: block; width: 100%; }`],
})
export class DiceArenaSkeletonComponent {
  protected readonly ariaLabel = i18nAttr('a11y.loadingDiceArena');
}
