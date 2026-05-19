import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

export type IconWrapPalette = 'gold' | 'cyan';

/**
 * Decorative icon square — 44×44 with palette-tinted background, border,
 * and glow on the icon. Used in page headers next to the title group.
 *
 * Replaces the per-page `.{page}__icon-wrap` BEM blocks. Pattern referenced
 * by mockup `_mockups/mockup-deck-flow.html:727-735`.
 */
@Component({
  selector: 'app-icon-wrap',
  standalone: true,
  imports: [MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon-wrap.component.html',
  styleUrl: './icon-wrap.component.scss',
  host: {
    'aria-hidden': 'true',
    '[class.icon-wrap--gold]': "palette() === 'gold'",
    '[class.icon-wrap--cyan]': "palette() === 'cyan'",
  },
})
export class IconWrapComponent {
  readonly icon = input.required<string>();
  readonly palette = input<IconWrapPalette>('gold');
}
