import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { DeckBuildService } from '../../../services/deck-build.service';
import { ShortDeck } from '../../../core/model/short-deck';

@Component({
  selector: 'app-deck-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton, MatProgressSpinner, RouterLink],
  template: `
    <h2 mat-dialog-title>Select a Deck</h2>
    <mat-dialog-content>
      @if (loading()) {
        <div class="picker-loading">
          <mat-progress-spinner mode="indeterminate" diameter="36"></mat-progress-spinner>
        </div>
      } @else if (fetchError()) {
        <p class="picker-error">Failed to load decks</p>
        <button mat-button (click)="loadDecks()">Retry</button>
      } @else if (decks().length === 0) {
        <p class="picker-empty">No decks available</p>
        <a [routerLink]="['/decks']" mat-button (click)="dialogRef.close()">Go to Deck Builder</a>
      } @else {
        <div class="deck-list">
          @for (deck of decks(); track deck.id) {
            <button mat-button
                    class="deck-item"
                    [class.selected]="selectedId() === deck.id"
                    (click)="selectedId.set(deck.id)">
              {{ deck.name }}
            </button>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button
              color="primary"
              [disabled]="selectedId() === null"
              (click)="confirm()">
        Confirm
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .picker-loading {
      display: flex;
      justify-content: center;
      padding: 24px 0;
    }
    .picker-empty, .picker-error {
      text-align: center;
      opacity: 0.7;
    }
    .deck-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 300px;
      overflow-y: auto;
    }
    .deck-item {
      text-align: left;
      justify-content: flex-start;
    }
    .deck-item.selected {
      background: rgba(255, 255, 255, 0.1);
    }
  `],
})
export class DeckPickerDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<DeckPickerDialogComponent>);
  private readonly deckBuildService = inject(DeckBuildService);

  readonly decks = signal<ShortDeck[]>([]);
  readonly loading = signal(true);
  readonly fetchError = signal(false);
  readonly selectedId = signal<number | null>(null);

  ngOnInit(): void {
    this.loadDecks();
  }

  loadDecks(): void {
    this.loading.set(true);
    this.fetchError.set(false);
    this.deckBuildService.getAllDecks().subscribe({
      next: decks => {
        this.decks.set(decks);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.fetchError.set(true);
      },
    });
  }

  confirm(): void {
    const id = this.selectedId();
    if (id !== null) {
      this.dialogRef.close(id);
    }
  }
}
