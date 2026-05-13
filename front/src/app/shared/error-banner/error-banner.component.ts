import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

/** Inline non-toast warning banner — sits in normal page flow, more persistent
 *  than a toast. Spec source: `_mockups/mockup-1-holo-arena.html` `.error-banner`
 *  (ll. 1826-1875).
 *
 *  Three variants: `error` (red, default), `warning` (amber), `info` (gold). */
export type ErrorBannerVariant = 'error' | 'warning' | 'info';

@Component({
  selector: 'app-error-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, TranslatePipe],
  host: {
    role: 'status',
    'aria-live': 'polite',
    'class': 'error-banner',
    '[class.error-banner--error]':   "variant() === 'error'",
    '[class.error-banner--warning]': "variant() === 'warning'",
    '[class.error-banner--info]':    "variant() === 'info'",
  },
  template: `
    <div class="error-banner-icon">
      <mat-icon>{{ icon() }}</mat-icon>
    </div>
    <div class="error-banner-body">
      <div class="error-banner-title">{{ titleKey() | translate }}</div>
      @if (descKey(); as key) {
        <div class="error-banner-desc">{{ key | translate }}</div>
      }
    </div>
  `,
  styleUrl: './error-banner.component.scss',
})
export class ErrorBannerComponent {
  readonly variant = input<ErrorBannerVariant>('error');
  readonly titleKey = input.required<string>();
  readonly descKey = input<string | null>(null);
  readonly icon = input<string>('error_outline');
}
