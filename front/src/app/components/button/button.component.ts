import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * DS button — native `<button>` / `<a>` with typed variants, sizes and states.
 * Replaces the global `.btn` SCSS class family (`_buttons.scss`, removed).
 *
 * Polymorphic host: pass `link` (router path) or `href` (external URL) to
 * render an `<a>`, otherwise a `<button>`. Content is projected via
 * `<ng-content>`.
 *
 * The host carries the variant/size classes via discrete `[class.x]` bindings
 * (NOT a single `[class]` binding — that would wipe layout classes passed by
 * the parent, e.g. `class="deck-list__cta"`).
 *
 * NOT a Material wrapper — the MDC layer conflicts with the DS gradient/border
 * (see former `_buttons.scss` note). Ripple is intentionally dropped.
 */
@Component({
  selector: 'app-button',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
  host: {
    'class': 'btn',
    '[class.btn--primary]': "variant() === 'primary'",
    '[class.btn--secondary]': "variant() === 'secondary'",
    '[class.btn--ghost]': "variant() === 'ghost'",
    '[class.btn--danger]': "variant() === 'danger'",
    '[class.btn--sm]': "size() === 'sm'",
    '[class.btn--md]': "size() === 'md'",
    '[class.btn--lg]': "size() === 'lg'",
    '[class.btn--cta]': 'cta()',
    '[class.btn--shimmer]': 'shimmer()',
    '[class.btn--full]': 'full()',
    '[class.btn--icon-only]': 'iconOnly()',
    '[class.btn--flash]': 'flash()',
    '[class.btn--loading]': 'loading()',
  },
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<'button' | 'submit'>('button');

  /** Uppercase + wider letter-spacing — call-to-action emphasis. */
  readonly cta = input(false, { transform: booleanAttribute });
  /** Animated diagonal shimmer overlay — "wow" CTAs only. Requires `cta`. */
  readonly shimmer = input(false, { transform: booleanAttribute });
  /** Full-width (100%). */
  readonly full = input(false, { transform: booleanAttribute });
  /** Square padding for an icon-only button (no label). */
  readonly iconOnly = input(false, { transform: booleanAttribute });
  /** Transient success feedback (toggled by JS ~1.5-2s after copy/save). */
  readonly flash = input(false, { transform: booleanAttribute });

  readonly disabled = input(false, { transform: booleanAttribute });
  /** Spinner + disabled + `aria-busy`. */
  readonly loading = input(false, { transform: booleanAttribute });

  readonly ariaLabel = input<string>();
  /** Autofocus the inner `<button>` on render. */
  readonly autofocus = input(false, { transform: booleanAttribute });

  /** Renders an `<a>` host with this router path instead of a `<button>`. */
  readonly link = input<string | unknown[]>();
  /** Renders an `<a>` host with this external `href` instead of a `<button>`. */
  readonly href = input<string>();

  readonly isLink = computed(() => this.link() != null || this.href() != null);
  readonly isDisabled = computed(() => this.disabled() || this.loading());
}
