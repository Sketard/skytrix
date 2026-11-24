/* eslint-disable skytrix-pipeline/pipeline-signal-tagged --
   why: local UI state of a pre-duel screen (booster opening, deck building,
   room settings). None of these signals feeds the duel animation pipeline the
   rule guards; the duel starts only after this screen is gone. */

import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIcon } from '@angular/material/icon';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { concatMap, from, finalize } from 'rxjs';
import { ButtonComponent } from '../../../components/button/button.component';
import { CardComponent } from '../../../components/card/card.component';
import { CardInspectorComponent } from '../../../components/card-inspector/card-inspector.component';
import { IconButtonComponent } from '../../../components/icon-button/icon-button.component';
import { PillComponent } from '../../../components/pill/pill.component';
import { CardDetail } from '../../../core/model/card-detail';
import {
  SharedCardData, SharedCardInspectorData, toSharedCardData, toSharedCardInspectorData,
} from '../../../core/model/shared-card-data';
import { NotificationService } from '../../../core/services/notification.service';
import { RoomApiService } from '../room-api.service';
import { RoomDTO } from '../room.types';
import { BoosterDeckDTO, BoosterStateDTO, PulledCardDTO } from './booster.types';
import {
  DeckLimits, PoolEntry, addCopy, buildPool, deckFromPulls, deckProblem, fillDeck, removeCopy, zoneOf,
} from './booster-deck.utils';

/** Stages of one booster opening. */
export type RevealStage = 'idle' | 'tearing' | 'dealing' | 'revealed';

/** Pack tear, then the 5 cards land face down, then flip one by one. */
export const TEAR_MS = 650;
export const FIRST_FLIP_DELAY_MS = 450;
export const FLIP_STAGGER_MS = 380;

interface RevealedCard {
  readonly pull: PulledCardDTO;
  readonly shared: SharedCardData;
  readonly extra: boolean;
}

/**
 * Booster room, before the duel: the player opens their boosters one by one
 * (pack tear + cards flipped in turn), then builds a deck from the cards they
 * pulled and marks themselves ready. Ready / unready return the room DTO,
 * re-emitted through `roomUpdated` so the waiting room shows both flags.
 */
@Component({
  selector: 'app-booster-draft',
  templateUrl: './booster-draft.component.html',
  styleUrl: './booster-draft.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIcon, NgTemplateOutlet, TranslatePipe,
    ButtonComponent, CardComponent, CardInspectorComponent, IconButtonComponent, PillComponent,
  ],
})
export class BoosterDraftComponent implements OnInit {
  private readonly roomApi = inject(RoomApiService);
  private readonly notify = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly roomCode = input.required<string>();
  /** The duel is being created — no more edits. */
  readonly locked = input(false);
  readonly roomUpdated = output<RoomDTO>();

  readonly state = signal<BoosterStateDTO | null>(null);
  readonly loadError = signal(false);
  readonly view = signal<'open' | 'build'>('open');

  // --- Opening ---
  readonly opening = signal(false);
  readonly openingAll = signal(false);
  readonly revealStage = signal<RevealStage>('idle');
  readonly revealed = signal<RevealedCard[]>([]);
  /** Cards of the current booster turned face up so far. */
  readonly flippedCount = signal(0);

  // --- Building ---
  readonly deck = signal<BoosterDeckDTO>({ main: [], extra: [] });
  readonly submitting = signal(false);
  readonly inspected = signal<SharedCardInspectorData | null>(null);
  /** Pool card shown in the inspector (null for a card of the booster being revealed). */
  readonly inspectedCardId = signal<number | null>(null);
  /** Live entry of the inspected card — its deck count follows +/- and right clicks. */
  readonly inspectedEntry = computed(() => {
    const id = this.inspectedCardId();
    return id === null ? null : this.pool().find(e => e.cardId === id) ?? null;
  });

  readonly openedBoosters = computed(() => this.state()?.openedBoosters ?? 0);
  readonly boosterCount = computed(() => this.state()?.boosterCount ?? 0);
  readonly remainingBoosters = computed(() => this.boosterCount() - this.openedBoosters());
  readonly allOpened = computed(() => !!this.state() && this.remainingBoosters() <= 0);
  readonly ready = computed(() => this.state()?.ready ?? false);
  readonly busy = computed(() => this.opening() || this.openingAll());
  readonly packCode = computed(() => {
    const name = this.state()?.setName ?? '';
    return name.split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0]).join('').toUpperCase();
  });

  readonly limits = computed<DeckLimits>(() => {
    const s = this.state();
    return { minMain: s?.minMainDeckSize ?? 0, maxMain: s?.maxMainDeckSize ?? 60, maxExtra: s?.maxExtraDeckSize ?? 15 };
  });

  readonly pool = computed<PoolEntry[]>(() => {
    const d = this.deck();
    return buildPool(this.state()?.cards ?? [], new Set([...d.main, ...d.extra]));
  });
  readonly mainPool = computed(() => this.pool().filter(e => e.zone === 'MAIN'));
  readonly extraPool = computed(() => this.pool().filter(e => e.zone === 'EXTRA'));
  readonly mainEntries = computed(() => this.mainPool().filter(e => e.inDeck > 0));
  readonly extraEntries = computed(() => this.extraPool().filter(e => e.inDeck > 0));
  readonly problem = computed(() => deckProblem(this.deck(), this.limits()));

  private readonly sharedCache = new Map<number, SharedCardData>();
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly reducedMotion =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimers());
  }

  ngOnInit(): void {
    this.roomApi.getBoosterState(this.roomCode()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: state => {
        this.state.set(state);
        this.deck.set(deckFromPulls(state.cards));
        if (state.openedBoosters >= state.boosterCount) this.view.set('build');
      },
      error: () => this.loadError.set(true),
    });
  }

  // ---------------------------------------------------------------------------
  // Opening
  // ---------------------------------------------------------------------------

  openNext(): void {
    if (this.busy() || this.allOpened() || this.locked()) return;
    this.opening.set(true);
    this.roomApi.openBooster(this.roomCode()).pipe(
      finalize(() => this.opening.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: cards => {
        this.appendPulls(cards);
        this.playReveal(cards);
      },
      error: (err: HttpErrorResponse) => this.notify.error(err.status === 422 ? err : 'error.BOOSTER_OPEN_FAILED'),
    });
  }

  /** Opens every remaining booster at once, without the animation. */
  openAll(): void {
    if (this.busy() || this.allOpened() || this.locked()) return;
    this.skipReveal();
    this.openingAll.set(true);
    const remaining = Array.from({ length: this.remainingBoosters() });
    from(remaining).pipe(
      concatMap(() => this.roomApi.openBooster(this.roomCode())),
      finalize(() => this.openingAll.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: cards => this.appendPulls(cards),
      error: (err: HttpErrorResponse) => this.notify.error(err.status === 422 ? err : 'error.BOOSTER_OPEN_FAILED'),
      complete: () => this.goToBuild(),
    });
  }

  /** Click on the dealt cards: turn them all face up at once. */
  skipReveal(): void {
    if (this.revealStage() === 'idle') return;
    this.clearTimers();
    this.flippedCount.set(this.revealed().length);
    this.revealStage.set('revealed');
  }

  goToBuild(): void {
    this.skipReveal();
    this.view.set('build');
  }

  backToOpening(): void {
    this.view.set('open');
  }

  private appendPulls(cards: PulledCardDTO[]): void {
    this.state.update(s => s && {
      ...s,
      openedBoosters: s.openedBoosters + 1,
      cards: [...s.cards, ...cards],
    });
  }

  private playReveal(cards: PulledCardDTO[]): void {
    this.clearTimers();
    this.revealed.set(cards.map(pull => ({ pull, shared: this.shared(pull), extra: zoneOf(pull) === 'EXTRA' })));
    this.flippedCount.set(0);
    if (this.reducedMotion) {
      this.flippedCount.set(cards.length);
      this.revealStage.set('revealed');
      return;
    }
    this.revealStage.set('tearing');
    this.later(TEAR_MS, () => this.revealStage.set('dealing'));
    cards.forEach((_, i) => {
      this.later(TEAR_MS + FIRST_FLIP_DELAY_MS + i * FLIP_STAGGER_MS, () => {
        this.flippedCount.set(i + 1);
        if (i === cards.length - 1) this.revealStage.set('revealed');
      });
    });
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private clearTimers(): void {
    this.timers.forEach(t => clearTimeout(t));
    this.timers.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------

  add(entry: PoolEntry): void {
    if (this.ready() || this.locked()) return;
    this.deck.set(addCopy(this.deck(), entry, this.limits()));
  }

  remove(entry: PoolEntry): void {
    if (this.ready() || this.locked()) return;
    this.deck.set(removeCopy(this.deck(), entry));
  }

  addEverything(): void {
    if (this.ready() || this.locked()) return;
    this.deck.set(fillDeck(this.pool(), this.limits()));
  }

  clearDeck(): void {
    if (this.ready() || this.locked()) return;
    this.deck.set({ main: [], extra: [] });
  }

  markReady(): void {
    if (this.ready() || this.submitting() || this.problem() || this.locked()) return;
    this.submitting.set(true);
    this.roomApi.submitBoosterDeck(this.roomCode(), this.deck()).pipe(
      finalize(() => this.submitting.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: room => {
        this.state.update(s => s && { ...s, ready: true });
        this.roomUpdated.emit(room);
      },
      error: (err: HttpErrorResponse) => this.notify.error(err.status === 422 ? err : 'error.BOOSTER_DECK_FAILED'),
    });
  }

  editDeck(): void {
    if (!this.ready() || this.submitting() || this.locked()) return;
    this.submitting.set(true);
    this.roomApi.unreadyBooster(this.roomCode()).pipe(
      finalize(() => this.submitting.set(false)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: room => {
        this.state.update(s => s && { ...s, ready: false });
        this.roomUpdated.emit(room);
      },
      error: () => this.notify.error('error.UNKNOWN'),
    });
  }

  // ---------------------------------------------------------------------------
  // Card display
  // ---------------------------------------------------------------------------

  sharedOf(entry: PoolEntry): SharedCardData {
    let shared = this.sharedCache.get(entry.cardId);
    if (!shared) {
      shared = toSharedCardData(entry.detail);
      this.sharedCache.set(entry.cardId, shared);
    }
    return shared;
  }

  /** Left click (as in the deck builder): show the card details, with a
   *  +/- deck control in the inspector. */
  inspectEntry(entry: PoolEntry): void {
    this.inspectedCardId.set(entry.cardId);
    this.inspected.set(toSharedCardInspectorData(entry.detail));
  }

  /** Right click on a pulled card (as in the deck builder): add one copy. */
  addFromContextMenu(event: MouseEvent, entry: PoolEntry): void {
    event.preventDefault();
    this.add(entry);
  }

  /** Right click on a deck card (as in the deck builder): remove one copy. */
  removeFromContextMenu(event: MouseEvent, entry: PoolEntry): void {
    event.preventDefault();
    this.remove(entry);
  }

  inspectPull(pull: PulledCardDTO): void {
    this.inspectedCardId.set(null);
    this.inspected.set(toSharedCardInspectorData(new CardDetail(pull.card)));
  }

  closeInspector(): void {
    this.inspected.set(null);
    this.inspectedCardId.set(null);
  }

  private shared(pull: PulledCardDTO): SharedCardData {
    return toSharedCardData(new CardDetail(pull.card));
  }
}
