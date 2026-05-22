// =============================================================================
// effect-bubble.component.ts — Surface 2 of the Game Log feature.
// -----------------------------------------------------------------------------
// An ephemeral notification anchored under the opponent's duelist card, showing
// the effect the opponent just activated. It reads `DuelGameLogService.
// lastOpponentActivation` — the raw `MSG_CHAINING`-derived feed, NOT a
// `GameLogEntry` (analysis §3.5 — the bubble is a notification, not a journal).
//
// Anchoring (analysis §3.2 — approach B2, the `983b9865` chain-hover precedent):
// a CDK overlay connected to the opponent `<app-pvp-player-card>` element. The
// CDK overlay container sits above the inline `pvp-chain-overlay` by
// construction — no z-index arithmetic. Fallback positions expand toward the
// screen corner, never toward the board centre (guard-rail G2).
//
// The bubble body is a `TemplatePortal` defined in this component's own
// template — so the overlay content lives in this component's change-detection
// tree (a `ComponentPortal` would need a separate CD pass).
//
// Timing (analysis §3.4 / chantier §4.1 state table): hold for
// `EFFECT_BUBBLE_MS` (speed-scaled) then fade. "Last-wins" — a new activation
// replaces content + restarts the hold, no exit anim. An anti-flicker floor
// (`EFFECT_BUBBLE_MIN_VISIBLE_MS`) coalesces a rapid burst.
// =============================================================================

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  ViewChild,
  ViewContainerRef,
  type TemplateRef,
} from '@angular/core';
import { Overlay, OverlayRef, type ConnectedPosition } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { MatIcon } from '@angular/material/icon';
import { DuelContext } from '../duel-context';
import { DuelGameLogService, type OpponentActivation } from '../duel-game-log.service';
import {
  EFFECT_BUBBLE_FADE_MS,
  EFFECT_BUBBLE_FADE_MIN_MS,
  EFFECT_BUBBLE_MIN_MS,
  EFFECT_BUBBLE_MIN_VISIBLE_MS,
  EFFECT_BUBBLE_MS,
} from '../animation-constants';

/** The opponent duelist-card host element — the CDK overlay's anchor (§3.2). */
const OPPONENT_CARD_SELECTOR = 'app-pvp-player-card.host--opponent';

/**
 * Surface 2 — the opponent effect bubble. Mounted (zero on-page DOM) in the
 * duel-page and replay-page templates; the bubble itself renders inside a CDK
 * overlay anchored on the opponent duelist card.
 */
@Component({
  selector: 'app-effect-bubble',
  templateUrl: './effect-bubble.component.html',
  styleUrl: './effect-bubble.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon],
})
export class EffectBubbleComponent {
  private readonly gameLog = inject(DuelGameLogService);
  private readonly ctx = inject(DuelContext);
  private readonly overlay = inject(Overlay);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  /** The bubble body — projected into the CDK overlay via a `TemplatePortal`. */
  @ViewChild('bubbleTpl', { static: true })
  private bubbleTpl!: TemplateRef<unknown>;

  /** The content currently rendered in the bubble — null = hidden. Read by the
   *  template; a signal so the overlay view updates on `OnPush`. */
  readonly content = signal<OpponentActivation | null>(null);
  /** Drives the enter/exit transition — read by the template host binding. */
  readonly leaving = signal(false);

  private overlayRef: OverlayRef | null = null;
  private portal: TemplatePortal | null = null;

  /** Hold timer — fires the fade-out once the display window elapses. */
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fade-out timer — tears down the overlay once the exit anim completes. */
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Anti-flicker floor (analysis §3.4 / R6): true while the currently-shown
   * content is still inside its minimum-display window — a newer activation
   * arriving now is parked rather than swapped in immediately. The flag is set
   * when content shows and cleared by `floorTimer` after
   * `EFFECT_BUBBLE_MIN_VISIBLE_MS`.
   */
  private floorActive = false;
  /** The latest activation waiting for the anti-flicker floor to elapse. */
  private pendingContent: OpponentActivation | null = null;
  /** Timer that lifts the floor (and swaps `pendingContent` in if any). */
  private floorTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Above the corner: positions expand the bubble down-and-outward from the
   * opponent card, never toward the board centre (guard-rail G2). The opponent
   * card sits top-right, so the bubble grows down + left of the card; the
   * fallback flips it below-right when there is no room to the left.
   */
  private static readonly POSITIONS: ConnectedPosition[] = [
    { originX: 'end',   originY: 'bottom', overlayX: 'end',   overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end',   originY: 'top',    overlayX: 'end',   overlayY: 'bottom', offsetY: -8 },
  ];

  constructor() {
    // The service owns the feed. A change either shows a new activation or —
    // when it goes null (reset / seek) — dismisses the bubble immediately.
    // ONLY `lastOpponentActivation` is a tracked dependency: the handler body
    // reads/writes `content` + `leaving`, so it runs `untracked` — otherwise
    // `show()`'s own `content.set()` would re-trigger this effect in a loop.
    effect(() => {
      const activation = this.gameLog.lastOpponentActivation();
      untracked(() => {
        if (activation) this.onActivation(activation);
        else this.dismissNow();
      });
    });
    this.destroyRef.onDestroy(() => {
      this.clearTimers();
      this.overlayRef?.dispose();
      this.overlayRef = null;
    });
  }

  // ---------------------------------------------------------------------------
  // Feed handling — last-wins + anti-flicker floor
  // ---------------------------------------------------------------------------

  private onActivation(activation: OpponentActivation): void {
    // Mid-fade or fresh: show immediately, the floor starts now.
    if (this.content() === null || this.leaving()) {
      this.show(activation);
      return;
    }
    // A content is already visible. Honour the anti-flicker floor: while the
    // current content is still inside its minimum-display window, park the
    // newest activation — `floorTimer` swaps it in when the floor lifts.
    // Last-wins: each park overwrites the previous pending, so a 3-activation
    // burst yields "first link → last link", never a strobe.
    if (this.floorActive) {
      this.pendingContent = activation;
      return;
    }
    // Floor already elapsed — replace right away (last-wins, no exit anim).
    this.show(activation);
  }

  /** Lift the anti-flicker floor; swap in the parked activation, if any. */
  private liftFloor(): void {
    this.floorTimer = null;
    this.floorActive = false;
    const next = this.pendingContent;
    this.pendingContent = null;
    if (next) this.show(next);
  }

  /** Render `activation`, (re)start the hold timer, reset the flicker floor. */
  private show(activation: OpponentActivation): void {
    this.clearTimers();
    this.leaving.set(false);
    this.content.set(activation);
    this.ensureOverlay();

    // Re-arm the anti-flicker floor for this content.
    this.floorActive = true;
    this.floorTimer = setTimeout(
      () => this.liftFloor(),
      this.ctx.scaledDuration(EFFECT_BUBBLE_MIN_VISIBLE_MS, EFFECT_BUBBLE_MIN_VISIBLE_MS),
    );
    this.holdTimer = setTimeout(
      () => this.beginFadeOut(),
      this.ctx.scaledDuration(EFFECT_BUBBLE_MS, EFFECT_BUBBLE_MIN_MS),
    );
  }

  /** Hold elapsed — play the exit fade, then tear the overlay down. */
  private beginFadeOut(): void {
    this.holdTimer = null;
    if (this.content() === null) return;
    this.leaving.set(true);
    this.fadeTimer = setTimeout(
      () => this.dismissNow(),
      this.ctx.scaledDuration(EFFECT_BUBBLE_FADE_MS, EFFECT_BUBBLE_FADE_MIN_MS),
    );
  }

  /** Tear down immediately — no exit anim. Used on reset / seek / destroy. */
  private dismissNow(): void {
    this.clearTimers();
    this.content.set(null);
    this.leaving.set(false);
    this.pendingContent = null;
    this.floorActive = false;
    this.overlayRef?.detach();
  }

  // ---------------------------------------------------------------------------
  // CDK overlay plumbing
  // ---------------------------------------------------------------------------

  private ensureOverlay(): void {
    const anchor = document.querySelector<HTMLElement>(OPPONENT_CARD_SELECTOR);
    // No anchor yet (board not mounted) — skip silently; the next activation
    // re-attempts. The bubble is a best-effort notification.
    if (!anchor) return;

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(anchor)
      .withPositions(EffectBubbleComponent.POSITIONS)
      .withPush(true);

    if (this.overlayRef) {
      this.overlayRef.updatePositionStrategy(positionStrategy);
      if (!this.overlayRef.hasAttached()) this.attachPortal();
      return;
    }

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      // The wrapper is click-through (guard-rail G1) via the `.effect-bubble-pane`
      // panel class — the inner scrollable content box re-enables pointer-events.
      hasBackdrop: false,
      panelClass: 'effect-bubble-pane',
    });
    this.attachPortal();
  }

  private attachPortal(): void {
    if (!this.overlayRef) return;
    this.portal ??= new TemplatePortal(this.bubbleTpl, this.viewContainerRef);
    this.overlayRef.attach(this.portal);
  }

  // ---------------------------------------------------------------------------
  // Timers
  // ---------------------------------------------------------------------------

  private clearHoldTimers(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHoldTimers();
    if (this.floorTimer !== null) {
      clearTimeout(this.floorTimer);
      this.floorTimer = null;
    }
  }
}
