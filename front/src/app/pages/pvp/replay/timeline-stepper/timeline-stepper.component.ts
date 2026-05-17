import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import type { TurnMeta } from '../../replay-ws.types';

// Mobile-only stepper that replaces the desktop timeline-bar under `.is-narrow`
// (D3 / D5 / spec §F2). Layout:
//
//   [◀]  [ grid_view  •••••••  ▼ ]  [▶]
//
// The center pill opens the turn picker (output `openPicker`). The chevrons
// bind to `prevTurn` / `nextTurn`. The integrated 7-dot progress communicates
// position-in-turn — the previous standalone sub-events row was visually
// redundant with the pill dots (dropped 2026-05-16). The T-number/total text
// was also dropped from the pill (Axel 2026-05-16) — the transport-bar
// context-pill already announces the turn directly below, so the stepper pill
// is now an affordance-only button (icon + dots + chevron) for picker opening.
// Sub-event-level navigation stays available via the turn picker bottom-sheet.
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
  imports: [TranslateModule, MatIconModule],
  templateUrl: './timeline-stepper.component.html',
  styleUrl: './timeline-stepper.component.scss',
})
export class TimelineStepperComponent {
  readonly turns = input.required<readonly TurnMeta[]>();
  readonly currentTurnIndex = input.required<number>();
  readonly currentEventIndex = input.required<number>();
  readonly computedUpToIndex = input.required<number>();

  readonly prevTurn = output<void>();
  readonly nextTurn = output<void>();
  readonly openPicker = output<void>();

  protected readonly currentTurn = computed<TurnMeta | null>(() => this.turns()[this.currentTurnIndex()] ?? null);

  protected readonly canStepPrev = computed(() => this.currentTurnIndex() > 0);
  protected readonly canStepNext = computed(() => {
    const next = this.currentTurnIndex() + 1;
    const t = this.turns()[next];
    if (!t) return false;
    return t.startIndex <= this.computedUpToIndex();
  });

  // 7-dot progress bar — fills left-to-right as the user advances inside the
  // current turn. Each dot covers `eventCount / 7` events; a dot is "filled"
  // once `currentEventIndex` has crossed its threshold. Hidden under 480px via
  // CSS (decorative — `aria-hidden` on the wrapper).
  protected readonly dotState = computed<readonly boolean[]>(() => {
    const t = this.currentTurn();
    const empty = [false, false, false, false, false, false, false];
    if (!t || t.eventCount <= 0) return empty;
    const offset = this.currentEventIndex() - t.startIndex;
    if (offset < 0) return empty;
    // Progress in [0, 1] — clamp so the last dot stays lit at the turn boundary.
    const progress = Math.min(1, offset / t.eventCount);
    // Number of dots fully filled, in [0, 7]. We compare to (i + 0.5)/7 so a
    // dot lights up around its midpoint rather than only at its right edge.
    return Array.from({ length: 7 }, (_, i) => progress >= (i + 0.5) / 7);
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
}
