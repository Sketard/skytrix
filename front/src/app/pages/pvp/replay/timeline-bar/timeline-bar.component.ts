import {
  afterRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, OnDestroy, output, signal, viewChild,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { MiniBoardThumbnailComponent } from '../mini-board-thumbnail/mini-board-thumbnail.component';
import type { TurnMeta } from '../../replay-ws.types';
import type { PreComputedState } from '../../replay-ws.types';
import type { Player } from '../../duel-ws.types';
import type { DuelState } from '../../types';
import { EMPTY_DUEL_STATE } from '../../types';
import { TIMELINE_BAR_TRANSITION_FALLBACK_MS } from '../../duel-page/animation-constants';

export type ZoomLevel = 1 | 2 | 3;

export type TimelineSegment =
  | { type: 'single'; idx: number }
  | { type: 'chain'; indices: number[] };

@Component({
  selector: 'app-timeline-bar',
  templateUrl: './timeline-bar.component.html',
  styleUrl: './timeline-bar.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, MiniBoardThumbnailComponent],
})
export class TimelineBarComponent implements OnDestroy {
  // Inputs
  readonly turns = input.required<TurnMeta[]>();
  readonly currentIndex = input.required<number>();
  readonly computedUpTo = input.required<number>();
  readonly totalEvents = input.required<number>();
  readonly boardStates = input.required<PreComputedState[]>();
  readonly ownPlayerIndex = input<Player>(0);
  /** Zoom state lifted to the page (D21) — 1× / 2× / 3×.
   *  Source of truth: `ReplayPageComponent.zoomLevel` signal, wired to both
   *  this input AND the `<app-timeline-zoom-control>` in the transport bar.
   *  `onWheel` emits `zoomLevelChange` instead of mutating the local signal. */
  readonly zoomLevel = input<ZoomLevel>(1);

  // Outputs
  readonly seekTo = output<number>();
  readonly scrubbing = output<number>();
  readonly zoomLevelChange = output<ZoomLevel>();

  // Hover preview state
  readonly hoveredIndex = signal<number | null>(null);
  readonly hoverX = signal<number>(0);
  readonly previewVisible = signal(false);
  private hoverDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Scrub state
  private isScrubbing = false;


  private readonly hostEl = inject(ElementRef<HTMLElement>);

  // Desktop detection (reactive via matchMedia listener)
  readonly isDesktop = signal(!window.matchMedia('(pointer: coarse)').matches);
  private readonly pointerMql = window.matchMedia('(pointer: coarse)');
  private readonly pointerMqlHandler = (e: MediaQueryListEvent) => this.isDesktop.set(!e.matches);

  // Zoom scroll anchor (rAF loop during CSS transition)
  private zoomRafId: number | null = null;

  // Active global listener cleanup
  private activeMouseCleanup: (() => void) | null = null;
  private activeTouchCleanup: (() => void) | null = null;
  private pendingHoverX = 0;
  private lastPreviewUpdateMs = 0;

  // Template refs
  readonly trackEl = viewChild<ElementRef<HTMLDivElement>>('track');
  readonly timelineBarEl = viewChild<ElementRef<HTMLDivElement>>('timelineBar');

  // Computed: max event count across all turns (for uniform bullet sizing)
  readonly maxEventCount = computed(() => {
    const t = this.turns();
    if (t.length === 0) return 1;
    return Math.max(1, ...t.map(turn => turn.eventCount));
  });

  /**
   * Position the playhead on the current bullet and auto-scroll.
   * Direct DOM write — avoids the signal-in-afterRender refresh issue.
   */
  private syncPlayhead(): void {
    const track = this.trackEl()?.nativeElement;
    if (!track) return;
    const bullet = track.querySelector('.sub-event.current') as HTMLElement | null;
    const playhead = track.querySelector('.playhead') as HTMLElement | null;
    if (!bullet || !playhead) return;

    const trackRect = track.getBoundingClientRect();
    const bulletRect = bullet.getBoundingClientRect();
    const left = bulletRect.left + bulletRect.width / 2 - trackRect.left;
    playhead.style.left = `${left}px`;

    // Auto-scroll so the playhead stays visible
    const container = this.timelineBarEl()?.nativeElement;
    if (container) {
      const bulletCenter = bulletRect.left + bulletRect.width / 2;
      const containerRect = container.getBoundingClientRect();
      const margin = containerRect.width * 0.15;
      if (bulletCenter > containerRect.right - margin) {
        container.scrollLeft += bulletCenter - (containerRect.right - margin);
      } else if (bulletCenter < containerRect.left + margin) {
        container.scrollLeft -= (containerRect.left + margin) - bulletCenter;
      }
    }
  }

  // Computed: current turn info for position label
  readonly currentTurnInfo = computed(() => {
    const idx = this.currentIndex();
    const states = this.boardStates();
    const state = states[idx];
    if (!state) return null;
    return {
      turnNumber: state.boardState.turnCount,
      phase: state.boardState.phase,
      turnPlayer: state.boardState.turnPlayer,
      label: state.label,
    };
  });

  // Computed: hovered state for preview
  readonly hoveredState = computed<DuelState>(() => {
    const idx = this.hoveredIndex();
    if (idx === null) return EMPTY_DUEL_STATE;
    const states = this.boardStates();
    return states[idx]?.boardState ?? EMPTY_DUEL_STATE;
  });

  readonly hoveredBeyondComputed = computed(() => {
    const idx = this.hoveredIndex();
    if (idx === null) return false;
    return idx > this.computedUpTo();
  });

  readonly hoveredTurnInfo = computed(() => {
    const idx = this.hoveredIndex();
    if (idx === null) return null;
    const t = this.turns();
    return t.find(turn => idx >= turn.startIndex && idx <= turn.endIndex) ?? null;
  });

  readonly hoveredLabel = computed(() => {
    const idx = this.hoveredIndex();
    if (idx === null) return null;
    return this.boardStates()[idx]?.label ?? null;
  });

  constructor() {
    this.pointerMql.addEventListener('change', this.pointerMqlHandler);
    afterRender(() => this.syncPlayhead());
  }

  ngOnDestroy(): void {
    this.pointerMql.removeEventListener('change', this.pointerMqlHandler);
    this.clearHoverDebounce();
    if (this.zoomRafId !== null) { cancelAnimationFrame(this.zoomRafId); this.zoomRafId = null; }
    this.previewVisible.set(false);
    this.hoveredIndex.set(null);
    this.activeMouseCleanup?.();
    this.activeTouchCleanup?.();
  }

  // --- Event handlers ---

  onTurnClick(turn: TurnMeta): void {
    if (turn.startIndex > this.computedUpTo()) return;
    this.seekTo.emit(turn.startIndex);
  }

  onSubEventClick(index: number, event: MouseEvent): void {
    event.stopPropagation();
    if (index > this.computedUpTo()) return;
    this.seekTo.emit(index);
  }

  onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    // Clean up any leaked previous scrub listeners before starting new ones
    this.activeMouseCleanup?.();
    this.isScrubbing = true;
    this.emitScrubIndex(event);
    const onMove = (e: MouseEvent) => this.emitScrubIndex(e);
    const onUp = (e: MouseEvent) => {
      this.isScrubbing = false;
      this.seekTo.emit(this.computeIndexFromX(e.clientX));
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this.activeMouseCleanup = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    this.activeMouseCleanup = cleanup;
  }

  onTouchStart(event: TouchEvent): void {
    // Clean up any leaked previous touch scrub listeners
    this.activeTouchCleanup?.();
    this.isScrubbing = true;
    this.emitScrubIndexTouch(event);
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      this.emitScrubIndexTouch(e);
    };
    const onEnd = (e: TouchEvent) => {
      this.isScrubbing = false;
      const touch = e.changedTouches[0];
      if (touch) this.seekTo.emit(this.computeIndexFromX(touch.clientX));
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      this.activeTouchCleanup = null;
    };
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    this.activeTouchCleanup = cleanup;
  }

  onWheel(event: WheelEvent): void {
    if (!this.isDesktop()) return;
    event.preventDefault();
    const prev = this.zoomLevel();
    let next: ZoomLevel = prev;
    if (event.deltaY < 0 && prev < 3) {
      next = (prev + 1) as ZoomLevel;
    } else if (event.deltaY > 0 && prev > 1) {
      next = (prev - 1) as ZoomLevel;
    }
    if (next === prev) return;
    // Emit to the page-owned signal (D21). The page will flip its zoomLevel
    // signal, which flows back through our input — the cursor-anchored rAF
    // loop below uses the current scrollWidth which already reflects the new
    // CSS scale because Angular's input update is synchronous with the emit.
    this.zoomLevelChange.emit(next);

    const container = this.timelineBarEl()?.nativeElement;
    if (!container) return;

    // Capture cursor position as ratio of content — this is our anchor point
    const cursorX = event.clientX - container.getBoundingClientRect().left;
    const cursorRatio = (container.scrollLeft + cursorX) / container.scrollWidth;

    // Cancel any previous zoom rAF loop
    if (this.zoomRafId !== null) cancelAnimationFrame(this.zoomRafId);

    // Continuously adjust scrollLeft during the CSS transition so the anchor holds
    const track = this.trackEl()?.nativeElement;
    const adjustScroll = () => {
      container.scrollLeft = cursorRatio * container.scrollWidth - cursorX;
      this.zoomRafId = requestAnimationFrame(adjustScroll);
    };
    this.zoomRafId = requestAnimationFrame(adjustScroll);

    // Stop after transition ends
    const onEnd = () => {
      if (this.zoomRafId !== null) { cancelAnimationFrame(this.zoomRafId); this.zoomRafId = null; }
      track?.removeEventListener('transitionend', onEnd);
    };
    track?.addEventListener('transitionend', onEnd, { once: true });

    // Safety: stop even if transitionend doesn't fire (matches longest CSS
    // transition declared on the bar element). See animation-constants.ts.
    setTimeout(onEnd, TIMELINE_BAR_TRANSITION_FALLBACK_MS);
  }

  onTurnMouseEnter(event: MouseEvent, turn: TurnMeta): void {
    if (!this.isDesktop() || this.isScrubbing) return;
    this.pendingHoverX = this.toHostRelativeX(event.clientX);
    this.clearHoverDebounce();
    const elapsed = Date.now() - this.lastPreviewUpdateMs;
    const delay = Math.max(100, 200 - elapsed);
    this.hoverDebounceTimer = setTimeout(() => {
      this.lastPreviewUpdateMs = Date.now();
      this.hoveredIndex.set(turn.startIndex);
      this.hoverX.set(this.pendingHoverX);
      this.previewVisible.set(true);
    }, delay);
  }

  onTurnMouseMove(event: MouseEvent): void {
    this.pendingHoverX = this.toHostRelativeX(event.clientX);
  }

  onSubEventMouseEnter(event: MouseEvent, index: number): void {
    if (!this.isDesktop() || this.isScrubbing) return;
    if (index > this.computedUpTo()) return;
    this.clearHoverDebounce();
    this.lastPreviewUpdateMs = Date.now();
    this.hoveredIndex.set(index);
    this.hoverX.set(this.toHostRelativeX(event.clientX));
    this.previewVisible.set(true);
  }

  onTurnMouseLeave(): void {
    this.clearHoverDebounce();
    this.previewVisible.set(false);
    this.hoveredIndex.set(null);
  }

  isComputed(turn: TurnMeta): boolean {
    return turn.startIndex <= this.computedUpTo();
  }

  isCurrentTurn(turn: TurnMeta): boolean {
    const idx = this.currentIndex();
    return idx >= turn.startIndex && idx <= turn.endIndex;
  }

  /**
   * Self-vs-opp colour for chain segments: true → `--self-*` (perspective
   * matches the turn player at chain start), false → `--opp-*`. Used by the
   * SCSS modifiers `.chain-group--self` / `--opp` (from `_chain-owner-palette`).
   *
   * Proxy: we read the `boardState.turnPlayer` from the FIRST event of the
   * chain. This is a reasonable approximation — most chains are initiated by
   * the turn player; opp counter-chains land on subsequent links of the same
   * segment but the visual stays grouped under the initiator. If proper
   * per-link ownership becomes needed, plumb `chainPlayer` through
   * `PreComputedState` (server-side change).
   */
  chainSegmentIsSelf(firstIndex: number): boolean {
    const state = this.boardStates()[firstIndex];
    if (!state) return true;
    return state.boardState.turnPlayer === this.ownPlayerIndex();
  }

  // Memoization for segments (avoids new array per CD cycle)
  private segmentCache = new Map<number, TimelineSegment[]>();

  subEventSegments(turn: TurnMeta): TimelineSegment[] {
    let cached = this.segmentCache.get(turn.startIndex);
    if (cached && this.segmentCacheCount.get(turn.startIndex) === turn.eventCount) return cached;

    const states = this.boardStates();
    const segments: TimelineSegment[] = [];
    let i = turn.startIndex;
    const end = turn.startIndex + turn.eventCount;

    // Labels that act as chain separators but should not render as bullets
    const HIDDEN_LABELS = new Set(['MSG_CHAIN_END']);

    while (i < end) {
      if (states[i]?.chainIndex != null) {
        const chainIndices: number[] = [];
        while (i < end && states[i]?.chainIndex != null) {
          chainIndices.push(i);
          i++;
        }
        segments.push({ type: 'chain', indices: chainIndices });
      } else if (HIDDEN_LABELS.has(states[i]?.label)) {
        i++; // skip — separator only, not a visible bullet
      } else {
        segments.push({ type: 'single', idx: i });
        i++;
      }
    }

    this.segmentCache.set(turn.startIndex, segments);
    this.segmentCacheCount.set(turn.startIndex, turn.eventCount);
    return segments;
  }

  private segmentCacheCount = new Map<number, number>();

  private toHostRelativeX(clientX: number): number {
    return clientX - this.hostEl.nativeElement.getBoundingClientRect().left;
  }

  private clearHoverDebounce(): void {
    if (this.hoverDebounceTimer) {
      clearTimeout(this.hoverDebounceTimer);
      this.hoverDebounceTimer = null;
    }
  }

  private emitScrubIndex(event: MouseEvent): void {
    const idx = this.computeIndexFromX(event.clientX);
    this.scrubbing.emit(idx);
  }

  private emitScrubIndexTouch(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    const idx = this.computeIndexFromX(touch.clientX);
    this.scrubbing.emit(idx);
  }

  private computeIndexFromX(clientX: number): number {
    const el = this.trackEl()?.nativeElement;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = this.turns();
    if (t.length === 0) return 0;
    const scaledPos = ratio * t.length;
    const turnIndex = Math.min(Math.floor(scaledPos), t.length - 1);
    const turn = t[turnIndex];
    const fraction = scaledPos - turnIndex;
    // Inverse of playhead: fraction = (eventInTurn + 0.5) / eventCount
    const eventInTurn = Math.round(fraction * turn.eventCount - 0.5);
    const idx = turn.startIndex + Math.max(0, Math.min(eventInTurn, turn.eventCount - 1));
    return Math.min(idx, this.computedUpTo());
  }
}
