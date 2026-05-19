import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { startWith } from 'rxjs/operators';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { DeckBoxComponent } from '../../../../components/deck-box/deck-box.component';
import { SearchBarComponent } from '../../../../components/search-bar/search-bar.component';
import { DeckBoxSkeletonComponent } from '../../../../shared/skel/deck-box-skeleton.component';
import { DeckStatsStripSkeletonComponent } from '../../../../shared/skel/deck-stats-strip-skeleton.component';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';

import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../components/confirm-dialog/confirm-dialog.component';
import { ShortDeck } from '../../../../core/model/short-deck';
import { EmptyStateComponent } from '../../../../components/empty-state/empty-state.component';
import { DeckStatsStripComponent, DeckStat } from '../../../../components/deck-stats-strip/deck-stats-strip.component';
import { NotificationService } from '../../../../core/services/notification.service';
import { OwnedCardService } from '../../../../services/owned-card.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { formattedWithoutCaseAndAccent } from '../../../../core/utilities/functions';

@Component({
  selector: 'deck-list',
  imports: [
    CommonModule,
    DeckBoxComponent,
    DeckStatsStripComponent,
    SearchBarComponent,
    DeckBoxSkeletonComponent,
    DeckStatsStripSkeletonComponent,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    EmptyStateComponent,
    TranslatePipe,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckListComponent {
  readonly deckBuildService = inject(DeckBuildService);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly ownedCardService = inject(OwnedCardService);

  readonly searchControl = new FormControl<string>('', { nonNullable: true });
  private readonly searchTerm = toSignal(
    this.searchControl.valueChanges.pipe(startWith('')),
    { initialValue: '' },
  );

  private readonly decksSignal = toSignal(this.deckBuildService.decks$, { initialValue: [] as Array<ShortDeck> });

  readonly filteredDecks = computed<Array<ShortDeck>>(() => {
    const term = this.searchTerm() ?? '';
    const all = this.decksSignal();
    if (!term) return all;
    const needle = formattedWithoutCaseAndAccent(term);
    return all.filter(d => formattedWithoutCaseAndAccent(d.name).includes(needle));
  });

  readonly stats = computed<Array<DeckStat>>(() => {
    const all = this.decksSignal();
    const ownedSum = Array.from(this.ownedCardService.ownedMap().values()).reduce((acc, n) => acc + n, 0);
    return [
      { label: 'deckStats.decks', value: all.length },
      { label: 'deckStats.cardsOwned', value: ownedSum },
      { label: 'deckStats.legalDecks', value: all.filter(d => d.valid).length },
    ];
  });

  constructor() {
    this.deckBuildService.fetchDecks();
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
        this.deckBuildService.deleteById(
          deck.id!,
          () => this.notify.success('success.DECK_DELETED'),
          (err) => this.notify.error(err)
        );
      }
    });
  }
}
