import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DeckBuildService } from '../../../services/deck-build.service';
import { ShortDeck } from '../../../core/model/short-deck';
import { DeckCardSkeletonComponent } from '../../../shared/skel';

export type DeckPickerContext = 'create' | 'join' | 'quickDuel';

interface DeckPickerDialogData {
  context: DeckPickerContext;
}

const TITLES: Record<DeckPickerContext, string> = {
  create: 'deckPicker.title.create',
  join: 'deckPicker.title.join',
  quickDuel: 'deckPicker.title.quickDuel',
};

const SUBTITLES: Record<DeckPickerContext, string> = {
  create: 'deckPicker.subtitle.create',
  join: 'deckPicker.subtitle.join',
  quickDuel: 'deckPicker.subtitle.quickDuel',
};

const TITLE_ICONS: Record<DeckPickerContext, string> = {
  create: 'style',
  join: 'style',
  quickDuel: 'bolt',
};

const CONFIRM_LABELS: Record<DeckPickerContext, string> = {
  create: 'deckPicker.confirm.create',
  join: 'deckPicker.confirm.join',
  quickDuel: 'deckPicker.confirm.quickDuel',
};

const TURN_TIME_MIN_SECS = 30;
const TURN_TIME_MAX_SECS = 3600;
const FETCH_ERROR_TIMEOUT_MS = 5000;
const CARD_BACK_FALLBACK = 'assets/images/card_back.jpg';

@Component({
  selector: 'app-deck-picker-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose,
    MatButton, MatIconButton, MatSlideToggle, MatIcon,
    RouterLink, FormsModule, TranslatePipe,
    DeckCardSkeletonComponent,
  ],
  templateUrl: './deck-picker-dialog.component.html',
  styleUrl: './deck-picker-dialog.component.scss',
})
export class DeckPickerDialogComponent implements OnInit {
  readonly dialogRef = inject(MatDialogRef<DeckPickerDialogComponent>);
  private readonly deckBuildService = inject(DeckBuildService);
  private readonly data: DeckPickerDialogData | null = inject(MAT_DIALOG_DATA, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  readonly context = computed<DeckPickerContext>(() => this.data?.context ?? 'create');
  readonly title = TITLES[this.data?.context ?? 'create'];
  readonly subtitle = SUBTITLES[this.data?.context ?? 'create'];
  readonly confirmLabel = CONFIRM_LABELS[this.data?.context ?? 'create'];

  readonly decks = signal<ShortDeck[]>([]);
  readonly loading = signal(true);
  readonly fetchError = signal(false);
  readonly selectedId = signal<number | null>(null);
  readonly selectedId2 = signal<number | null>(null);
  readonly activeSlot = signal<'p1' | 'p2'>('p1');
  readonly firstPlayer = signal<'p1' | 'p2'>('p1');
  readonly randomHand = signal(false);
  readonly turnTimeSecs = signal(300);
  readonly searchQuery = signal('');

  // Sandbox-only: P2 starts in "mirror" mode (uses P1's deck). The mirror
  // card collapses when the user explicitly opts into customizing P2, or
  // implicitly when a P2 deck is selected.
  readonly p2Customizing = signal(false);

  readonly isQuickDuel = computed(() => this.context() === 'quickDuel');
  readonly titleIcon = computed(() => TITLE_ICONS[this.context()]);

  readonly showP2Mirror = computed(() =>
    this.isQuickDuel()
      && this.activeSlot() === 'p2'
      && !this.p2Customizing()
      && this.selectedId2() === null,
  );

  // The deck grid is hidden while the sandbox is showing the mirror card
  // (P2 + no deck chosen yet) — clicking "Customise" reveals it.
  readonly showDeckGrid = computed(() => !this.showP2Mirror());

  // Search bar is always visible (cohérence cross-context, plan Phase 1.4).
  readonly showSearch = computed(() => this.showDeckGrid());

  readonly activeSelectedId = computed(() =>
    this.activeSlot() === 'p1' ? this.selectedId() : this.selectedId2(),
  );

  readonly filteredDecks = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return this.decks();
    return this.decks().filter(d => d.name.toLowerCase().includes(query));
  });

  // P1 deck is mandatory in every context. The confirm-btn is disabled until
  // one is selected — no other validation runs here (count + validity move
  // in Phase 1.9 when the back exposes mainDeckCount + isValid).
  readonly canConfirm = computed(() => this.selectedId() !== null);

  private fetchErrorTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearFetchErrorTimeout());
  }

  ngOnInit(): void {
    // Cache-first subscription — BehaviorSubject emits the current value
    // synchronously, then any subsequent refresh.
    this.deckBuildService.decks$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(decks => {
        this.decks.set(decks);
        if (decks.length > 0) {
          this.loading.set(false);
          this.fetchError.set(false);
          this.clearFetchErrorTimeout();
        }
      });

    this.loadDecks();
  }

  loadDecks(): void {
    this.fetchError.set(false);
    this.loading.set(this.decks().length === 0);
    this.deckBuildService.fetchDecks(true);

    this.clearFetchErrorTimeout();
    if (this.decks().length === 0) {
      this.fetchErrorTimeout = setTimeout(() => {
        if (this.decks().length === 0) {
          this.loading.set(false);
          this.fetchError.set(true);
        }
      }, FETCH_ERROR_TIMEOUT_MS);
    }
  }

  onSlotChange(slot: 'p1' | 'p2'): void {
    this.activeSlot.set(slot);
  }

  selectDeck(id: number): void {
    if (this.activeSlot() === 'p1') {
      this.selectedId.set(id);
    } else {
      this.selectedId2.set(id);
      this.p2Customizing.set(true);
    }
  }

  customizeP2(): void {
    this.p2Customizing.set(true);
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  onThumbError(event: Event): void {
    (event.target as HTMLImageElement).src = CARD_BACK_FALLBACK;
  }

  confirm(): void {
    const id = this.selectedId();
    if (id === null) return;

    if (this.isQuickDuel()) {
      const turnTime = Math.min(TURN_TIME_MAX_SECS, Math.max(TURN_TIME_MIN_SECS, this.turnTimeSecs()));
      this.dialogRef.close({
        decklistId1: id,
        decklistId2: this.selectedId2() ?? id,
        firstPlayer: this.firstPlayer() === 'p1' ? 1 : 2,
        skipShuffle: !this.randomHand(),
        turnTimeSecs: turnTime,
      });
      return;
    }

    const name = this.decks().find(d => d.id === id)?.name ?? '';
    this.dialogRef.close({ id, name });
  }

  private clearFetchErrorTimeout(): void {
    if (this.fetchErrorTimeout !== null) {
      clearTimeout(this.fetchErrorTimeout);
      this.fetchErrorTimeout = null;
    }
  }
}
