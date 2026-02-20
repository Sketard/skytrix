import { ChangeDetectionStrategy, Component, effect, input, output, signal, Signal } from '@angular/core';
import { CardFiltersComponent } from '../card-filters/card-filters.component';
import { CardListComponent } from '../card-list/card-list.component';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { CardDisplayType } from '../../core/enums/card-display-type';
import { SearchServiceCore } from '../../services/search-service-core.service';
import { FormGroup } from '@angular/forms';
import { TypedForm } from '../../core/model/commons/typed-form';
import { CardFilterDTO } from '../../core/model/dto/card-filter-dto';
import { CardDetail } from '../../core/model/card-detail';

@Component({
  selector: 'app-card-searcher',
  imports: [
    CardFiltersComponent,
    CardListComponent,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatIcon,
    MatIconButton,
    MatTooltip,
    SearchBarComponent,
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

  constructor() {
    effect(() => {
      const service = this.searchService();
      if (service) {
        this.form = service.filterForm;
        this.displayMode = service.displayMode;
        this.favoriteFilter = service.favoriteFilter;
      }
    });
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
