/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: local UI state of a pre-duel screen (booster opening, deck building,
   room settings). None of these signals feeds the duel animation pipeline the
   rule guards; the duel starts only after this screen is gone. */

import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatDialogActions, MatDialogContent, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonComponent } from '../../../components/button/button.component';
import { IconButtonComponent } from '../../../components/icon-button/icon-button.component';
import { InputComponent } from '../../../components/input/input.component';
import { PillComponent } from '../../../components/pill/pill.component';
import { BottomSheetHandleComponent } from '../../../shared/bottom-sheet-handle';
import { RoomApiService } from '../room-api.service';
import { BoosterRoomSettings, CARDS_PER_BOOSTER } from '../room.types';
import { BoosterSetDTO } from './booster.types';

/** Mirror of back CreateRoomDTO bounds. */
export const BOOSTER_COUNT_MIN = 1;
export const BOOSTER_COUNT_MAX = 40;
export const MAIN_DECK_MIN_FLOOR = 1;
export const MAIN_DECK_MAX = 60;

const DEFAULT_BOOSTER_COUNT = 10;
const DEFAULT_MIN_MAIN_DECK = 30;
/** Sets rendered at once — the full catalogue holds over a thousand. */
const MAX_LISTED_SETS = 60;

const BOOSTER_DIALOG_TITLE_ID = 'booster-room-dialog-title';

export function boosterRoomDialogConfig() {
  return {
    panelClass: 'holo-modal-panel',
    backdropClass: 'holo-modal-backdrop',
    maxWidth: '100vw',
    ariaLabelledBy: BOOSTER_DIALOG_TITLE_ID,
  };
}

/**
 * Settings of a booster room: the set to open, the boosters per player and
 * the minimum Main Deck. Closes with a {@link BoosterRoomSettings}, or
 * nothing when cancelled.
 */
@Component({
  selector: 'app-booster-room-dialog',
  templateUrl: './booster-room-dialog.component.html',
  styleUrl: './booster-room-dialog.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogContent, MatDialogActions, MatIcon, TranslatePipe,
    ButtonComponent, IconButtonComponent, InputComponent, PillComponent, BottomSheetHandleComponent,
  ],
})
export class BoosterRoomDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<BoosterRoomDialogComponent, BoosterRoomSettings>);
  private readonly roomApi = inject(RoomApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly titleId = BOOSTER_DIALOG_TITLE_ID;
  readonly cardsPerBooster = CARDS_PER_BOOSTER;

  readonly sets = signal<BoosterSetDTO[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly query = signal('');
  readonly selectedSet = signal<BoosterSetDTO | null>(null);
  readonly boosterCount = signal(DEFAULT_BOOSTER_COUNT);
  readonly minMainDeckSize = signal(DEFAULT_MIN_MAIN_DECK);

  readonly filteredSets = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.sets();
    const matching = q
      ? all.filter(s => s.name.toLowerCase().includes(q) || (s.code ?? '').toLowerCase().includes(q))
      : all;
    return matching.slice(0, MAX_LISTED_SETS);
  });

  readonly hiddenSetCount = computed(() => {
    const q = this.query().trim().toLowerCase();
    const total = q
      ? this.sets().filter(s => s.name.toLowerCase().includes(q) || (s.code ?? '').toLowerCase().includes(q)).length
      : this.sets().length;
    return Math.max(0, total - MAX_LISTED_SETS);
  });

  readonly totalCards = computed(() => this.boosterCount() * CARDS_PER_BOOSTER);
  /** The minimum Main Deck can't exceed what the boosters hold. */
  readonly mainDeckCeiling = computed(() => Math.min(MAIN_DECK_MAX, this.totalCards()));

  readonly canConfirm = computed(() =>
    this.selectedSet() !== null && this.minMainDeckSize() <= this.mainDeckCeiling());

  ngOnInit(): void {
    this.roomApi.getBoosterSets().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: sets => {
        this.sets.set(sets);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set(true);
        this.loading.set(false);
      },
    });
  }

  selectSet(set: BoosterSetDTO): void {
    this.selectedSet.set(set);
  }

  stepBoosters(delta: number): void {
    const next = clamp(this.boosterCount() + delta, BOOSTER_COUNT_MIN, BOOSTER_COUNT_MAX);
    this.boosterCount.set(next);
    // Keep the minimum reachable when fewer boosters are opened.
    if (this.minMainDeckSize() > this.mainDeckCeiling()) {
      this.minMainDeckSize.set(this.mainDeckCeiling());
    }
  }

  stepMinMainDeck(delta: number): void {
    this.minMainDeckSize.set(clamp(this.minMainDeckSize() + delta, MAIN_DECK_MIN_FLOOR, this.mainDeckCeiling()));
  }

  readonly boosterCountMin = BOOSTER_COUNT_MIN;
  readonly boosterCountMax = BOOSTER_COUNT_MAX;
  readonly mainDeckMinFloor = MAIN_DECK_MIN_FLOOR;

  cancel(): void {
    this.dialogRef.close();
  }

  confirm(): void {
    const set = this.selectedSet();
    if (!set || !this.canConfirm()) return;
    this.dialogRef.close({
      boosterSetName: set.name,
      boosterCount: this.boosterCount(),
      minMainDeckSize: this.minMainDeckSize(),
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
