import { ChangeDetectionStrategy, Component, effect, input, Signal } from '@angular/core';
import { CardFiltersComponent } from '../card-filters/card-filters.component';
import { CardListComponent } from '../card-list/card-list.component';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { NgIf } from '@angular/common';
import { SearchBarComponent } from '../search-bar/search-bar.component';
import { CardSize } from '../card/card.component';
import { CardDisplayType } from '../../core/enums/card-display-type';
import { SearchServiceCore } from '../../services/search-service-core.service';
import { FormGroup } from '@angular/forms';
import { TypedForm } from '../../core/model/commons/typed-form';
import { CardFilterDTO } from '../../core/model/dto/card-filter-dto';

@Component({
  selector: 'app-card-searcher',
  imports: [
    CardFiltersComponent,
    CardListComponent,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatIcon,
    NgIf,
    SearchBarComponent,
  ],
  templateUrl: './card-searcher.component.html',
  styleUrl: './card-searcher.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearcherComponent {
  readonly deckBuildMode = input<boolean>(false);
  readonly size = input(CardSize.MEDIUM);
  readonly searchService = input<SearchServiceCore | undefined>(undefined);

  public defaultSize = CardSize.MEDIUM;
  public cropped = false;
  public displayMode: Signal<CardDisplayType> | undefined;
  public displayType = CardDisplayType;

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
}
