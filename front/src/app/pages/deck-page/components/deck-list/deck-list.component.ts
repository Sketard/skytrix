import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { DeckBoxComponent } from '../../../../components/deck-box/deck-box.component';
import { SearchBarComponent } from '../../../../components/search-bar/search-bar.component';
import { DeckBoxSkeletonComponent } from '../../../../shared/skel/deck-box-skeleton.component';
import { DeckStatsStripSkeletonComponent } from '../../../../shared/skel/deck-stats-strip-skeleton.component';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';

import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../../components/confirm-dialog/confirm-dialog.component';
import { ShortDeck } from '../../../../core/model/short-deck';
import { EmptyStateComponent } from '../../../../components/empty-state/empty-state.component';
import { IconWrapComponent } from '../../../../components/icon-wrap/icon-wrap.component';
import { SectionHeaderComponent } from '../../../../components/section-header/section-header.component';
import { StatsStripComponent } from '../../../../components/stats-strip/stats-strip.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DeckListStore, DeckSortMode } from './deck-list-store';

@Component({
  selector: 'deck-list',
  imports: [
    DeckBoxComponent,
    StatsStripComponent,
    SectionHeaderComponent,
    SearchBarComponent,
    DeckBoxSkeletonComponent,
    DeckStatsStripSkeletonComponent,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    EmptyStateComponent,
    IconWrapComponent,
    TranslatePipe,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DeckListStore],
})
export class DeckListComponent implements OnInit {
  readonly deckBuildService = inject(DeckBuildService);
  protected readonly store = inject(DeckListStore);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  readonly searchControl = new FormControl<string>('', { nonNullable: true });

  // Two-way bridge: form ↔ store.searchQuery. The form drives the input UX
  // (clear button, debounce in search-bar). The store owns the canonical
  // value so the filteredDecks computed and the empty/no-results gates
  // share it.
  private readonly searchFromForm = toSignal(this.searchControl.valueChanges.pipe(startWith('')), { initialValue: '' });

  readonly sortLabelKey = computed(() => `deckList.sort.${this.store.sortMode()}`);

  constructor() {
    // Propagate form changes into the store. We don't propagate back —
    // the store is set only via UI (form input) or clearSearch() (which
    // resets the form directly below).
    effect(() => {
      const value = this.searchFromForm();
      this.store.setSearchQuery(value);
    });
  }

  ngOnInit(): void {
    this.store.start();
  }

  setSortMode(mode: DeckSortMode): void {
    this.store.setSortMode(mode);
  }

  clearSearch(): void {
    this.searchControl.setValue('');
    this.store.clearSearch();
  }

  confirmDelete(deck: ShortDeck) {
    const dialogRef = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('deckList.deleteTitle'),
        message: this.translate.instant('deckList.deleteConfirm', { name: deck.name }),
        confirmLabel: this.translate.instant('common.delete'),
        destructive: true,
      },
      width: '360px',
      panelClass: ['pvp-dialog-panel', 'pvp-dialog-panel--danger'],
      autoFocus: false,
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.store.deleteDeck(deck);
      }
    });
  }
}
