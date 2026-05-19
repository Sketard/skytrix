import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Card-style radio button: label + optional description stacked.
 * Pair with `<app-radio-card-group>` for grid + aria-radiogroup container.
 */
@Component({
  selector: 'app-radio-card',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './radio-card.component.html',
  styleUrl: './radio-card.component.scss',
})
export class RadioCardComponent {
  readonly labelKey = input.required<string>();
  readonly descKey = input<string>();
  readonly active = input<boolean>(false);

  readonly select = output<void>();
}
