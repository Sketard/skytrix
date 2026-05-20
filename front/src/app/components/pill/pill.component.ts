import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

export type PillVariant =
  | 'gold' | 'cyan' | 'neutral' | 'warning' | 'danger'
  | 'success' | 'valid' | 'invalid';
export type PillSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * DS status pill — replaces the global `.pill` SCSS class (`_pills.scss`
 * removed; `.badge` kept in `_badge.scss`, only one consumer).
 *
 * NON-INTERACTIVE label/status (no `aria-pressed`, no cursor). For an
 * interactive filter toggle use `.chip` instead.
 *
 * Optional `icon` renders a `<mat-icon class="pill__icon">` before the
 * projected label. `live` adds the integrated pulse-dot.
 *
 * For a data-driven arbitrary colour (not a DS variant — e.g. solver
 * interruption tags), set `color` (+ optional `textColor`); the host
 * applies them inline and the variant tint is bypassed.
 *
 * Host carries the variant/size classes via discrete `[class.x]` bindings.
 */
@Component({
  selector: 'app-pill',
  standalone: true,
  imports: [MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pill.component.html',
  styleUrl: './pill.component.scss',
  host: {
    'class': 'pill',
    '[class.pill--custom]': 'color() != null',
    '[style.background]': 'color() ?? null',
    '[style.color]': 'textColor() ?? null',
    '[class.pill--gold]': "variant() === 'gold'",
    '[class.pill--cyan]': "variant() === 'cyan'",
    '[class.pill--neutral]': "variant() === 'neutral'",
    '[class.pill--warning]': "variant() === 'warning'",
    '[class.pill--danger]': "variant() === 'danger'",
    '[class.pill--success]': "variant() === 'success'",
    '[class.pill--valid]': "variant() === 'valid'",
    '[class.pill--invalid]': "variant() === 'invalid'",
    '[class.pill--xs]': "size() === 'xs'",
    '[class.pill--sm]': "size() === 'sm'",
    '[class.pill--md]': "size() === 'md'",
    '[class.pill--lg]': "size() === 'lg'",
    '[class.pill--live]': 'live()',
    '[class.pill--celebrated]': 'celebrated()',
  },
})
export class PillComponent {
  readonly variant = input<PillVariant>('neutral');
  readonly size = input<PillSize>('sm');

  /** Integrated pulse-dot (`::before`) — live status. */
  readonly live = input(false, { transform: booleanAttribute });
  /** Wider letter-spacing + text-shadow — winner/celebrated pills. */
  readonly celebrated = input(false, { transform: booleanAttribute });

  /** Optional leading `mat-icon` name. */
  readonly icon = input<string>();

  /**
   * Arbitrary background colour for data-driven tags (bypasses the variant
   * tint). Any CSS colour. Pair with `textColor` for legibility.
   */
  readonly color = input<string>();
  /** Text/foreground colour when `color` is set. */
  readonly textColor = input<string>();
}
