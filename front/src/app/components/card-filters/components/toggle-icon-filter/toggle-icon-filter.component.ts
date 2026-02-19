import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatChipAvatar, MatChipListbox, MatChipOption } from '@angular/material/chips';

export type ToggleIconFilter<T> = {
  title: string;
  icon: string;
  value: T;
};

@Component({
  selector: 'app-toggle-icon-filter',
  imports: [MatChipListbox, MatChipOption, MatChipAvatar, ReactiveFormsModule],
  templateUrl: './toggle-icon-filter.component.html',
  styleUrl: './toggle-icon-filter.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToggleIconFilterComponent<T> {
  readonly toggleIcons = input<Array<ToggleIconFilter<T>>>([]);
  readonly form = input<FormControl<T | null>>(new FormControl<T | null>(null));
  readonly inputLabel = input<string>('');
}
