import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { BetweenFilterComponent } from './components/between-filter/between-filter.component';
import { TokenSelectComponent } from './components/token-select/token-select.component';
import { ToggleIconFilterComponent } from './components/toggle-icon-filter/toggle-icon-filter.component';
import { CardSetSearchFilterComponent } from './components/card-set-search-filter/card-set-search-filter.component';
import { CardType } from '../../core/enums/card-type.enum';
import { CardRace } from '../../core/enums/card-race.enum';
import { CardAttribute } from '../../core/enums/card-attribute';
import { SearchServiceCore } from '../../services/search-service-core.service';
import { clearFormArray } from '../../core/utilities/functions';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntil } from 'rxjs/operators';
import { Observable, of, Subject } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { IconedAutocompleteOption } from '../../core/model/commons/short-resource';

@Component({
  selector: 'app-card-filters',
  imports: [
    BetweenFilterComponent,
    TokenSelectComponent,
    ToggleIconFilterComponent,
    CardSetSearchFilterComponent,
    ReactiveFormsModule,
    TranslatePipe,
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
  public readonly races = Object.values(CardRace).filter(race => race !== CardRace.OTHER);
  public readonly attributes = Object.values(CardAttribute);
  public readonly toggleIcons = this.attributes.map((attribute: CardAttribute) => ({
    title: attribute,
    icon: `assets/images/attributes/${attribute}.svg`,
    value: attribute,
  }));

  public readonly types$: Observable<Array<IconedAutocompleteOption<CardType>>> = of(
    this.types.map(t => ({ id: t, name: `card_type.${t}` }))
  );

  public readonly races$: Observable<Array<IconedAutocompleteOption<CardRace>>> = of(
    this.races.map(r => ({
      id: r,
      name: `card_race.${r}`,
      icon: `assets/images/races/${r}.webp`,
    }))
  );

  public readonly localForm = new FormGroup(SearchServiceCore.buildSearchForm());

  private readonly formVersion = signal(0);
  readonly activeFilterCount = computed<number>(() => {
    this.formVersion();
    const v = this.localForm.value;
    let n = 0;
    if (v.types && v.types.length) n++;
    if (v.races && v.races.length) n++;
    if (v.attribute) n++;
    if (v.archetype) n++;
    if (v.minAtk != null || v.maxAtk != null) n++;
    if (v.minDef != null || v.maxDef != null) n++;
    if (v.minScale != null || v.maxScale != null) n++;
    if (v.minLinkval != null || v.maxLinkval != null) n++;
    const csf = v.cardSetFilter;
    if (csf && (csf.cardSetName || csf.cardSetCode || csf.cardRarityCode)) n++;
    return n;
  });

  clearAllFilters(): void {
    this.searchService()?.clearFilters();
  }

  constructor() {
    effect(() => {
      const service = this.searchService();
      if (service) {
        this.localForm.patchValue(service.filterForm.value);
        this.unsubscribe$.next();
        this.localForm.valueChanges.pipe(takeUntil(this.unsubscribe$)).subscribe(() => {
          this.formVersion.update(v => v + 1);
          this.syncToService();
        });
        service.filtersCleared$.pipe(takeUntil(this.unsubscribe$)).subscribe(() => {
          clearFormArray(this.localForm.controls.types, false);
          clearFormArray(this.localForm.controls.races, false);
          this.localForm.patchValue({
            minAtk: null,
            maxAtk: null,
            minDef: null,
            maxDef: null,
            attribute: null,
            archetype: '',
            minScale: null,
            maxScale: null,
            minLinkval: null,
            maxLinkval: null,
            cardSetFilter: { cardSetName: '', cardSetCode: '', cardRarityCode: '' },
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

    const targetTypes = service.filterForm.controls.types;
    clearFormArray(targetTypes, false);
    this.localForm.controls.types.controls.forEach(c => targetTypes.push(c, { emitEvent: false }));

    const targetRaces = service.filterForm.controls.races;
    clearFormArray(targetRaces, false);
    this.localForm.controls.races.controls.forEach(c => targetRaces.push(c, { emitEvent: false }));

    service.filterForm.patchValue(this.localForm.value);
  }
}
