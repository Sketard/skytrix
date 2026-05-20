import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * DS checkbox — a `ControlValueAccessor`, so it works with both
 * `[(ngModel)]` and reactive forms (`formControl` / `formControlName`).
 *
 * The visible box is drawn in SCSS; the real `<input type="checkbox">` is
 * visually hidden but kept in the DOM for native focus + a11y semantics.
 * Label is projected via `<ng-content>`.
 */
@Component({
  selector: 'app-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './checkbox.component.html',
  styleUrl: './checkbox.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CheckboxComponent),
      multi: true,
    },
  ],
})
export class CheckboxComponent implements ControlValueAccessor {
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Accessible name when no text is projected. */
  readonly ariaLabel = input<string>();

  /** Current checked state — written by the form, toggled by the user. */
  protected readonly checked = signal(false);
  /** `disabled` can also be driven by the form (`setDisabledState`). */
  protected readonly formDisabled = signal(false);

  protected readonly isDisabled = () => this.disabled() || this.formDisabled();

  private onChange: (value: boolean) => void = () => {};
  private onTouched: () => void = () => {};

  protected toggle(): void {
    if (this.isDisabled()) return;
    const next = !this.checked();
    this.checked.set(next);
    this.onChange(next);
    this.onTouched();
  }

  // --- ControlValueAccessor --------------------------------------------------
  writeValue(value: boolean): void {
    this.checked.set(!!value);
  }
  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }
}
