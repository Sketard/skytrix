import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { DeckBuildService } from '../../../services/deck-build.service';
import { ShortDeck } from '../../../core/model/short-deck';

@Component({
  selector: 'app-deck-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton,
    MatProgressSpinner, RouterLink, MatButtonToggle, MatButtonToggleGroup,
  ],
  template: `
    <h2 mat-dialog-title>Select a Deck</h2>
    <mat-dialog-content>
      @if (quickDuel()) {
        <mat-button-toggle-group [value]="activeSlot()" (change)="onSlotChange($event.value)"
                                 class="slot-toggle">
          <mat-button-toggle value="p1">P1 Deck</mat-button-toggle>
          <mat-button-toggle value="p2">P2 Deck</mat-button-toggle>
        </mat-button-toggle-group>
        @if (activeSlot() === 'p2' && selectedId2() === null) {
          <p class="mirror-hint">(Miroir de P1)</p>
        }
        <mat-button-toggle-group [value]="firstPlayer()" (change)="firstPlayer.set($event.value)"
                                 class="slot-toggle first-toggle">
          <mat-button-toggle value="p1">P1 1st</mat-button-toggle>
          <mat-button-toggle value="p2">P2 1st</mat-button-toggle>
        </mat-button-toggle-group>
      }
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
                    [class.selected]="activeSelectedId() === deck.id"
                    (click)="selectDeck(deck.id)">
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
    .slot-toggle {
      display: flex;
      width: 100%;
      margin-bottom: 8px;
    }
    .mirror-hint {
      text-align: center;
      opacity: 0.5;
      font-size: 12px;
      margin: 0 0 8px;
    }
  `],
})
export class DeckPickerDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<DeckPickerDialogComponent>);
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly data: { quickDuel: boolean } | null = inject(MAT_DIALOG_DATA, { optional: true });

  readonly decks = signal<ShortDeck[]>([]);
  readonly loading = signal(true);
  readonly fetchError = signal(false);
  readonly selectedId = signal<number | null>(null);
  readonly selectedId2 = signal<number | null>(null);
  readonly activeSlot = signal<'p1' | 'p2'>('p1');
  readonly firstPlayer = signal<'p1' | 'p2'>('p1');
  readonly quickDuel = computed(() => this.data?.quickDuel ?? false);

  readonly activeSelectedId = computed(() =>
    this.activeSlot() === 'p1' ? this.selectedId() : this.selectedId2()
  );

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

  onSlotChange(value: string): void {
    this.activeSlot.set(value as 'p1' | 'p2');
  }

  selectDeck(id: number): void {
    if (this.activeSlot() === 'p1') {
      this.selectedId.set(id);
    } else {
      this.selectedId2.set(id);
    }
  }

  confirm(): void {
    const id = this.selectedId();
    if (id === null) return;

    if (this.quickDuel()) {
      this.dialogRef.close({
        decklistId1: id,
        decklistId2: this.selectedId2() ?? id,
        firstPlayer: this.firstPlayer() === 'p1' ? 1 : 2,
      });
    } else {
      const name = this.decks().find(d => d.id === id)?.name ?? '';
      this.dialogRef.close({ id, name });
    }
  }
}
