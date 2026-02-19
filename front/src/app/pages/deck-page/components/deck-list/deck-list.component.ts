import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DeckBuildService } from '../../../../services/deck-build.service';
import { DeckBoxComponent } from '../../../../components/deck-box/deck-box.component';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ConfirmDialogComponent, ConfirmDialogData } from '../../../../components/confirm-dialog/confirm-dialog.component';
import { ShortDeck } from '../../../../core/model/short-deck';
import { EmptyStateComponent } from '../../../../components/empty-state/empty-state.component';
import { displaySuccess, displayError } from '../../../../core/utilities/functions';

@Component({
  selector: 'deck-list',
  imports: [CommonModule, DeckBoxComponent, MatIconModule, MatButtonModule, EmptyStateComponent],
  templateUrl: './deck-list.component.html',
  styleUrl: './deck-list.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckListComponent {
  readonly deckBuildService = inject(DeckBuildService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  constructor() {
    this.deckBuildService.fetchDecks();
  }

  confirmDelete(deck: ShortDeck) {
    const dialogRef = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
      data: { title: 'Supprimer le deck', message: `Voulez-vous vraiment supprimer "${deck.name}" ?`, confirmLabel: 'Supprimer' },
      autoFocus: false,
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.deckBuildService.deleteById(
          deck.id!,
          () => displaySuccess(this.snackBar, 'Deck supprimé'),
          (err) => displayError(this.snackBar, err)
        );
      }
    });
  }
}
