import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, viewChildren } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MiniBoardThumbnailComponent } from '../mini-board-thumbnail/mini-board-thumbnail.component';
import type { Player } from '../../duel-ws.types';
import type { PreComputedState, TurnMeta } from '../../replay-ws.types';

interface PickerEntry {
  /** Index inside the parent `turns` array — passed back via (jumpToTurn). */
  turnIndex: number;
  meta: TurnMeta;
  state: PreComputedState | null;
  isCurrent: boolean;
  isComputed: boolean;
}

// Turn picker bottom-sheet (D3 / D4). Renders a 3-column grid of cards, each
// holding a `<app-mini-board-thumbnail variant="picker">` plus a small footer
// (event count, duration TBD). Two sections — "Setup" (T0) and "Tours du duel"
// (T1..N) — match the spec D5 stepper layout.
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
  imports: [TranslateModule, MiniBoardThumbnailComponent],
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

  readonly jumpToTurn = output<number>();
  readonly closed = output<void>();

  private readonly cardEls = viewChildren<ElementRef<HTMLElement>>('turnCard');
  private readonly injector = inject(Injector);

  protected readonly entries = computed<PickerEntry[]>(() => {
    const turns = this.turns();
    const states = this.boardStates();
    const upTo = this.computedUpToIndex();
    const current = this.currentTurnIndex();
    return turns.map((meta, turnIndex) => ({
      turnIndex,
      meta,
      state: states[meta.startIndex] ?? null,
      isCurrent: turnIndex === current,
      isComputed: meta.startIndex <= upTo,
    }));
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
