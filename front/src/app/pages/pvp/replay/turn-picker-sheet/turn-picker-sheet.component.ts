import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, viewChildren } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { PvpBoardContainerComponent } from '../../duel-page/pvp-board-container/pvp-board-container.component';
import { EMPTY_ZONE_SET, EMPTY_STRING_SET } from '../../types';
import type { Player } from '../../duel-ws.types';
import type { ChainLinkState } from '../../types';
import type { PreComputedState, TurnMeta } from '../../replay-ws.types';

interface PickerEntry {
  /** Index inside the parent `turns` array — passed back via (jumpToTurn). */
  turnIndex: number;
  meta: TurnMeta;
  state: PreComputedState | null;
  isCurrent: boolean;
  isComputed: boolean;
  /** Turn player (0 / 1) for the chip color + initial; null for Setup (turn 0). */
  turnPlayer: Player | null;
  /** Initial shown in the chip — first letter of the turn player's pseudo. */
  playerInitial: string;
}

// Turn picker bottom-sheet (D3 / D4). Renders a 3-column grid of cards, each
// holding a real `<app-pvp-board-container [preview]="true">` (same component
// as the desktop hover popover — gives the user the same field layout as the
// live board, scaled down via CSS transform 800×600 → ~110×82 in 3-cols
// mobile). Two sections — "Setup" (T0) and "Tours du duel" (T1..N) — match
// the spec D5 stepper layout. `content-visibility: auto` on each card lets
// the browser skip layout/paint for off-viewport cards (free perf budget).
//
// Auto-scroll on the current card runs once after the first render (250ms
// delay to let the parent bottom-sheet's slide-in finish — spec §F2).
//
// The component does NOT own the bottom-sheet chrome; the page wraps it inside
// an `<app-replay-bottom-sheet>` instance.
@Component({
  selector: 'app-turn-picker-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MatIconModule, PvpBoardContainerComponent],
  templateUrl: './turn-picker-sheet.component.html',
  styleUrl: './turn-picker-sheet.component.scss',
})
export class TurnPickerSheetComponent {
  readonly turns = input.required<readonly TurnMeta[]>();
  readonly currentTurnIndex = input.required<number>();
  /** Last index that has been pre-computed (states[idx] is available). */
  readonly computedUpToIndex = input.required<number>();
  readonly boardStates = input.required<readonly PreComputedState[]>();
  readonly perspectiveIndex = input<Player>(0);
  /** Player usernames (absolute order, not perspective-relative). The header
   *  chip on each card derives its initial from these. */
  readonly playerUsernames = input<readonly [string, string]>(['', '']);

  readonly jumpToTurn = output<number>();
  readonly closed = output<void>();

  // Empty sentinels passed to the preview board-container. The container has
  // 22 required inputs; preview mode uses these inert values for the bits the
  // live board would normally drive (animations, chain, highlights). Same set
  // as `timeline-bar.component.ts` to keep the preview behavior consistent.
  protected readonly emptyZoneSet = EMPTY_ZONE_SET;
  protected readonly emptyStringSet = EMPTY_STRING_SET;
  protected readonly emptyChainLinks: ChainLinkState[] = [];

  private readonly cardEls = viewChildren<ElementRef<HTMLElement>>('turnCard');
  private readonly injector = inject(Injector);

  protected readonly entries = computed<PickerEntry[]>(() => {
    const turns = this.turns();
    const states = this.boardStates();
    const upTo = this.computedUpToIndex();
    const current = this.currentTurnIndex();
    const names = this.playerUsernames();
    return turns.map((meta, turnIndex) => {
      const state = states[meta.startIndex] ?? null;
      // Setup turn (turnNumber 0) has no real turn player — show a dash.
      const tp: Player | null = meta.turnNumber === 0
        ? null
        : (state?.boardState?.turnPlayer ?? null);
      const initial = tp == null
        ? '—'
        : (names[tp]?.trim()[0]?.toUpperCase() ?? '?');
      return {
        turnIndex,
        meta,
        state,
        isCurrent: turnIndex === current,
        isComputed: meta.startIndex <= upTo,
        turnPlayer: tp,
        playerInitial: initial,
      };
    });
  });

  protected readonly setupEntries = computed(() => this.entries().filter(e => e.meta.turnNumber === 0));
  protected readonly turnEntries = computed(() => this.entries().filter(e => e.meta.turnNumber > 0));

  constructor() {
    // Auto-scroll the current card into view once, on the first render after
    // the picker opens. 250ms timeout lets the parent bottom-sheet's slide-in
    // animation settle so the scroll lands on the final layout (spec §F2).
    // `afterNextRender` self-disarms after the first render — no signal-write
    // inside render phase, no per-CD overhead.
    afterNextRender(() => {
      const idx = this.currentTurnIndex();
      if (idx < 0) return;
      const card = this.cardEls().find(ref => Number(ref.nativeElement.dataset['turnIndex']) === idx);
      if (!card) return;
      setTimeout(() => card.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 250);
    }, { injector: this.injector });
  }

  protected onCardClick(entry: PickerEntry): void {
    if (!entry.isComputed) return;
    this.jumpToTurn.emit(entry.turnIndex);
  }
}
