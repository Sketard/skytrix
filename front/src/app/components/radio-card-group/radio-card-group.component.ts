import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type RadioCardColumns = 2 | 3 | 4;

/**
 * Container for `<app-radio-card>` children. Responsible for the radio-group
 * accessibility role, the grid columns, and the aria-label. Children handle
 * their own active state and selection event.
 */
@Component({
  selector: 'app-radio-card-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content></ng-content>`,
  styleUrl: './radio-card-group.component.scss',
  host: {
    role: 'radiogroup',
    '[attr.aria-label]': 'ariaLabel()',
    '[class.radio-card-group--cols-2]': 'columns() === 2',
    '[class.radio-card-group--cols-3]': 'columns() === 3',
    '[class.radio-card-group--cols-4]': 'columns() === 4',
  },
})
export class RadioCardGroupComponent {
  readonly columns = input<RadioCardColumns>(3);
  readonly ariaLabel = input<string | null>(null);
}
