import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

export type EmptyStateVariant = 'default' | 'welcome' | 'error' | 'no-results' | 'rich';
export type EmptyStateCtaVariant = 'primary' | 'secondary';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [NgClass, RouterLink, MatIcon, TranslatePipe],
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

  readonly ctaButtonClass = computed(() =>
    this.ctaVariant() === 'secondary' ? 'btn btn--secondary' : 'btn btn--primary btn--lg btn--cta',
  );
}
