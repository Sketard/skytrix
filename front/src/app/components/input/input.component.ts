import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export type InputType = 'text' | 'number' | 'password' | 'email' | 'search';

/**
 * DS text input — a `ControlValueAccessor`, so it works with both
 * `[(ngModel)]` and reactive forms (`formControl` / `formControlName`).
 *
 * Replaces ad-hoc `<mat-form-field>` + `matInput` for plain text fields.
 * NOT for Material-coupled inputs (e.g. `matAutocomplete`) — those stay
 * on Material.
 *
 * Optional `label` renders a stacked label above the field.
 */
@Component({
  selector: 'app-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './input.component.html',
  styleUrl: './input.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true,
    },
  ],
})
export class InputComponent implements ControlValueAccessor {
  readonly type = input<InputType>('text');
  readonly label = input<string>();
  readonly placeholder = input<string>('');
  readonly ariaLabel = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Red border + `aria-invalid` — drive from a form error or a signal. */
  readonly invalid = input(false, { transform: booleanAttribute });

  /** Current value — written by the form, edited by the user. */
  protected readonly value = signal('');
  /** `disabled` can also be driven by the form (`setDisabledState`). */
  protected readonly formDisabled = signal(false);

  protected readonly isDisabled = () => this.disabled() || this.formDisabled();

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this.onChange(next);
  }

  protected onBlur(): void {
    this.onTouched();
  }

  // --- ControlValueAccessor --------------------------------------------------
  writeValue(value: string | number | null): void {
    this.value.set(value == null ? '' : String(value));
  }
  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }
}
