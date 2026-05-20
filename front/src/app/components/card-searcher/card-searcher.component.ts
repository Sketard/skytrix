import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActiveFiltersBarComponent } from '../active-filters-bar/active-filters-bar.component';
import { CardFiltersComponent } from '../card-filters/card-filters.component';
import { CardListComponent } from '../card-list/card-list.component';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { CardDisplayType } from '../../core/enums/card-display-type';
import { SearchServiceCore } from '../../services/search-service-core.service';
import { FormGroup } from '@angular/forms';
import { TypedForm } from '../../core/model/commons/typed-form';
import { CardFilterDTO } from '../../core/model/dto/card-filter-dto';
import { CardDetail } from '../../core/model/card-detail';
import { Subscription } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { SegButtonComponent } from '../seg-button/seg-button.component';

@Component({
  selector: 'app-card-searcher',
  imports: [
    ActiveFiltersBarComponent,
    CardFiltersComponent,
    CardListComponent,
    MatIcon,
    MatTooltip,
    SearchBarComponent,
    TranslatePipe,
    SegButtonComponent,
  ],
  templateUrl: './card-searcher.component.html',
  styleUrl: './card-searcher.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearcherComponent {
  readonly deckBuildMode = input<boolean>(false);
  readonly externalFilters = input(false);
  readonly searchService = input<SearchServiceCore | undefined>(undefined);

  readonly cardClicked = output<CardDetail>();
  readonly filtersExpanded = output<boolean>();

  public displayMode: Signal<CardDisplayType> | undefined;
  public favoriteFilter: Signal<boolean> | undefined;
  public displayType = CardDisplayType;

  readonly filtersOpen = signal(false);

  public form: FormGroup<TypedForm<CardFilterDTO>> | undefined = undefined;

  private readonly resultsCount = signal<number>(0);
  readonly resultsLabel = computed<string | null>(() => {
    const svc = this.searchService();
    if (!svc) return null;
    const count = this.resultsCount();
    return svc.hasMoreResults() ? `${count}+` : `${count}`;
  });

  private resultsSub?: Subscription;

  constructor() {
    effect(() => {
      const service = this.searchService();
      if (service) {
        this.form = service.filterForm;
        this.displayMode = service.displayMode;
        this.favoriteFilter = service.favoriteFilter;
        this.resultsSub?.unsubscribe();
        this.resultsSub = service.cardsDetails$.subscribe(arr =>
          this.resultsCount.set(arr.length),
        );
      }
    });
  }

  ngOnDestroy(): void {
    this.resultsSub?.unsubscribe();
  }

  public setDisplayMode(mode: CardDisplayType) {
    this.searchService()!.setDisplayMode(mode);
  }

  public toggleFavoriteFilter() {
    this.searchService()!.toggleFavoriteFilter();
  }

  public toggleFilters() {
    if (this.externalFilters()) {
      this.filtersExpanded.emit(!this.filtersOpen());
    } else {
      this.filtersOpen.update(v => !v);
      this.filtersExpanded.emit(this.filtersOpen());
    }
  }
}
