import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { toObservable } from '@angular/core/rxjs-interop';
import { map, of, switchMap } from 'rxjs';
import { AsyncPipe } from '@angular/common';
import { countValidValues } from '../../core/utilities/functions';
import { SearchServiceCore } from '../../services/search-service-core.service';

@Component({
  selector: 'search-bar',
  imports: [AsyncPipe, ReactiveFormsModule, MatInputModule, MatFormFieldModule, MatIconModule, MatIconButton],
  templateUrl: './search-bar.component.html',
  styleUrl: './search-bar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchBarComponent {
  readonly form = input(new FormControl<string>(''));
  readonly searchService = input<SearchServiceCore | undefined>(undefined);
  readonly filterToggled = output<void>();

  readonly numberOfActiveFilters$ = toObservable(this.searchService).pipe(
    switchMap(service => service
      ? service.filterForm.valueChanges.pipe(
          map(form => countValidValues(form, ['favorite', 'name']))
        )
      : of(0)
    )
  );

  public clearFormControl() {
    this.searchService()?.disableDebounceForOneRequest();
    this.form().reset();
  }

  public clearFilters() {
    this.searchService()?.clearFilters();
  }

  public openFilters() {
    this.filterToggled.emit();
  }
}
