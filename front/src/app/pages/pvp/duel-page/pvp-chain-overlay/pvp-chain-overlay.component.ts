import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type EffectRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
} from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { ChainLinkState } from '../../types';
import { DuelCardArtService } from '../duel-card-art.service';
import { ANIMATION_DATA_SOURCE } from '../animation-data-source';
import { AnimationOrchestratorService } from '../animation-orchestrator.service';
import { ChainResolutionManager } from '../chain-resolution-manager';
import { DuelLogCategory, DuelLogger } from '../duel-logger';

export interface VisibleCard {
  chainIndex: number;
  cardCode: number;
  cardName: string;
  position: 'front' | 'mid' | 'back';
}

export interface ExitingCardState {
  card: VisibleCard;
  type: 'overflow' | 'resolved';
  negated: boolean;
}

/**
 * Visual layer for chain animations. Reacts to signal changes driven by the orchestrator.
 *
 * ## Three effects drive all behavior:
 *
 * **Effect A (main chain logic)** — watches activeChainLinks + chainPhase.
 *   - building phase: new link added → onNewChainLink() (entry animation + overlay fade)
 *   - resolving phase: link removed → onChainLinkResolved() (hide → board replay → re-show → exit)
 *   - idle phase + 0 links → onChainEnd() (full cleanup)
 *   Also handles late commits: when a pending chain entry is committed at the same time
 *   as MSG_CHAIN_SOLVING, Angular batches both, so we see phase='resolving' + new link.
 *
 * **Effect B (resolving detection)** — watches activeChainLinks for a link with resolving=true.
 *   Sets resolvingIndex for the pulse glow CSS class and ensures overlay is visible.
 *
 * **Effect C (deferred entry)** — watches promptActive.
 *   When a cost prompt closes, plays the entry animation that was deferred during the prompt.
 *   Cards requiring cost payment must finish their prompt BEFORE appearing visually.
 *
 * ## Async contract with orchestrator
 *
 * During resolution, the overlay controls pacing:
 *   orchestrator sets chainOverlayReady=true (initial) → CHAIN_SOLVED pauses queue
 *   → overlay sets chainOverlayReady=false → hide overlay → replay board events
 *   → impact pause → re-show overlay → exit animation → cleanup
 *   → sets chainOverlayReady=true → orchestrator resumes
 *
 * ## chainEntryAnimating gate
 *
 * During building, SELECT_CHAIN prompts are blocked until the entry animation finishes
 * (via chainEntryAnimating signal). Force-cleared when resolution starts.
 *
 * ## Visible cards cascade
 *
 * Only the last 3 chain links are rendered (front/mid/back positions).
 * When a 4th+ card enters, the oldest visible card gets an overflow exit animation.
 * During resolution, cards cascade forward as the front card exits.
 */
@Component({
  selector: 'app-pvp-chain-overlay',
  templateUrl: './pvp-chain-overlay.component.html',
  styleUrl: './pvp-chain-overlay.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvpChainOverlayComponent {
  readonly promptActive = input(false);

  private readonly dataSource = inject(ANIMATION_DATA_SOURCE);
  private readonly orchestrator = inject(AnimationOrchestratorService);
  private readonly chainManager = inject(ChainResolutionManager);
  private readonly destroyRef = inject(DestroyRef);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly logger = inject(DuelLogger);
  private readonly artService = inject(DuelCardArtService);
  private readonly injector = inject(Injector);

  readonly activeChainLinks = this.dataSource.activeChainLinks;
  readonly phase = this.dataSource.chainPhase;

  /** Whether the overlay backdrop + cards are visible */
  readonly overlayVisible = signal(false);

  readonly exitingCard = signal<ExitingCardState | null>(null);

  /** chainIndex of the card currently playing entry animation */
  readonly enteringCardIndex = signal(-1);

  /** chainIndex of the front card being resolved (pulse glow) */
  readonly resolvingIndex = signal(-1);

  /** chainIndex of the front card being resolved as negated (grey shake) */
  readonly negatedResolvingIndex = signal(-1);

  /**
   * Internal flags as private signals — pattern aligned with the public state
   * exposed by the component (overlayVisible, resolvingIndex, etc.). Each flag
   * is read and written exclusively inside `untracked()` blocks (effects) or
   * synchronous handler methods, so signal-graph propagation is irrelevant —
   * the migration is a uniformity refactor, not a reactivity change.
   *
   * `entryTimerId` and `activeTimers` stay POJO: they are resource handles,
   * not state.
   */
  /** Burst-detection source of truth: non-null while a fade-out timer is
   *  pending. Reset to `null` by `cancelEntryTimer()` AND by the timer's
   *  own fire callback (`scheduleFadeOutAfterEntry`) so a fired-then-stale
   *  handle can't fool the burst gate in `onNewChainLink`. */
  private entryTimerId: ReturnType<typeof setTimeout> | null = null;
  private readonly _previousLinkCount = signal(0);
  /** Track whether we've already handled the first resolving phase entry */
  private readonly _resolutionStarted = signal(false);

  /** Store resolving card info before link removal */
  private readonly _resolvingCardInfo = signal<{ cardCode: number; cardName: string } | null>(null);
  private readonly _resolvingNegated = signal(false);
  /** Resolved card that stays visible at front until the next resolving link pushes it out.
   *  Signal so that visibleCards recomputes when it's set/cleared. */
  readonly pendingExitCard = signal<ExitingCardState | null>(null);
  /** Re-entrancy guard — true while onChainLinkResolved async flow is running */
  private readonly _resolvingInFlight = signal(false);
  /** True while the exit→pulse timeout in Effect B is pending (prevents duplicate pulse) */
  private readonly _exitPulseInFlight = signal(false);
  /** True once overlayVisible was set during building phase (chain had ≥2 links) */
  private readonly _overlayShownDuringBuild = signal(false);
  /** Dedup guard: track last resolving link announced to prevent duplicate liveAnnouncer/buffer calls */
  private readonly _lastAnnouncedResolvingIndex = signal(-1);
  private readonly _lastAnnouncedNegated = signal(false);

  private readonly activeTimers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * β.3 Lot 1b — pending effect that watches `overlayShowReady` to
   * fire the deferred show sequence (`_runOverlayShowSequence`) the
   * moment the DEP signals readiness for the current chain.
   * Cleared+re-installed on each new chain link so a burst of
   * MSG_CHAINING does not stack effects.
   */
  private _overlayShowEffectRef: EffectRef | null = null;

  /**
   * Aborts the in-flight `onChainLinkResolved` async chain on chain end /
   * destroy. Each `await waitForOrAbort` short-circuits when the signal
   * fires; the `finally` block resets `_resolvingInFlight` so no zombie
   * state survives a mid-resolution cancel.
   */
  private _resolutionAbort: AbortController | null = null;

  // --- Deferred entry animation (see Effect C) ---
  private readonly _hasPendingEntry = signal(false);
  private readonly _pendingPrevCount = signal(0);

  // --- Animation durations (scaled by speedMultiplier) ---
  readonly durations = computed(() => {
    const scale = (base: number) => Math.round(base * this.orchestrator.speedMultiplier());
    return {
      pulse: this.orchestrator.chainPulseDuration(),
      exit: this.orchestrator.chainExitDuration(),
      overlayFadeOut: Math.max(200, scale(300)),
      overlayFadeIn: Math.max(200, scale(300)),
      impactPause: Math.max(200, scale(300)),
      constructAppear: scale(800),
      constructFadeOut: scale(600),
      entry: scale(600),
      overflow: scale(600),
    };
  });

  /** Last 3 active chain links mapped to positions, with pendingExitCard held at front. */
  readonly visibleCards = computed<VisibleCard[]>(() => {
    const links = this.activeChainLinks();
    const pending = this.pendingExitCard();
    const positions: Array<'front' | 'mid' | 'back'> = ['front', 'mid', 'back'];
    const last3 = links.slice(-3);
    const cards = last3.reverse().map((link, i) => ({
      chainIndex: link.chainIndex,
      cardCode: link.cardCode,
      cardName: link.cardName,
      position: positions[i],
    }));

    // Resolved card stays at front until pushed out — shift others back
    if (pending) {
      cards.forEach(c => {
        const idx = positions.indexOf(c.position);
        c.position = positions[idx + 1] ?? 'back';
      });
      cards.unshift({ ...pending.card, position: 'front' });
      return cards.slice(0, 3);
    }

    return cards;
  });

  /** CSS variable values synced with JS durations for accelerated mode */
  readonly cssDurations = computed(() => {
    const d = this.durations();
    return {
      pulse: `${d.pulse}ms`,
      exit: `${d.exit}ms`,
      entry: `${d.entry}ms`,
      overflow: `${d.overflow}ms`,
      // Cascade cards (the chain links shifting forward to fill the slot a
      // resolved card vacated) wait this long before sliding — so the
      // exiting card has visibly faded BEFORE the next card arrives at
      // front, instead of the two animations overlapping ("the resolved
      // card gets shoved" symptom). 55% of the exit duration leaves the
      // shift finishing just after the fade completes.
      cascadeDelay: `${Math.round(d.exit * 0.55)}ms`,
    };
  });

  /** Card image URL helper for template */
  getCardImageUrl(cardCode: number): string {
    return this.artService.resolveUrl(cardCode);
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this._resolutionAbort?.abort();
      this.activeTimers.forEach(id => clearTimeout(id));
      this.activeTimers.clear();
      // β.3 Lot 1b — tear down the pending overlay-show effect on
      // component destroy. The injector's DestroyRef would propagate
      // anyway, but explicit destroy keeps the lifecycle obvious.
      this._overlayShowEffectRef?.destroy();
      this._overlayShowEffectRef = null;
    });

    // Effect A — main chain logic + building announcements
    effect(() => {
      const links = this.activeChainLinks();
      const phase = this.phase();

      untracked(() => {
        const currentCount = links.length;
        const prevCount = this._previousLinkCount();
        this._previousLinkCount.set(currentCount);

        if (phase === 'idle') {
          if (currentCount === 0) this.onChainEnd();
          return;
        }

        if (phase === 'building') {
          if (currentCount > prevCount && currentCount > 0) {
            // Defer entry animation while cost prompt is open (see Effect C for replay)
            if (this.promptActive()) {
              this._hasPendingEntry.set(true);
              this._pendingPrevCount.set(prevCount);
            } else {
              this.onNewChainLink(prevCount, links);
            }
            const newest = links[currentCount - 1];
            this.liveAnnouncer.announce(`Chain Link ${newest.chainIndex + 1}: ${newest.cardName} added`);
          }
          return;
        }

        // phase === 'resolving'
        // Late commit: pending chain entry was committed at the same time as MSG_CHAIN_SOLVING
        // (Angular batches both signal updates, so we see phase='resolving' + new link in one pass)
        if (currentCount > prevCount && currentCount > 0) {
          this.onNewChainLink(prevCount, links);
        }

        if (!this._resolutionStarted()) {
          this._resolutionStarted.set(true);
          // Cancel any pending building-phase fade-out to avoid race with resolution overlay
          this.cancelEntryTimer();
          // Force clear entry animation gate — resolution takes over
          this.chainManager.chainEntryAnimating.set(false);
        }

        if (currentCount < prevCount && prevCount > 0) {
          this.logger.log(DuelLogCategory.CHAIN, 'Effect A: link removed %d→%d — calling onChainLinkResolved', prevCount, currentCount);
          this.onChainLinkResolved();
        }
      });
    });

    // Effect B — resolving detection (pending exit → pulse glow + overlay visibility)
    // When a new resolving link appears AND a pendingExitCard exists from the previous
    // resolution, the exit animation plays first, then the pulse starts after exitDuration.
    // The orchestrator's MSG_CHAIN_SOLVING return value accounts for this extra time.
    effect(() => {
      const links = this.activeChainLinks();
      const phase = this.phase();

      untracked(() => {
        if (phase !== 'resolving' || links.length === 0) {
          this.resolvingIndex.set(-1);
          this.negatedResolvingIndex.set(-1);
          return;
        }

        const resolvingLink = links.find(l => l.resolving);
        this.logger.log(DuelLogCategory.CHAIN, 'Effect-B phase=resolving links=%d resolvingLink=%o allLinks=%o',
          links.length,
          resolvingLink ? { idx: resolvingLink.chainIndex, negated: resolvingLink.negated, name: resolvingLink.cardName } : null,
          links.map(l => ({ idx: l.chainIndex, negated: l.negated, resolving: l.resolving })));
        if (resolvingLink) {
          this._resolvingCardInfo.set({ cardCode: resolvingLink.cardCode, cardName: resolvingLink.cardName });
          this._resolvingNegated.set(resolvingLink.negated);

          // Show overlay during resolving phase so animation is visible —
          // skip only for chain-1 (overlay was never shown during building)
          if (this._overlayShownDuringBuild()) this.overlayVisible.set(true);

          // Previous resolved card still on screen → push it out, then pulse
          if (this.pendingExitCard()) {
            this.exitingCard.set(this.pendingExitCard());
            this.pendingExitCard.set(null);
            this._exitPulseInFlight.set(true);
            this.scheduleTimeout(() => {
              this._exitPulseInFlight.set(false);
              this.exitingCard.set(null);
              this.applyResolvingPulse(resolvingLink.chainIndex, resolvingLink.negated);
            }, this.durations().exit);
          } else if (!this._exitPulseInFlight()) {
            this.applyResolvingPulse(resolvingLink.chainIndex, resolvingLink.negated);
          }

          // Dedup: announce only for a new link, or when negation state changes (resolving→negated)
          const isNewLink = resolvingLink.chainIndex !== this._lastAnnouncedResolvingIndex();
          const isNegationUpdate = resolvingLink.chainIndex === this._lastAnnouncedResolvingIndex()
            && resolvingLink.negated && !this._lastAnnouncedNegated();
          if (isNewLink || isNegationUpdate) {
            this._lastAnnouncedResolvingIndex.set(resolvingLink.chainIndex);
            this._lastAnnouncedNegated.set(resolvingLink.negated);
            const announcement = resolvingLink.negated
              ? `Chain Link ${resolvingLink.chainIndex + 1} negated: ${resolvingLink.cardName}`
              : `Chain Link ${resolvingLink.chainIndex + 1} resolving: ${resolvingLink.cardName}`;
            this.liveAnnouncer.announce(announcement);
          }
        }
      });
    });

    // Effect D — Hide overlay during "Chain Resolution" banner
    effect(() => {
      const announcing = this.chainManager.chainResolutionAnnounce();
      untracked(() => {
        if (announcing) {
          this.cancelEntryTimer();
          this.overlayVisible.set(false);
        }
      });
    });

    // Effect C — Play pending entry animation when prompt closes
    // Phase may have advanced to 'resolving' (e.g. MSG_CHAIN_SOLVING arrives in same tick
    // as SELECT_CHAIN response), so only gate on 'idle' (chain already ended).
    effect(() => {
      const isPromptActive = this.promptActive();

      untracked(() => {
        if (!isPromptActive && this._hasPendingEntry()) {
          this._hasPendingEntry.set(false);
          const links = this.activeChainLinks();
          if (links.length > 0 && this.phase() !== 'idle') {
            this.onNewChainLink(this._pendingPrevCount(), links);
          }
        }
      });
    });

    // Effect E — Hide overlay when a prompt arrives during chain resolution.
    // After the fade-out completes, release the gate so the prompt becomes visible.
    // When the prompt closes (promptActive → false), re-show the overlay for the next link.
    effect(() => {
      const isPromptActive = this.promptActive();
      const phase = this.phase();

      untracked(() => {
        if (phase !== 'resolving') return;

        if (isPromptActive && this.overlayVisible()) {
          this.chainManager.chainPromptGateActive.set(true);
          this.overlayVisible.set(false);
          this.scheduleTimeout(() => {
            this.chainManager.chainPromptGateActive.set(false);
          }, this.durations().overlayFadeOut);
        } else if (!isPromptActive && this.chainManager.chainPromptGateActive()) {
          // Prompt closed before fade-out finished — release gate immediately
          this.chainManager.chainPromptGateActive.set(false);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Building phase handlers
  // ---------------------------------------------------------------------------

  private onNewChainLink(prevCount: number, links: ChainLinkState[]): void {
    // Chain-1: no overlay — only board glow via animatingZone. Skip entirely.
    if (links.length < 2) return;

    // Handle exit card (overflow > 3)
    if (prevCount >= 3) {
      const exitingLink = links[links.length - 4];
      if (exitingLink) {
        this.exitingCard.set({
          type: 'overflow',
          negated: false,
          card: {
            chainIndex: exitingLink.chainIndex,
            cardCode: exitingLink.cardCode,
            cardName: exitingLink.cardName,
            position: 'back',
          },
        });
        this.scheduleTimeout(() => this.exitingCard.set(null), this.durations().constructFadeOut);
      }
    }

    // Trigger entry animation: set entering state, clear after reflow
    const newestLink = links[links.length - 1];
    this.enteringCardIndex.set(newestLink.chainIndex);
    this.scheduleTimeout(() => this.enteringCardIndex.set(-1), this.durations().entry);

    // Burst detection: if entry anim still in progress, skip fade-out/fade-in cycle.
    // The previously-running show sequence already set overlayVisible=true; the new
    // link just needs a refreshed fade-out timer. No gating needed here — the
    // overlay is already up. `entryTimerId !== null` is the source of truth —
    // β.3 Lot 2.1bis dropped the legacy `_entryAnimInProgress` mirror signal.
    if (this.entryTimerId !== null) {
      this.cancelEntryTimer();
      this.scheduleFadeOutAfterEntry();
      return;
    }

    // β.3 Lot 1b — defer the "show overlay" set until the DEP signals
    // readiness for this chain. The `overlayShowReady` projection
    // accumulates chainIds for which `EffectReady('overlay-show:chain-<N>')`
    // (or `EffectAbandoned` as graceful-degradation fallback) has been
    // emitted on the stream. If the projection already has this
    // chainIndex (the cost MSG_MOVE's animation finished before this
    // MSG_CHAINING arrived — pathological but legal), fire immediately.
    // Otherwise, install a one-shot effect that fires the moment the
    // projection signals readiness; the effect cancels itself on first
    // fire and on the next chain link to avoid stacking.
    this._gateOverlayShowOnReady(newestLink.chainIndex);
  }

  /**
   * β.3 Lot 1b — the "show overlay" sequence, extracted so it can be
   * called either synchronously (projection already ready) or
   * asynchronously (deferred by the gating effect). Sets
   * `overlayVisible=true`, marks the entry animation in progress, and
   * schedules the fade-out after the construct animation completes.
   * Idempotent in the sense that re-calling it while a fade-out timer
   * is pending (`entryTimerId !== null`) is a no-op — the burst path
   * above handles the "another link arrived" case.
   */
  private _runOverlayShowSequence(): void {
    this._overlayShownDuringBuild.set(true);
    this.overlayVisible.set(true);
    this.chainManager.chainEntryAnimating.set(true);
    this.scheduleTimeout(
      () => this.chainManager.chainEntryAnimating.set(false),
      this.durations().constructAppear,
    );
    this.scheduleFadeOutAfterEntry();
  }

  /**
   * β.3 Lot 1b — gate `_runOverlayShowSequence` on the
   * `overlayShowReady` projection. If `chainIndex` is already in the
   * ready set, fire synchronously (no deferral needed). Otherwise,
   * install a one-shot effect that watches the projection's value
   * and fires the sequence the moment `chainIndex` appears.
   *
   * Any previous gating effect is destroyed before installing the
   * new one — a burst of MSG_CHAINING would otherwise stack effects,
   * each firing on the same readiness flip and triggering the show
   * sequence multiple times.
   *
   * Fallback path: `OverlayShowReadyProjection` treats
   * `EffectAbandoned` (timeout / checkpoint) as "ready" too, so a
   * DEP rule that never sees its `awaitingPredicate` matched still
   * unblocks the overlay after `DEFERRED_TIMEOUT_MS` (5s) instead of
   * leaving the overlay invisible forever.
   */
  private _gateOverlayShowOnReady(chainIndex: number): void {
    this._overlayShowEffectRef?.destroy();
    this._overlayShowEffectRef = null;

    if (this.orchestrator.overlayShowReady.isReady(chainIndex)) {
      this._runOverlayShowSequence();
      return;
    }

    this._overlayShowEffectRef = effect(() => {
      const ready = this.orchestrator.overlayShowReady.value();
      if (!ready.has(chainIndex)) return;
      // One-shot: destroy this effect from outside the effect body to
      // avoid re-entrance, then run the sequence in `untracked` so the
      // signal reads inside the sequence don't tie this effect to extra
      // dependencies (it's about to be destroyed anyway).
      untracked(() => {
        this._overlayShowEffectRef?.destroy();
        this._overlayShowEffectRef = null;
        this._runOverlayShowSequence();
      });
    }, { injector: this.injector });
  }

  private scheduleFadeOutAfterEntry(): void {
    this.entryTimerId = this.scheduleTimeout(() => {
      this.entryTimerId = null;
      this.overlayVisible.set(false);
    }, this.durations().constructAppear);
  }

  // ---------------------------------------------------------------------------
  // Resolution phase handlers
  // ---------------------------------------------------------------------------

  /**
   * Resolution sequence per link:
   *   1. Hide overlay (fade-out) so the board is visible
   *   2. Replay buffered board events (player sees impact)
   *   3. Pause so the player can absorb the board change
   *   4. Re-show overlay — resolved card stays visible (no exit yet)
   *   5. Signal ready → orchestrator processes next MSG_CHAIN_SOLVING
   *
   * The resolved card's exit is deferred to pendingExitCard. It will be
   * "pushed out" by the next resolving link (see Effect B). On chain end,
   * it simply disappears with the overlay.
   *
   * Cancellation: when chain end / destroy fires `clearAllTimers()` (via
   * `onChainEnd` or the destroyRef hook), the AbortController short-circuits
   * each remaining `waitForOrAbort`. The `finally` block resets
   * `_resolvingInFlight` so a fresh chain can re-enter the sequence
   * immediately after the cancel.
   */
  private async onChainLinkResolved(): Promise<void> {
    this.logger.log(DuelLogCategory.CHAIN, 'onChainLinkResolved — resolvingInFlight=%s chainOverlayReady=%s waitingForOverlay=%s',
      this._resolvingInFlight(), this.chainManager.chainOverlayReady(), this.chainManager.isWaitingForOverlay);
    if (this._resolvingInFlight()) {
      this.logger.log(DuelLogCategory.CHAIN, 'BLOCKED by resolvingInFlight guard');
      return;
    }
    this._resolvingInFlight.set(true);
    this.chainManager.chainOverlayReady.set(false);

    // Aborted by onChainEnd (chain ended mid-resolution) or destroy. The
    // signal short-circuits each `waitForOrAbort` and `finally` resets the
    // in-flight flag, so no zombie state survives the cancel.
    const abort = new AbortController();
    this._resolutionAbort = abort;
    const aborted = abort.signal;

    try {
      // Snapshot mutable state before any await — immune to concurrent Effect B updates
      const resolvedIdx = this._resolvingNegated() ? this.negatedResolvingIndex() : this.resolvingIndex();
      const cardInfo = this._resolvingCardInfo();
      const negated = this._resolvingNegated();

      // Store resolved card for deferred exit (pushed out by next resolving link)
      if (resolvedIdx >= 0) {
        this.pendingExitCard.set({
          type: 'resolved',
          negated,
          card: {
            chainIndex: resolvedIdx,
            cardCode: cardInfo?.cardCode ?? 0,
            cardName: cardInfo?.cardName ?? '',
            position: 'front',
          },
        });
      }

      // 1. Hide overlay so the board is visible underneath
      this.overlayVisible.set(false);
      await this.waitForOrAbort(this.durations().overlayFadeOut, aborted);
      if (aborted.aborted) return;

      // 2–3. Replay board events + pause for impact (skip for negated — no board change)
      await this.replayAndPause(negated, aborted);
      if (aborted.aborted) return;

      // 4. Re-show overlay — resolved card stays visible until pushed out
      if (this._overlayShownDuringBuild()) this.overlayVisible.set(true);
      await this.waitForOrAbort(this.durations().overlayFadeIn, aborted);
      if (aborted.aborted) return;

      // 5. Cleanup resolving state + signal ready
      this.logger.log(DuelLogCategory.CHAIN, 'onChainLinkResolved DONE — signaling ready');
      this._resolvingNegated.set(false);
      this._resolvingCardInfo.set(null);
      this.resolvingIndex.set(-1);
      this.negatedResolvingIndex.set(-1);
      this.chainManager.chainOverlayReady.set(true);
    } finally {
      // The flag MUST be reset whether we exit via the happy path or via abort.
      // onChainEnd also resets it (belt-and-suspenders): an abort fires the
      // finally one micro-task later, but onChainEnd needs a synchronous reset
      // so a fresh chain can re-enter the resolution sequence immediately.
      this._resolvingInFlight.set(false);
      if (this._resolutionAbort === abort) this._resolutionAbort = null;
    }
  }

  private async replayAndPause(negated: boolean, aborted: AbortSignal): Promise<void> {
    if (negated) return;
    if (this.chainManager.hasBufferedEvents) {
      // replayBuffer is an external Promise we cannot abort — short-circuit
      // after it resolves if a cancel arrived in the meantime.
      await this.orchestrator.replayBuffer();
      if (aborted.aborted) return;
      await this.waitForOrAbort(this.durations().impactPause, aborted);
    }
  }

  private applyResolvingPulse(chainIndex: number, negated: boolean): void {
    if (negated) {
      this.negatedResolvingIndex.set(chainIndex);
      this.resolvingIndex.set(-1);
    } else {
      this.resolvingIndex.set(chainIndex);
    }
  }

  // ---------------------------------------------------------------------------
  // Chain end
  // ---------------------------------------------------------------------------

  private onChainEnd(): void {
    this.overlayVisible.set(false);
    this.clearAllTimers();
    // β.3 Lot 1b — drop any pending "wait for overlay-show ready"
    // effect. A chain that ends before its overlay-show readiness fires
    // (e.g. very fast negation chain that resolves before the cost
    // animation completes — pathological but legal) must not leave the
    // effect dangling: it would fire on the NEXT chain's readiness
    // flip and pop a stale overlay.
    this._overlayShowEffectRef?.destroy();
    this._overlayShowEffectRef = null;
    this._resolutionStarted.set(false);
    this._resolvingInFlight.set(false);
    this._exitPulseInFlight.set(false);
    this.exitingCard.set(null);
    this.pendingExitCard.set(null);
    this.resolvingIndex.set(-1);
    this.negatedResolvingIndex.set(-1);
    this._resolvingCardInfo.set(null);
    this._resolvingNegated.set(false);
    this._hasPendingEntry.set(false);
    this._pendingPrevCount.set(0);

    this._overlayShownDuringBuild.set(false);
    this._lastAnnouncedResolvingIndex.set(-1);
    this._lastAnnouncedNegated.set(false);
  }

  // ---------------------------------------------------------------------------
  // Timer management
  // ---------------------------------------------------------------------------

  private cancelEntryTimer(): void {
    if (this.entryTimerId !== null) {
      clearTimeout(this.entryTimerId);
      this.activeTimers.delete(this.entryTimerId);
      this.entryTimerId = null;
    }
  }

  private clearAllTimers(): void {
    this.cancelEntryTimer();
    // Abort the in-flight resolution chain BEFORE clearing timers — its
    // waitForOrAbort calls listen for abort and self-clean. If we cleared
    // first the listeners would still fire (signal-then-timeout race).
    this._resolutionAbort?.abort();
    this.activeTimers.forEach(id => clearTimeout(id));
    this.activeTimers.clear();
  }

  private scheduleTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.activeTimers.delete(id);
      fn();
    }, ms);
    this.activeTimers.add(id);
    return id;
  }

  /** Promise wrapper around scheduleTimeout — cancelled by clearAllTimers (promise never resolves). */
  private waitFor(ms: number): Promise<void> {
    return new Promise(resolve => this.scheduleTimeout(resolve, ms));
  }

  /**
   * Like waitFor but resolves immediately when `aborted` fires. Cleans up the
   * timer on abort so it can't leak into a later cycle. Used inside
   * `onChainLinkResolved` so a chain end / destroy cancels the wait
   * deterministically (the ms-pure waitFor would hang indefinitely after
   * clearAllTimers).
   */
  private waitForOrAbort(ms: number, aborted: AbortSignal): Promise<void> {
    if (aborted.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const id = this.scheduleTimeout(() => {
        aborted.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(id);
        this.activeTimers.delete(id);
        resolve();
      };
      aborted.addEventListener('abort', onAbort, { once: true });
    });
  }
}
