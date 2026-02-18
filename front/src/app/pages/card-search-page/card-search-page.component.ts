import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { CardSearcherComponent } from '../../components/card-searcher/card-searcher.component';
import { CardSearchService } from '../../services/card-search.service';
import { CardInspectorComponent } from '../../components/card-inspector/card-inspector.component';
import { BottomSheetComponent } from '../../components/bottom-sheet/bottom-sheet.component';
import { NavbarCollapseService } from '../../services/navbar-collapse.service';
import { SharedCardInspectorData, toSharedCardInspectorData } from '../../core/model/shared-card-data';
import { CardDetail } from '../../core/model/card-detail';

@Component({
  selector: 'card-search-page',
  imports: [CardSearcherComponent, CardInspectorComponent, MatIconButton, MatIcon, BottomSheetComponent],
  templateUrl: './card-search-page.component.html',
  styleUrl: './card-search-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearchPageComponent {
  readonly selectedCardForInspector = signal<SharedCardInspectorData | null>(null);
  protected readonly selectedCardDetail = signal<CardDetail | null>(null);

  readonly searchPanelOpened = signal(true);
  readonly filtersRequestedSnap = signal<'full' | null>(null);

  private readonly navbarCollapseService = inject(NavbarCollapseService);
  readonly isMobilePortrait = this.navbarCollapseService.isMobilePortrait;

  protected readonly cardSearchService = inject(CardSearchService);
  private readonly httpClient = inject(HttpClient);

  onCardClicked(cd: CardDetail): void {
    this.selectedCardDetail.set(cd);
    this.selectedCardForInspector.set(toSharedCardInspectorData(cd));
  }

  dismissInspector(): void {
    this.selectedCardForInspector.set(null);
    this.selectedCardDetail.set(null);
  }

  toggleSearchPanel(): void {
    this.searchPanelOpened.update(v => !v);
  }

  onFiltersExpanded(expanded: boolean): void {
    this.filtersRequestedSnap.set(expanded ? 'full' : null);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: Event): void {
    if (this.selectedCardForInspector()) {
      this.dismissInspector();
      event.stopImmediatePropagation();
    }
  }

  async toggleFavorite(): Promise<void> {
    const cd = this.selectedCardDetail();
    if (!cd) return;
    const id = cd.card.id;
    if (id == null) return;
    try {
      if (cd.favorite) {
        await firstValueFrom(this.cardSearchService.removeFavoriteCard(this.httpClient, id));
      } else {
        await firstValueFrom(this.cardSearchService.addFavoriteCard(this.httpClient, id));
      }
      const updated = { ...cd, favorite: !cd.favorite };
      this.selectedCardDetail.set(updated);
      this.selectedCardForInspector.set(toSharedCardInspectorData(updated));
      this.cardSearchService.refreshResearch();
    } catch {
      // API error — state unchanged
    }
  }
}
