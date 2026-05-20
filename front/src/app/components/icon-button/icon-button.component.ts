import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconButtonSize = 'sm' | 'md' | 'lg' | 'xl';
export type IconButtonVariant = 'ghost' | 'framed' | 'primary' | 'danger';

/**
 * DS icon-only button — replaces the global `.icon-btn` SCSS class
 * (`_icon-button.scss`, removed). Projects a single `<mat-icon>` via
 * `<ng-content>`.
 *
 * `ariaLabel` is `input.required` — an icon-only button MUST have an
 * accessible name, so the compiler now enforces what used to be a PR-review
 * checklist item.
 *
 * Host carries the variant/size classes via discrete `[class.x]` bindings
 * (a single `[class]` binding would wipe layout classes from the parent).
 */
@Component({
  selector: 'app-icon-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon-button.component.html',
  styleUrl: './icon-button.component.scss',
  host: {
    'class': 'icon-btn',
    '[class.icon-btn--sm]': "size() === 'sm'",
    '[class.icon-btn--md]': "size() === 'md'",
    '[class.icon-btn--lg]': "size() === 'lg'",
    '[class.icon-btn--xl]': "size() === 'xl'",
    '[class.icon-btn--ghost]': "variant() === 'ghost'",
    '[class.icon-btn--framed]': "variant() === 'framed'",
    '[class.icon-btn--primary]': "variant() === 'primary'",
    '[class.icon-btn--danger]': "variant() === 'danger'",
    '[class.icon-btn--active]': 'active()',
    '[class.icon-btn--round]': 'round()',
  },
})
export class IconButtonComponent {
  readonly size = input<IconButtonSize>('md');
  readonly variant = input<IconButtonVariant>('ghost');

  /** Active/selected state — gold tint. */
  readonly active = input(false, { transform: booleanAttribute });
  /** Circular instead of `--radius-md`. */
  readonly round = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly type = input<'button' | 'submit'>('button');

  /** Required — an icon-only button needs an accessible name. */
  readonly ariaLabel = input.required<string>();
}
