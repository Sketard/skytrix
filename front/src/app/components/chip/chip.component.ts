import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

export type ChipVariant = 'gold' | 'cyan' | 'neutral';
export type ChipSize = 'sm' | 'md';

/**
 * DS filter chip — replaces the global `.chip` SCSS class (`_chips.scss`,
 * removed).
 *
 * INTERACTIVE by contract: it is a real `<button>` toggle, renders
 * `aria-pressed` from `active`. For a non-interactive status label use
 * `<app-pill>` instead.
 *
 * `variant` only tints the ACTIVE state (gold default / cyan / neutral);
 * the rest state is identical across variants. Optional `icon` renders a
 * leading `<mat-icon class="chip__icon">`.
 */
@Component({
  selector: 'app-chip',
  standalone: true,
  imports: [MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chip.component.html',
  styleUrl: './chip.component.scss',
  host: {
    'class': 'chip',
    '[class.chip--active]': 'active()',
    '[class.chip--cyan]': "variant() === 'cyan'",
    '[class.chip--neutral]': "variant() === 'neutral'",
    '[class.chip--sm]': "size() === 'sm'",
  },
})
export class ChipComponent {
  /** Tints the active state — gold default. */
  readonly variant = input<ChipVariant>('gold');
  readonly size = input<ChipSize>('md');

  readonly active = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly type = input<'button' | 'submit'>('button');

  /** Optional — only needed when the projected text is not a sufficient name. */
  readonly ariaLabel = input<string>();

  /** Optional leading `mat-icon` name. */
  readonly icon = input<string>();
}
