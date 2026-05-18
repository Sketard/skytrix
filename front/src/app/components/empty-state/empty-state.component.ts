import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

export type EmptyStateVariant = 'default' | 'welcome';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [RouterLink, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
})
export class EmptyStateComponent {
  readonly message = input.required<string>();
  readonly subtitle = input<string>();
  readonly ctaLabel = input<string>();
  readonly ctaLink = input<string>();
  readonly variant = input<EmptyStateVariant>('default');
  readonly icon = input<string>();
  readonly ctaAction = output<void>();
}
