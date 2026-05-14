import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { TurnMeta } from '../../replay-ws.types';
import type { TimelineSegment } from '../timeline-bar/timeline-bar.component';

// Mobile-only stepper that replaces the desktop timeline-bar under `.is-narrow`
// (D3 / D5 / spec §F2). Layout:
//
//   [◀]  [ T3 / 11 tours ▼ + dots ]  [▶]
//   --- sub-event row of the current turn ---
//
// The center pill opens the turn picker (output `openPicker`). The chevrons
// bind to `prevTurn` / `nextTurn`. The sub-event row emits `seekSubEvent` with
// the event index when a sub-bullet is tapped.
//
// All visuals come from DS Wave 1 (`.icon-btn`, `.pill--gold`, `.text-eyebrow`)
// + component-scoped accents for the dot-progress (7 dots cached under 480px).
//
// The component is rendered unconditionally; the parent gates visibility via
// `:host-context(.is-narrow)` in SCSS — same approach as the lobby stepper.
@Component({
  selector: 'app-timeline-stepper',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  templateUrl: './timeline-stepper.component.html',
  styleUrl: './timeline-stepper.component.scss',
})
export class TimelineStepperComponent {
  readonly turns = input.required<readonly TurnMeta[]>();
  readonly currentTurnIndex = input.required<number>();
  readonly computedUpToIndex = input.required<number>();
  readonly subEvents = input<readonly TimelineSegment[]>([]);

  readonly prevTurn = output<void>();
  readonly nextTurn = output<void>();
  readonly openPicker = output<void>();
  readonly seekSubEvent = output<number>();

  protected readonly currentTurn = computed<TurnMeta | null>(() => this.turns()[this.currentTurnIndex()] ?? null);

  protected readonly totalTurns = computed(() => this.turns().length);

  protected readonly canStepPrev = computed(() => this.currentTurnIndex() > 0);
  protected readonly canStepNext = computed(() => {
    const next = this.currentTurnIndex() + 1;
    const t = this.turns()[next];
    if (!t) return false;
    return t.startIndex <= this.computedUpToIndex();
  });

  protected readonly turnLabel = computed(() => {
    const t = this.currentTurn();
    if (!t) return '';
    return t.turnNumber === 0 ? 'T0' : `T${t.turnNumber}`;
  });

  // 7-dot progress mirrors the spec mockup. Each dot represents an evenly-spaced
  // fraction of the current turn's events. Cached length = 7 (hidden under
  // 480px via CSS).
  protected readonly dotState = computed<readonly boolean[]>(() => {
    const t = this.currentTurn();
    if (!t || t.eventCount <= 0) return [false, false, false, false, false, false, false];
    // Always at least one dot active — the "current" position dot.
    const activeIdx = Math.min(6, Math.floor((6 * 1) / Math.max(1, this.subEvents().length)));
    return Array.from({ length: 7 }, (_, i) => i <= activeIdx);
  });

  protected onPrev(): void {
    if (this.canStepPrev()) this.prevTurn.emit();
  }
  protected onNext(): void {
    if (this.canStepNext()) this.nextTurn.emit();
  }
  protected onPickerOpen(): void {
    this.openPicker.emit();
  }
  protected onSubEventClick(seg: TimelineSegment): void {
    const idx = seg.type === 'single' ? seg.idx : seg.indices[0];
    this.seekSubEvent.emit(idx);
  }
}
