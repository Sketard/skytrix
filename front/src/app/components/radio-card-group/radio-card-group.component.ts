import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input } from '@angular/core';

export type RadioCardColumns = 2 | 3 | 4;

/**
 * Container for `<app-radio-card>` children. Responsible for the radio-group
 * accessibility role, the grid columns, the aria-label, AND the WAI-ARIA
 * radiogroup keyboard pattern: arrow keys move focus + select between radios,
 * Home/End jump to first/last. The active radio is the only one in the
 * tab order (roving tabindex managed by `<app-radio-card>` via its `active`
 * input).
 *
 * The host queries projected `[role="radio"]` buttons in the live DOM (no
 * `contentChildren` query — keeps the children decoupled).
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

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const radios = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    if (radios.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const currentIndex = radios.findIndex(r => r === active);
    // If focus is outside the group, start from the active radio (aria-checked=true)
    // and move from there; otherwise advance from the focused index.
    const startIndex = currentIndex >= 0
      ? currentIndex
      : Math.max(0, radios.findIndex(r => r.getAttribute('aria-checked') === 'true'));

    let nextIndex = startIndex;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        nextIndex = (startIndex + 1) % radios.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        nextIndex = (startIndex - 1 + radios.length) % radios.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = radios.length - 1;
        break;
    }

    event.preventDefault();
    const target = radios[nextIndex];
    target.focus();
    // WAI-ARIA radiogroup: arrow keys also SELECT the focused radio.
    target.click();
  }
}
