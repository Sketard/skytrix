import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Switch-style toggle for boolean preferences. Emits `change` on click.
 *
 * Visual reference: preferences-page motion section (track + thumb, gold-on
 * when active). The component is uncontrolled: the host owns the state and
 * passes `checked` back in each render.
 */
@Component({
  selector: 'app-toggle-switch',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toggle-switch.component.html',
  styleUrl: './toggle-switch.component.scss',
})
export class ToggleSwitchComponent {
  readonly checked = input<boolean>(false);
  readonly labelKey = input.required<string>();
  readonly hintKey = input<string>();

  /** Emitted when the user toggles the switch. Renamed from `change` to
   *  avoid shadowing the native DOM `change` event on the host. */
  readonly toggled = output<void>();
}
