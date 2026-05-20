import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { IconWrapComponent, IconWrapPalette } from '../icon-wrap/icon-wrap.component';
import { ButtonComponent } from '../button/button.component';

/**
 * Standard page chrome shared by every Track B index page: the decorative
 * holo-arena background (`.screen-bg` + grid + 2 glows) + the `.page-header`
 * row (icon + title + subtitle + optional back-nav, with the A6 mobile
 * pattern of moving the back button into the title row as icon-only).
 *
 * Content projection:
 *   - default slot → page body (rendered below the header).
 *   - `[header-actions]` slot → buttons rendered on the right of the header
 *     when `backRoute` / `backLabelKey` aren't used (sort menus, etc.).
 *
 * One of `icon` (plain mat-icon at 38px) or `iconWrapPalette` (44×44
 * IconWrap with gold/cyan halo, like deck-list / card-search) is required.
 * Both can be set; iconWrapPalette wins.
 */
@Component({
  selector: 'app-page-shell',
  standalone: true,
  imports: [MatIcon, TranslatePipe, IconWrapComponent, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './page-shell.component.html',
  styleUrl: './page-shell.component.scss',
  host: {
    '[class.page-shell--has-back]': 'hasBack()',
  },
})
export class PageShellComponent {
  readonly titleKey = input.required<string>();
  readonly subtitleKey = input<string>();
  readonly icon = input<string>();
  readonly iconWrapPalette = input<IconWrapPalette | null>(null);

  /** Optional back-nav: declarative route (renders `<a>` with routerLink). */
  readonly backRoute = input<string | null>(null);
  /** Optional back-nav: imperative callback (renders `<button>` emitting `backAction`). */
  readonly backActionEnabled = input<boolean>(false);
  readonly backLabelKey = input<string>('common.back');
  readonly backAriaLabelKey = input<string>();
  /** Apply the `--compact` variant (sticky, smaller) — used by replay viewer. */
  readonly compact = input<boolean>(false);
  /** Apply the `--bordered` variant (bottom border + padding). */
  readonly bordered = input<boolean>(false);
  /**
   * Constrain the header row to a centered column of this CSS width, so it
   * aligns with a projected body that is itself `max-width` + `margin: 0 auto`
   * (e.g. replay-hub `--container-wide`). Defaults to full width.
   */
  readonly contentMaxWidth = input<string>();

  readonly backAction = output<void>();

  readonly hasBackRoute = computed(() => !!this.backRoute());
  readonly hasBackAction = computed(() => !this.hasBackRoute() && this.backActionEnabled());
  readonly hasBack = computed(() => this.hasBackRoute() || this.hasBackAction());

  readonly headerClass = computed(() => {
    const classes = ['page-header'];
    if (this.compact()) classes.push('page-header--compact');
    if (this.bordered()) classes.push('page-header--bordered');
    return classes.join(' ');
  });
}
