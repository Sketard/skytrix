import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { DeckBoxComponent } from '../../../../components/deck-box/deck-box.component';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';

import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../components/confirm-dialog/confirm-dialog.component';
import { ShortDeck } from '../../../../core/model/short-deck';
import { EmptyStateComponent } from '../../../../components/empty-state/empty-state.component';
import { NotificationService } from '../../../../core/services/notification.service';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'deck-list',
  imports: [CommonModule, DeckBoxComponent, MatIconModule, MatButtonModule, MatTooltipModule, EmptyStateComponent, TranslatePipe],
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
  private readonly router = inject(Router);

  constructor() {
    this.deckBuildService.fetchDecks();
  }

  openSolver(deck: ShortDeck): void {
    this.router.navigate(['/decks', deck.id, 'solver']);
  }

  confirmDelete(deck: ShortDeck) {
    const dialogRef = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
      data: {
        title: this.translate.instant('deckList.deleteTitle'),
        message: this.translate.instant('deckList.deleteConfirm', { name: deck.name }),
        confirmLabel: this.translate.instant('common.delete'),
      },
      width: '320px',
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
