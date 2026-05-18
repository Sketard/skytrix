import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-between-filter',
  imports: [FormsModule, ReactiveFormsModule, TranslatePipe],
  templateUrl: './between-filter.component.html',
  styleUrl: './between-filter.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BetweenFilterComponent {
  readonly minForm = input(new FormControl<number | null>(null));
  readonly maxForm = input(new FormControl<number | null>(null));
  readonly inputLabel = input<string>('');
}
