import { ChangeDetectionStrategy, Component, DestroyRef, inject, Input, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatAutocomplete, MatAutocompleteSelectedEvent, MatAutocompleteTrigger, MatOption } from '@angular/material/autocomplete';
import { MatFormField, MatInput, MatLabel } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { CardSetFilterDTO } from '../../../../core/model/dto/card-filter-dto';
import { TypedForm } from '../../../../core/model/commons/typed-form';
import { CardSetService, CardSetShortDTO } from '../../../../services/card-set.service';

@Component({
  selector: 'app-card-set-search-filter',
  templateUrl: './card-set-search-filter.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatInput,
    MatFormField,
    MatLabel,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
    TranslatePipe,
  ],
})
export class CardSetSearchFilterComponent implements OnInit {
  @Input({ required: true }) form!: FormGroup<TypedForm<CardSetFilterDTO>>;

  readonly suggestions = signal<CardSetShortDTO[]>([]);
  readonly displayControl = new FormControl<string>('');

  private readonly cardSetService = inject(CardSetService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.syncDisplayFromForm();
    this.setupSearch();
  }

  private syncDisplayFromForm(): void {
    this.form.controls.cardSetName.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(value => {
        if (value !== this.displayControl.value) {
          this.displayControl.setValue(value ?? '', { emitEvent: false });
        }
      });
  }

  private setupSearch(): void {
    this.displayControl.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap(value => {
          const name = value ?? '';
          if (!name.trim()) return of([]);
          return this.cardSetService.searchShort({ cardSetName: name, cardSetCode: null, cardRarityCode: null });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(results => this.suggestions.set(results));
  }

  onOptionSelected(event: MatAutocompleteSelectedEvent): void {
    const name: string = event.option.value;
    this.form.controls.cardSetName.setValue(name);
  }

  onClear(): void {
    this.displayControl.setValue('', { emitEvent: false });
    this.form.controls.cardSetName.setValue('');
    this.suggestions.set([]);
  }
}
