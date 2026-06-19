import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { IconButtonComponent } from '../../../components/icon-button/icon-button.component';

/**
 * Free-mode mini-bar CARTE (§6.1) — the 7 actions on the armed card, plus the
 * mandatory counter decrement (§5.4). Presentational: the page positions it
 * (anchored to the card desktop / bottom bar mobile) and routes each action to
 * `FreeModeInteractionService`.
 *
 * "Détacher" shows only when the armed card is an XYZ material. "+/−Compteur"
 * shows the current generic counter value; decrement is mandatory because
 * counters live outside undo (§5.4).
 */
@Component({
  selector: 'app-free-mode-action-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './free-mode-action-bar.component.html',
  styleUrl: './free-mode-action-bar.component.scss',
  imports: [IconButtonComponent, MatIcon],
})
export class FreeModeActionBarComponent {
  /** Whether the armed card is an XYZ material (gates the Détacher action). */
  readonly isMaterial = input(false);
  /** Current generic counter value on the armed card (0 = none). */
  readonly counterValue = input(0);

  readonly flip = output<void>();
  readonly togglePosition = output<void>();
  readonly activate = output<void>();
  readonly destroy = output<void>();
  readonly detach = output<void>();
  readonly attachXyz = output<void>();
  readonly incrementCounter = output<void>();
  readonly decrementCounter = output<void>();
}
