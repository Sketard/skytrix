import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonComponent } from '../button/button.component';

export type EmptyStateVariant = 'default' | 'welcome' | 'error' | 'no-results' | 'rich';
export type EmptyStateCtaVariant = 'primary' | 'secondary';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [NgClass, MatIcon, TranslatePipe, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
})
export class EmptyStateComponent {
  readonly variant = input<EmptyStateVariant>('default');
  readonly icon = input<string>();
  readonly titleKey = input.required<string>();
  readonly descKey = input<string>();
  readonly ctaLabelKey = input<string>();
  readonly ctaIcon = input<string>();
  readonly ctaLink = input<string>();
  readonly ctaVariant = input<EmptyStateCtaVariant>('primary');
  readonly ctaDisabled = input<boolean>(false);

  readonly ctaAction = output<void>();

  readonly variantClass = computed(() => {
    const v = this.variant();
    return v === 'default' ? null : `empty-state--${v}`;
  });

  /** Primary CTA is the large uppercase variant; secondary stays default-size. */
  readonly isPrimaryCta = computed(() => this.ctaVariant() === 'primary');
  readonly ctaSize = computed<'md' | 'lg'>(() => (this.isPrimaryCta() ? 'lg' : 'md'));
}
