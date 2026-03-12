import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import type { ChainLinkState } from '../../types';
import { getCardImageUrlByCode } from '../../pvp-card.utils';
import { DuelWebSocketService } from '../duel-web-socket.service';
import { AnimationOrchestratorService } from '../animation-orchestrator.service';

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
 *   - resolving phase: link removed → onChainLinkResolved() (exit animation + board pause)
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
 *   → overlay sets chainOverlayReady=false → plays exit animation → board pause
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

  private readonly wsService = inject(DuelWebSocketService);
  private readonly orchestrator = inject(AnimationOrchestratorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly liveAnnouncer = inject(LiveAnnouncer);

  readonly activeChainLinks = this.wsService.activeChainLinks;
  readonly phase = this.wsService.chainPhase;

  /** Whether the overlay backdrop + cards are visible */
  readonly overlayVisible = signal(false);

  readonly exitingCard = signal<ExitingCardState | null>(null);

  /** chainIndex of the card currently playing entry animation */
  readonly enteringCardIndex = signal(-1);

  /** chainIndex of the front card being resolved (pulse glow) */
  readonly resolvingIndex = signal(-1);

  /** chainIndex of the front card being resolved as negated (grey shake) */
  readonly negatedResolvingIndex = signal(-1);

  /** Whether card entry animation is in progress (for burst detection) */
  private entryAnimInProgress = false;
  private entryTimerId: ReturnType<typeof setTimeout> | null = null;
  private previousLinkCount = 0;
  /** Track whether we've already handled the first resolving phase entry */
  private resolutionStarted = false;

  /** Store resolving card info before link removal */
  private resolvingCardInfo: { cardCode: number; cardName: string } | null = null;
  private resolvingNegated = false;
  /** True once overlayVisible was set during building phase (chain had ≥2 links) */
  private overlayShownDuringBuild = false;
  /** Dedup guard: track last resolving link announced to prevent duplicate liveAnnouncer/buffer calls */
  private lastAnnouncedResolvingIndex = -1;
  private lastAnnouncedNegated = false;

  private readonly activeTimers = new Set<ReturnType<typeof setTimeout>>();

  // --- Deferred entry animation (see Effect C) ---
  private hasPendingEntry = false;
  private pendingPrevCount = 0;

  // --- Animation durations (scaled by speedMultiplier) ---
  readonly durations = computed(() => {
    const scale = (base: number) => Math.round(base * this.orchestrator.speedMultiplier());
    return {
      pulse: this.orchestrator.chainPulseDuration(),
      exit: scale(600),
      constructAppear: scale(800),
      constructFadeOut: scale(600),
      entry: scale(600),
      overflow: scale(600),
    };
  });

  /** Last 3 active chain links mapped to positions */
  readonly visibleCards = computed<VisibleCard[]>(() => {
    const links = this.activeChainLinks();
    const positions: Array<'front' | 'mid' | 'back'> = ['front', 'mid', 'back'];
    const last3 = links.slice(-3);
    return last3.reverse().map((link, i) => ({
      chainIndex: link.chainIndex,
      cardCode: link.cardCode,
      cardName: link.cardName,
      position: positions[i],
    }));
  });

  /** CSS variable values synced with JS durations for accelerated mode */
  readonly cssDurations = computed(() => {
    const d = this.durations();
    return {
      pulse: `${d.pulse}ms`,
      exit: `${d.exit}ms`,
      entry: `${d.entry}ms`,
      overflow: `${d.overflow}ms`,
    };
  });

  /** Card image URL helper for template */
  getCardImageUrl(cardCode: number): string {
    return getCardImageUrlByCode(cardCode);
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.activeTimers.forEach(id => clearTimeout(id));
      this.activeTimers.clear();
    });

    // Effect A — main chain logic + building announcements
    effect(() => {
      const links = this.activeChainLinks();
      const phase = this.phase();

      untracked(() => {
        const currentCount = links.length;
        const prevCount = this.previousLinkCount;
        this.previousLinkCount = currentCount;

        if (phase === 'idle') {
          if (currentCount === 0) this.onChainEnd();
          return;
        }

        if (phase === 'building') {
          if (currentCount > prevCount && currentCount > 0) {
            // Defer entry animation while cost prompt is open (see Effect C for replay)
            if (this.promptActive()) {
              this.hasPendingEntry = true;
              this.pendingPrevCount = prevCount;
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

        if (!this.resolutionStarted) {
          this.resolutionStarted = true;
          // Cancel any pending building-phase fade-out to avoid race with resolution overlay
          this.cancelEntryTimer();
          this.entryAnimInProgress = false;
          // Force clear entry animation gate — resolution takes over
          this.orchestrator.chainEntryAnimating.set(false);
        }

        if (currentCount < prevCount && prevCount > 0) {
          this.onChainLinkResolved();
        }
      });
    });

    // Effect B — resolving detection (pulse glow / negated shake + overlay visibility)
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
        console.log('[DBG:EFFECT-B] phase=resolving links=%d resolvingLink=%o allLinks=%o',
          links.length,
          resolvingLink ? { idx: resolvingLink.chainIndex, negated: resolvingLink.negated, name: resolvingLink.cardName } : null,
          links.map(l => ({ idx: l.chainIndex, negated: l.negated, resolving: l.resolving })));
        if (resolvingLink) {
          this.resolvingCardInfo = { cardCode: resolvingLink.cardCode, cardName: resolvingLink.cardName };
          this.resolvingNegated = resolvingLink.negated;

          if (resolvingLink.negated) {
            this.negatedResolvingIndex.set(resolvingLink.chainIndex);
            this.resolvingIndex.set(-1);
          } else {
            this.resolvingIndex.set(resolvingLink.chainIndex);
          }

          // Show overlay during resolving phase so animation is visible —
          // skip only for chain-1 (overlay was never shown during building)
          if (this.overlayShownDuringBuild) this.overlayVisible.set(true);

          // Dedup: announce only for a new link, or when negation state changes (resolving→negated)
          const isNewLink = resolvingLink.chainIndex !== this.lastAnnouncedResolvingIndex;
          const isNegationUpdate = resolvingLink.chainIndex === this.lastAnnouncedResolvingIndex
            && resolvingLink.negated && !this.lastAnnouncedNegated;
          if (isNewLink || isNegationUpdate) {
            this.lastAnnouncedResolvingIndex = resolvingLink.chainIndex;
            this.lastAnnouncedNegated = resolvingLink.negated;
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
      const announcing = this.orchestrator.chainResolutionAnnounce();
      untracked(() => {
        if (announcing) {
          this.cancelEntryTimer();
          this.entryAnimInProgress = false;
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
        if (!isPromptActive && this.hasPendingEntry) {
          this.hasPendingEntry = false;
          const links = this.activeChainLinks();
          if (links.length > 0 && this.phase() !== 'idle') {
            this.onNewChainLink(this.pendingPrevCount, links);
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
          this.orchestrator.chainPromptGateActive.set(true);
          this.overlayVisible.set(false);
          this.scheduleTimeout(() => {
            this.orchestrator.chainPromptGateActive.set(false);
          }, this.durations().exit);
        } else if (!isPromptActive && this.orchestrator.chainPromptGateActive()) {
          // Prompt closed before fade-out finished — release gate immediately
          this.orchestrator.chainPromptGateActive.set(false);
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

    // Burst detection: if entry anim still in progress, skip fade-out/fade-in cycle
    if (this.entryAnimInProgress) {
      this.cancelEntryTimer();
      this.scheduleFadeOutAfterEntry();
      return;
    }

    // Normal flow: show overlay, animate entry, then fade out
    this.overlayShownDuringBuild = true;
    this.overlayVisible.set(true);
    this.entryAnimInProgress = true;
    this.orchestrator.chainEntryAnimating.set(true);
    this.scheduleTimeout(() => this.orchestrator.chainEntryAnimating.set(false), this.durations().constructAppear);
    this.scheduleFadeOutAfterEntry();
  }

  private scheduleFadeOutAfterEntry(): void {
    this.entryTimerId = this.scheduleTimeout(() => {
      this.entryAnimInProgress = false;
      this.overlayVisible.set(false);
    }, this.durations().constructAppear);
  }

  // ---------------------------------------------------------------------------
  // Resolution phase handlers
  // ---------------------------------------------------------------------------

  private onChainLinkResolved(): void {
    this.orchestrator.chainOverlayReady.set(false);

    const resolvedIdx = this.resolvingNegated ? this.negatedResolvingIndex() : this.resolvingIndex();
    const cardInfo = this.resolvingCardInfo;
    // Capture at scheduling time — immune to concurrent Effect B updates before the timeout fires
    const negatedAtSchedule = this.resolvingNegated;

    if (resolvedIdx >= 0) {
      this.exitingCard.set({
        type: 'resolved',
        negated: negatedAtSchedule,
        card: {
          chainIndex: resolvedIdx,
          cardCode: cardInfo?.cardCode ?? 0,
          cardName: cardInfo?.cardName ?? '',
          position: 'front',
        },
      });
    }

    // After exit animation: clean up and handle board change pause.
    // negatedAtSchedule is passed explicitly so the decision is independent of later field resets.
    this.scheduleTimeout(() => {
      this.exitingCard.set(null);
      this.overlayVisible.set(false);
      this.handleBoardChangePause(negatedAtSchedule);
      this.resolvingNegated = false;
      this.resolvingCardInfo = null;
      this.resolvingIndex.set(-1);
      this.negatedResolvingIndex.set(-1);
    }, this.durations().exit);
  }

  private handleBoardChangePause(negated = this.resolvingNegated): void {
    // Negated effect: no board change possible — skip board reveal pause entirely.
    if (negated) {
      this.orchestrator.chainOverlayReady.set(true);
      return;
    }
    if (this.orchestrator.chainOverlayBoardChanged()) {
      // Replay board events — travels are z-index 1000, visible above everything.
      // Overlay re-shown by Effect B when next MSG_CHAIN_SOLVING pulse starts.
      this.orchestrator.replayBufferedEvents().then(() => {
        this.orchestrator.chainOverlayReady.set(true);
      });
    } else {
      this.orchestrator.chainOverlayReady.set(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Chain end
  // ---------------------------------------------------------------------------

  private onChainEnd(): void {
    this.overlayVisible.set(false);
    this.clearAllTimers();
    this.resolutionStarted = false;
    this.exitingCard.set(null);
    this.resolvingIndex.set(-1);
    this.negatedResolvingIndex.set(-1);
    this.resolvingCardInfo = null;
    this.resolvingNegated = false;
    this.hasPendingEntry = false;
    this.pendingPrevCount = 0;

    this.overlayShownDuringBuild = false;
    this.lastAnnouncedResolvingIndex = -1;
    this.lastAnnouncedNegated = false;
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
    this.entryAnimInProgress = false;
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
}
