import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * DS segmented-control button — replaces the global `.seg-btn` SCSS class
 * (`_segmented.scss`, removed).
 *
 * A compact clickable cell for view toggles (grid/list, favourites on/off)
 * grouped in a segmented control. NOT a `<app-button>`: no button chrome
 * (border, radius, generous padding) — just a cell with a gold `active` state.
 *
 * Unitary component (no group wrapper) — the 14 sites are independent toggles
 * each driven by a parent signal; a group abstraction would be YAGNI.
 *
 * Host carries the state classes via discrete `[class.x]` bindings.
 */
@Component({
  selector: 'app-seg-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seg-button.component.html',
  styleUrl: './seg-button.component.scss',
  host: {
    'class': 'seg-btn',
    '[class.seg-btn--active]': 'active()',
  },
})
export class SegButtonComponent {
  /** Selected/active state — gold tint. */
  readonly active = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly type = input<'button' | 'submit'>('button');

  /** Required — a view-toggle button needs an accessible name. */
  readonly ariaLabel = input.required<string>();

  /**
   * When set, the inner button renders `role="radio"` + `aria-checked`
   * (segmented control acting as a radio group, e.g. grid/list toggle).
   * Leave undefined for a plain toggle button.
   */
  readonly checked = input<boolean>();
}
