import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import { BetweenFilterComponent } from './components/between-filter/between-filter.component';
import { MultiselectAutocompleteFilterComponent } from './components/multiselect-autocomplete-filter/multiselect-autocomplete-filter.component';
import { StringListToAutocompleteObjectPipe } from '../../core/pipes/string-array-to-short-resource-array.pipe';
import { ToObservablePipe } from '../../core/pipes/to-observable.pipe';
import { ToggleIconFilterComponent } from './components/toggle-icon-filter/toggle-icon-filter.component';
import { CardType } from '../../core/enums/card-type.enum';
import { CardAttribute } from '../../core/enums/card-attribute';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatSuffix } from '@angular/material/form-field';
import { NgIf } from '@angular/common';
import { SearchServiceCore } from '../../services/search-service-core.service';
import { clearFormArray } from '../../core/utilities/functions';
import { FormGroup } from '@angular/forms';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-card-filters',
  imports: [
    BetweenFilterComponent,
    MultiselectAutocompleteFilterComponent,
    StringListToAutocompleteObjectPipe,
    ToObservablePipe,
    ToggleIconFilterComponent,
    MatIcon,
    MatIconButton,
    MatSuffix,
    NgIf,
    MatButton,
  ],
  templateUrl: './card-filters.component.html',
  styleUrl: './card-filters.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardFiltersComponent {
  readonly searchService = input<SearchServiceCore | undefined>(undefined);
  readonly filtersOpened = input<boolean>(false);
  readonly close = output<void>();

  private readonly unsubscribe$ = new Subject<void>();

  public readonly types = Object.values(CardType).filter(type => type !== CardType.SKILL);
  public readonly attributes = Object.values(CardAttribute);
  public readonly toggleIcons = this.attributes.map((attribute: CardAttribute) => ({
    title: attribute,
    icon: `assets/images/attributes/${attribute}.svg`,
    value: attribute,
  }));

  public readonly localForm = new FormGroup(SearchServiceCore.buildSearchForm());

  constructor() {
    effect(() => {
      const service = this.searchService();
      if (service) {
        this.localForm.patchValue(service.filterForm.value);
        this.unsubscribe$.next();
        this.localForm.valueChanges.pipe(takeUntil(this.unsubscribe$)).subscribe(form => {
          if (!this.filtersOpened()) {
            this.search();
          }
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  public closeFilters() {
    this.close.emit();
  }

  public clearFilters() {
    const service = this.searchService()!;
    const filterForm = service.filterForm;
    clearFormArray(filterForm.controls.types, false);
    const favorite = filterForm.controls.favorite.value;
    filterForm.reset({ favorite: favorite });
    clearFormArray(this.localForm.controls.types);
    this.localForm.reset({ favorite: favorite });
  }

  public search() {
    const service = this.searchService()!;
    const types = service.filterForm.controls.types;
    clearFormArray(types, false);
    this.localForm.controls.types.controls.forEach(control => types.push(control, { emitEvent: false }));
    service.filterForm.patchValue(this.localForm.value);
    this.closeFilters();
  }
}
