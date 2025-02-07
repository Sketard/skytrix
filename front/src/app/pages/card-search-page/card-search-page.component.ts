import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CardSearcherComponent } from '../../components/card-searcher/card-searcher.component';
import { CardSearchService } from '../../services/card-search.service';
import { TooltipService } from '../../services/tooltip.service';

@Component({
  selector: 'card-search-page',
  imports: [CardSearcherComponent],
  templateUrl: './card-search-page.component.html',
  styleUrl: './card-search-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearchPageComponent {
  constructor(
    protected cardSearchService: CardSearchService,
    private readonly tooltipService: TooltipService
  ) {
    this.tooltipService.setActiveSearchService(this.cardSearchService);
  }
}
