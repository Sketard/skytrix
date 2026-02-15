import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { NgForOf } from '@angular/common';

export type ToggleIconFilter<T> = {
  title: string;
  icon: string;
  value: T;
};

@Component({
  selector: 'app-toggle-icon-filter',
  imports: [MatButtonToggleGroup, MatButtonToggle, ReactiveFormsModule, NgForOf],
  templateUrl: './toggle-icon-filter.component.html',
  styleUrl: './toggle-icon-filter.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToggleIconFilterComponent<T> {
  readonly toggleIcons = input<Array<ToggleIconFilter<T>>>([]);
  readonly form = input<FormControl<T | null>>(new FormControl<T | null>(null));
  readonly inputLabel = input<string>('');

  private previousValue: T | null = null;

  public captureValue(): void {
    this.previousValue = this.form().value;
  }

  public deselect(value: T): void {
    if (value === this.previousValue) {
      this.form().setValue(null);
    }
  }
}
