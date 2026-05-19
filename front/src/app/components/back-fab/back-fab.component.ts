import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Floating back FAB — top-left, gold halo, 44×44 WCAG touch target,
 * shown only when the parent flag says so (typically mobile landscape
 * with cramped vertical budget where the topbar is hidden).
 *
 * Used on replay-page (back to hub) and duel-page Z2 landscape (back to
 * lobby). The parent controls visibility via the `visible` input — the
 * component doesn't second-guess the viewport with its own media query
 * because the trigger condition differs per page.
 */
@Component({
  selector: 'app-back-fab',
  standalone: true,
  imports: [MatIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './back-fab.component.html',
  styleUrl: './back-fab.component.scss',
  host: {
    '[class.back-fab--hidden]': '!visible()',
  },
})
export class BackFabComponent {
  readonly visible = input<boolean>(true);
  readonly ariaLabelKey = input.required<string>();

  readonly back = output<void>();
}
