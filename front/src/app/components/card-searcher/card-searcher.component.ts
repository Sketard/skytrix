import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, Signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { CardFiltersComponent } from '../card-filters/card-filters.component';
import { CardListComponent } from '../card-list/card-list.component';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
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
    SearchBarComponent,
  ],
  templateUrl: './card-searcher.component.html',
  styleUrl: './card-searcher.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearcherComponent {
  readonly deckBuildMode = input<boolean>(false);
  readonly searchService = input<SearchServiceCore | undefined>(undefined);

  readonly cardClicked = output<CardDetail>();

  public displayMode: Signal<CardDisplayType> | undefined;
  public displayType = CardDisplayType;

  private readonly breakpointObserver = inject(BreakpointObserver);
  readonly filtersOpen = signal(this.breakpointObserver.isMatched('(min-width: 768px)'));

  public form: FormGroup<TypedForm<CardFilterDTO>> | undefined = undefined;

  constructor() {
    effect(() => {
      const service = this.searchService();
      if (service) {
        this.form = service.filterForm;
        this.displayMode = service.displayMode;
      }
    });
  }

  public setDisplayMode(mode: CardDisplayType) {
    this.searchService()!.setDisplayMode(mode);
  }

  public toggleFilters() {
    this.filtersOpen.update(v => !v);
  }
}
