import { ChangeDetectionStrategy, Component, effect, input } from '@angular/core';
import { BetweenFilterComponent } from './components/between-filter/between-filter.component';
import { MultiselectAutocompleteFilterComponent } from './components/multiselect-autocomplete-filter/multiselect-autocomplete-filter.component';
import { StringListToAutocompleteObjectPipe } from '../../core/pipes/string-array-to-short-resource-array.pipe';
import { ToObservablePipe } from '../../core/pipes/to-observable.pipe';
import { ToggleIconFilterComponent } from './components/toggle-icon-filter/toggle-icon-filter.component';
import { CardType } from '../../core/enums/card-type.enum';
import { CardAttribute } from '../../core/enums/card-attribute';
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
  ],
  templateUrl: './card-filters.component.html',
  styleUrl: './card-filters.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardFiltersComponent {
  readonly searchService = input<SearchServiceCore | undefined>(undefined);

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
        this.localForm.valueChanges.pipe(takeUntil(this.unsubscribe$)).subscribe(() => {
          this.syncToService();
        });
        service.filtersCleared$.pipe(takeUntil(this.unsubscribe$)).subscribe(() => {
          clearFormArray(this.localForm.controls.types, false);
          this.localForm.patchValue({
            minAtk: null,
            maxAtk: null,
            minDef: null,
            maxDef: null,
            attribute: null,
          }, { emitEvent: false });
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  private syncToService() {
    const service = this.searchService()!;
    const types = service.filterForm.controls.types;
    clearFormArray(types, false);
    this.localForm.controls.types.controls.forEach(control => types.push(control, { emitEvent: false }));
    service.filterForm.patchValue(this.localForm.value);
  }
}
