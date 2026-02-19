import { ChangeDetectionStrategy, Component, computed, HostListener, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { CardSearcherComponent } from '../../components/card-searcher/card-searcher.component';
import { SearchBarComponent } from '../../components/search-bar/search-bar.component';
import { CardFiltersComponent } from '../../components/card-filters/card-filters.component';
import { CardListComponent } from '../../components/card-list/card-list.component';
import { CardSearchService } from '../../services/card-search.service';
import { CardInspectorComponent } from '../../components/card-inspector/card-inspector.component';
import { BottomSheetComponent } from '../../components/bottom-sheet/bottom-sheet.component';
import { NavbarCollapseService } from '../../services/navbar-collapse.service';
import { SharedCardInspectorData, toSharedCardInspectorData } from '../../core/model/shared-card-data';
import { CardDetail } from '../../core/model/card-detail';
import { CardDisplayType } from '../../core/enums/card-display-type';

@Component({
  selector: 'card-search-page',
  imports: [
    CardSearcherComponent, CardInspectorComponent, MatIconButton, MatIcon, BottomSheetComponent,
    SearchBarComponent, CardFiltersComponent, CardListComponent, MatButtonToggle, MatButtonToggleGroup, MatTooltip,
  ],
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
  readonly displayType = CardDisplayType;

  readonly externalFiltersOpened = signal(false);

  private readonly navbarCollapseService = inject(NavbarCollapseService);
  private readonly breakpointObserver = inject(BreakpointObserver);
  readonly isMobilePortrait = this.navbarCollapseService.isMobilePortrait;
  readonly isCompactHeight = toSignal(
    this.breakpointObserver.observe(['(min-width: 768px) and (max-height: 500px)'])
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );
  readonly isLandscapeSplit = toSignal(
    this.breakpointObserver.observe(['(orientation: landscape) and (min-width: 576px) and (max-width: 767px)'])
      .pipe(map(result => result.matches)),
    { initialValue: false }
  );
  readonly useExternalFilters = computed(() => this.isLandscapeSplit() || this.isCompactHeight());

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
    if (this.useExternalFilters()) {
      this.externalFiltersOpened.set(expanded);
    } else {
      this.filtersRequestedSnap.set(expanded ? 'full' : null);
    }
  }

  setDisplayMode(mode: CardDisplayType): void {
    this.cardSearchService.setDisplayMode(mode);
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
