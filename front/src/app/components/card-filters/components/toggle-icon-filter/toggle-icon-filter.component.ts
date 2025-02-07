import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonToggle, MatButtonToggleChange, MatButtonToggleGroup } from '@angular/material/button-toggle';
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

  public toggleChange($event: MatButtonToggleChange): void {
    const value = $event.value;
    if (value === this.form().value) {
      this.form().setValue(null);
    } else {
      this.form().setValue(value);
    }
  }
}
