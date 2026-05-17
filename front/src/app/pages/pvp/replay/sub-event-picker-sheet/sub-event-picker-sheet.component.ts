import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, viewChildren } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { PvpBoardContainerComponent } from '../../duel-page/pvp-board-container/pvp-board-container.component';
import { EMPTY_ZONE_SET, EMPTY_STRING_SET } from '../../types';
import type { Player } from '../../duel-ws.types';
import type { ChainLinkState } from '../../types';
import type { PreComputedState, TurnMeta } from '../../replay-ws.types';

interface SubEventEntry {
  /** Absolute event index inside `boardStates` — passed back via (jumpToEvent). */
  eventIndex: number;
  /** Position within the turn (0-based) — used for the card num "E1", "E2", … */
  eventOrdinal: number;
  state: PreComputedState;
  isCurrent: boolean;
  isComputed: boolean;
}

// Level-2 picker (drill-down from `<app-turn-picker-sheet>`). Shows the
// sub-events of a single turn as a 3-col grid of real
// `<app-pvp-board-container [preview]="true">` cards (same component as the
// desktop hover popover — scaled down via CSS transform 800×600 → ~110×82 in
// 3-cols mobile). Each card shows the board state AFTER that sub-event, plus
// its label (MSG_MOVE, MSG_DAMAGE, …) in the footer. `content-visibility:
// auto` on each card lets the browser skip layout/paint for off-viewport
// cards (free perf budget).
//
// Tap on a sub-event card = seek to that event index + close both sheets
// (level 2 AND the parent turn-picker). The page owns this nested-pop
// orchestration; this component just emits `jumpToEvent`.
//
// Esc/X/backdrop = close level 2 only → re-open level 1 (turn picker) so the
// user can pick another turn. Same nested-pop pattern as C6.
@Component({
  selector: 'app-sub-event-picker-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MatIconModule, PvpBoardContainerComponent],
  templateUrl: './sub-event-picker-sheet.component.html',
  styleUrl: './sub-event-picker-sheet.component.scss',
})
export class SubEventPickerSheetComponent {
  /** The turn whose sub-events we're drilling into. */
  readonly turn = input.required<TurnMeta>();
  /** Full pre-computed state list (page owns this; we slice locally). */
  readonly boardStates = input.required<readonly PreComputedState[]>();
  /** Last index that has been pre-computed (states[idx] is available). */
  readonly computedUpToIndex = input.required<number>();
  /** Current scrubber position — used to highlight the matching card. */
  readonly currentEventIndex = input.required<number>();
  readonly perspectiveIndex = input<Player>(0);

  readonly jumpToEvent = output<number>();
  readonly closed = output<void>();

  // Empty sentinels passed to the preview board-container (see turn-picker
  // for the rationale — same inert values for the inputs the live board
  // would normally drive in animation / chain / highlight modes).
  protected readonly emptyZoneSet = EMPTY_ZONE_SET;
  protected readonly emptyStringSet = EMPTY_STRING_SET;
  protected readonly emptyChainLinks: ChainLinkState[] = [];

  private readonly cardEls = viewChildren<ElementRef<HTMLElement>>('subEventCard');
  private readonly injector = inject(Injector);

  protected readonly entries = computed<SubEventEntry[]>(() => {
    const t = this.turn();
    const states = this.boardStates();
    const upTo = this.computedUpToIndex();
    const current = this.currentEventIndex();
    const list: SubEventEntry[] = [];
    for (let idx = t.startIndex, ord = 0; idx <= t.endIndex; idx++, ord++) {
      const state = states[idx];
      if (!state) continue;
      list.push({
        eventIndex: idx,
        eventOrdinal: ord,
        state,
        isCurrent: idx === current,
        isComputed: idx <= upTo,
      });
    }
    return list;
  });

  constructor() {
    // Auto-scroll the current sub-event into view once, after first render.
    // 250ms timeout lets the parent bottom-sheet's slide-in animation settle
    // so the scroll lands on the final layout (same pattern as turn-picker).
    afterNextRender(() => {
      const idx = this.currentEventIndex();
      const card = this.cardEls().find(ref => Number(ref.nativeElement.dataset['eventIndex']) === idx);
      if (!card) return;
      setTimeout(() => card.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 250);
    }, { injector: this.injector });
  }

  protected onCardClick(entry: SubEventEntry): void {
    if (!entry.isComputed) return;
    this.jumpToEvent.emit(entry.eventIndex);
  }
}
