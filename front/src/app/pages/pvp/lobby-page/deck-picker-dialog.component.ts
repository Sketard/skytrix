import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { DeckBuildService } from '../../../services/deck-build.service';
import { ShortDeck } from '../../../core/model/short-deck';

export type DeckPickerContext = 'create' | 'join' | 'quickDuel';

interface DeckPickerDialogData {
  context: DeckPickerContext;
}

const TITLES: Record<DeckPickerContext, string> = {
  create: 'Choisis ton deck',
  join: 'Choisis ton deck pour rejoindre',
  quickDuel: 'Duel rapide',
};

const CONFIRM_LABELS: Record<DeckPickerContext, string> = {
  create: 'Creer la room',
  join: 'Rejoindre',
  quickDuel: 'Lancer le duel',
};

@Component({
  selector: 'app-deck-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton,
    MatProgressSpinner, MatIcon, RouterLink, MatButtonToggle, MatButtonToggleGroup,
  ],
  template: `
    <h2 mat-dialog-title>{{ title }}</h2>
    <mat-dialog-content>
      @if (isQuickDuel()) {
        <div class="qd-section">
          <span class="qd-label">Decks</span>
          <mat-button-toggle-group [value]="activeSlot()" (change)="onSlotChange($event.value)"
                                   class="slot-toggle">
            <mat-button-toggle value="p1">Joueur 1</mat-button-toggle>
            <mat-button-toggle value="p2">Joueur 2</mat-button-toggle>
          </mat-button-toggle-group>
          @if (activeSlot() === 'p2' && selectedId2() === null) {
            <p class="mirror-hint">Miroir du Joueur 1</p>
          }
        </div>
        <div class="qd-section">
          <span class="qd-label">Premier joueur</span>
          <mat-button-toggle-group [value]="firstPlayer()" (change)="firstPlayer.set($event.value)"
                                   class="slot-toggle">
            <mat-button-toggle value="p1">Joueur 1</mat-button-toggle>
            <mat-button-toggle value="p2">Joueur 2</mat-button-toggle>
          </mat-button-toggle-group>
        </div>
      }
      @if (loading()) {
        <div class="picker-loading">
          <mat-progress-spinner mode="indeterminate" diameter="36"></mat-progress-spinner>
        </div>
      } @else if (fetchError()) {
        <div class="picker-message">
          <p>Impossible de charger les decks</p>
          <button mat-button (click)="loadDecks()">Reessayer</button>
        </div>
      } @else if (decks().length === 0) {
        <div class="picker-message">
          <p>Aucun deck disponible</p>
          <p class="picker-hint">Cree un deck dans le Deck Builder pour commencer.</p>
          <a [routerLink]="['/decks']" mat-button (click)="dialogRef.close()">Aller au Deck Builder</a>
        </div>
      } @else {
        <div class="deck-list" role="listbox" aria-label="Liste des decks">
          @for (deck of decks(); track deck.id) {
            <button class="deck-item"
                    role="option"
                    [attr.aria-selected]="activeSelectedId() === deck.id"
                    [class.selected]="activeSelectedId() === deck.id"
                    (click)="selectDeck(deck.id)">
              <img class="deck-thumb"
                   [src]="deck.urls.length > 0 ? deck.urls[0] : 'assets/images/card_back.jpg'"
                   alt=""
                   loading="lazy"
                   (error)="$any($event.target).src='assets/images/card_back.jpg'" />
              <span class="deck-name">{{ deck.name }}</span>
              @if (activeSelectedId() === deck.id) {
                <mat-icon class="deck-check">check_circle</mat-icon>
              }
            </button>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annuler</button>
      <button mat-raised-button
              class="confirm-btn"
              [disabled]="selectedId() === null"
              (click)="confirm()">
        {{ confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
    }

    .qd-section {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }

    .qd-label {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .slot-toggle {
      display: flex;
      width: 100%;

      mat-button-toggle {
        flex: 1;
      }
    }

    .mirror-hint {
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.8rem;
      font-style: italic;
      margin: 0;
    }

    .picker-loading {
      display: flex;
      justify-content: center;
      padding: 32px 0;
    }

    .picker-message {
      text-align: center;
      padding: 24px 0;

      p {
        margin: 0 0 4px;
        color: var(--text-secondary);
      }
    }

    .picker-hint {
      font-size: 0.85rem;
      margin-bottom: 12px !important;
    }

    .deck-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 50dvh;
      overflow-y: auto;
      padding: 2px;
    }

    .deck-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      min-height: 48px;
      border-radius: var(--pvp-radius-lg);
      border: 2px solid transparent;
      background: var(--surface-card);
      color: var(--text-primary);
      cursor: pointer;
      transition: background 150ms ease-out, border-color 150ms ease-out, box-shadow 150ms ease-out;
      text-align: left;
      width: 100%;
      font: inherit;
      font-size: 0.95rem;

      &:hover {
        background: var(--surface-card-hover);
      }

      &.selected {
        border-color: var(--pvp-accent);
        box-shadow: var(--pvp-selection-glow);
      }

      &:focus-visible {
        outline: 2px solid var(--pvp-accent);
        outline-offset: 2px;
      }
    }

    .deck-thumb {
      height: 36px;
      aspect-ratio: 59 / 86;
      border-radius: var(--pvp-radius-md);
      object-fit: cover;
      flex-shrink: 0;
    }

    .deck-name {
      flex: 1;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .deck-check {
      color: var(--pvp-accent);
      font-size: 22px;
      width: 22px;
      height: 22px;
      flex-shrink: 0;
    }

    .confirm-btn {
      background: var(--pvp-accent) !important;
      color: #121212 !important;
      font-weight: 600;

      &:disabled {
        opacity: var(--pvp-disabled-opacity);
      }
    }
  `],
})
export class DeckPickerDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<DeckPickerDialogComponent>);
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly data: DeckPickerDialogData | null = inject(MAT_DIALOG_DATA, { optional: true });

  readonly context = computed<DeckPickerContext>(() => this.data?.context ?? 'create');
  readonly title = TITLES[this.data?.context ?? 'create'];
  readonly confirmLabel = CONFIRM_LABELS[this.data?.context ?? 'create'];

  readonly decks = signal<ShortDeck[]>([]);
  readonly loading = signal(true);
  readonly fetchError = signal(false);
  readonly selectedId = signal<number | null>(null);
  readonly selectedId2 = signal<number | null>(null);
  readonly activeSlot = signal<'p1' | 'p2'>('p1');
  readonly firstPlayer = signal<'p1' | 'p2'>('p1');
  readonly isQuickDuel = computed(() => this.context() === 'quickDuel');

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

    if (this.isQuickDuel()) {
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
