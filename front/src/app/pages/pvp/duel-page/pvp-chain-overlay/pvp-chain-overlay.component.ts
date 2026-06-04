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
import { DuelContext } from '../duel-context';
import { DuelLogCategory, DuelLogger } from '../duel-logger';
import {
  OVERLAY_ANIM_HOLD_MS,
  OVERLAY_ANIM_HOLD_MIN_MS,
  CHAIN_OVERLAY_MONO_CAP,
  CHAIN_OVERLAY_MAJORITY_CAP,
  CHAIN_OVERLAY_MINORITY_CAP,
  CHAIN_OVERLAY_MINORITY_CAP_CRAMPED,
} from '../animation-constants';

export type ChainSide = 'left' | 'right';
/** Vertical layer in the shared zigzag — 0 = topmost (oldest visible link,
 *  smallest), 4 = bottom (newest link, largest). All sides share the same
 *  vertical scale so a card on the left at level 2 is at the same Y as a
 *  card on the right at level 2 — the zigzag is global. */
export type ChainLevel = 0 | 1 | 2 | 3 | 4;
/** Legacy "front | mid | back" preserved on VisibleCard for templates that
 *  still distinguish the bottom card (resolving glow / negated shake / exit
 *  anim apply to `slot === 'front'`). `front` = the newest link of its side
 *  (highest chainIndex). */
export type ChainSlot = 'front' | 'mid' | 'back';

export interface VisibleCard {
  chainIndex: number;
  cardCode: number;
  cardName: string;
  /** Layout side derived from the link's `player` via DuelContext.relativePlayer */
  side: ChainSide;
  /** Shared vertical level (0 top → 4 bottom). Newer = bigger (level 4 is the
   *  largest = the most recent visible link). */
  level: ChainLevel;
  /** `front` if this is the newest link of its side (used by pulse/negated/
   *  exit anim selectors). `mid`/`back` otherwise (currently unused, but kept
   *  for backward compatibility with template assertions in specs). */
  slot: ChainSlot;
  /** Absolute player index — kept for components that key on player identity. */
  player: number;
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
  private readonly duelCtx = inject(DuelContext);

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

  /** chainIndex of the card being explicitly shoved up by an incoming new link.
   *  Read by the template to apply the `chain-card--shoved` class which plays
   *  the `chain-shove-up` keyframe (visible translation + scale-down toward
   *  the new slot). Cleared after `pushDuration` ms. */
  readonly shovedCardIndex = signal(-1);

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
  /**
   * Snapshot of the previous `activeChainLinks` array. Used by Effect A to
   * identify which link was dropped (CHAIN_SOLVED) and pass it directly to
   * `onChainLinkResolved`. Reading `_resolvingCardInfo` at that moment is
   * racy — it can be either:
   *   · null (cleanup of the previous link ran AFTER Effect B set the new
   *     value, then null'd it again), or
   *   · the next link in resolution (Effect B fired for the next
   *     CHAIN_SOLVING before Effect A processed our drop).
   * The previousLinks snapshot is immune to both — it's the array as it
   * was BEFORE the drop, so finding the link that's no longer present is
   * deterministic.
   */
  private readonly _previousLinks = signal<readonly ChainLinkState[]>([]);
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
  /**
   * True while the resolving pulse glow animation is playing (pulse +
   * breathing hold + overlay fade-out). Drives `overlayActive` for the
   * resolving phase. Bounded by an explicit timer so it can NEVER stay
   * true longer than the pulse animation cycle — distinct from
   * `resolvingIndex` which tracks logical state and may stay true through
   * the full `onChainLinkResolved` async flow (incl. replayBuffer +
   * impactPause) — those are NOT visible animations and gating the
   * replay scheduler on them causes deadlock (cf. chat 2026-06-03). */
  private readonly _pulseActive = signal(false);
  /** True once overlayVisible was set during building phase (chain had ≥2 links) */
  private readonly _overlayShownDuringBuild = signal(false);
  /** Dedup guard: track last resolving link announced to prevent duplicate liveAnnouncer/buffer calls */
  private readonly _lastAnnouncedResolvingIndex = signal(-1);
  private readonly _lastAnnouncedNegated = signal(false);

  private readonly activeTimers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * β.3 Lot 1b — pending effects that watch `overlayShowReady` to
   * fire the deferred show sequence (`_runOverlayShowSequence`) the
   * moment the DEP signals readiness for the corresponding chainIndex.
   *
   * β.3 red-team finding #10 (2026-05-26) — keyed by `chainIndex`
   * instead of a single ref. A burst of MSG_CHAINING (link N+1
   * arriving while link N's gating effect has not yet fired) would
   * previously overwrite the single ref, leaving link N's overlay
   * lost forever. With the map, each chainIndex owns its own
   * lifecycle. Entries are destroyed:
   *   · synchronously when the effect fires (one-shot self-cleanup);
   *   · in `onChainEnd` (full chain over → drop all pending);
   *   · in the destroyRef hook (component teardown).
   */
  private readonly _overlayShowEffectRefs = new Map<number, EffectRef>();

  /**
   * Cramped-viewport flag — mirrors the DS `mobile-full` mixin
   * (front/src/app/styles/_responsive.scss): portrait below tablet OR
   * landscape compact (≤1023px wide AND ≤500px tall). Picks up landscape
   * phones (where height is the binding constraint) without lighting up
   * iPad landscape (which has the room for the full 5-card stack).
   *
   * When set, the visible-card caps drop from 3/2 (5 max) to 2/1 (3 max)
   * so the vertical stack of progressive-sized cards fits readably.
   * Initialised before the computed `visibleCards` evaluates so the
   * first render is correct.
   */
  private static readonly CRAMPED_MQ = '(max-width: 767px), (max-width: 1023px) and (max-height: 500px)';
  private readonly _isShortViewport = signal<boolean>(
    typeof window !== 'undefined' && window.matchMedia(PvpChainOverlayComponent.CRAMPED_MQ).matches,
  );

  /**
   * Aborts the in-flight `onChainLinkResolved` async chain on chain end /
   * destroy. Each `await waitForOrAbort` short-circuits when the signal
   * fires; the `finally` block resets `_resolvingInFlight` so no zombie
   * state survives a mid-resolution cancel.
   */
  private _resolutionAbort: AbortController | null = null;

  // --- Deferred entry animation (see Effect C) ---
  // `null` = no pending entry. Single signal so the two pieces of state
  // (presence + payload) can never desync — they were two booleans/numbers
  // set, read and cleared in lockstep at three call sites.
  private readonly _pendingEntry = signal<{ prevCount: number; prevLinks: readonly ChainLinkState[] } | null>(null);

  /**
   * chainIndex of the link queued to receive the `chain-card--entering` /
   * `chain-card--shoved` classes the moment the overlay actually shows
   * (i.e. `_runOverlayShowSequence` runs). Set by `onNewChainLink`,
   * consumed by `_startEnterAndShoveAnims`. -1 = nothing pending.
   *
   * Deferral matters in PvP: the DEP gate (`overlay-show:chain-N`) may
   * stall the overlay show by 0–2s waiting for the cost MSG_MOVE's
   * AnimationCompleted. If we set `enteringCardIndex` at MSG_CHAINING
   * receipt (as we used to), its clear timer (~600ms) would fire before
   * the overlay even appeared — leaving the user with a card already
   * settled in its slot with no swoop animation visible.
   */
  private _pendingEnterIndex = -1;
  private _pendingShoveIndex = -1;
  /**
   * True between `onNewChainLink` and `_runOverlayShowSequence` — i.e.
   * while we're waiting for the DEP gate. Read by the template to apply
   * `chain-card-container--gate-pending` which freezes the cascade
   * transition (top/left/transform) until the overlay actually shows,
   * so the user sees the previous card MOVE TO its new slot in sync
   * with the new card's swoop instead of finding it already there.
   */
  readonly gatePending = signal(false);

  /**
   * Snapshot of `activeChainLinks` taken right BEFORE the new MSG_CHAINING
   * was committed. Used by `visibleCards` while `gatePending` is true so
   * the rendered layout reflects the OLD chain (without the newcomer).
   * When the DEP gate releases, the signal flips to null and `visibleCards`
   * falls back to live `activeChainLinks` — the recompute drives the CSS
   * top/left/transform transitions for all cards (cascade + new card).
   */
  private readonly _frozenLinks = signal<readonly ChainLinkState[] | null>(null);

  // --- Animation durations (scaled by speedMultiplier) ---
  readonly durations = computed(() => {
    const scale = (base: number) => Math.round(base * this.orchestrator.speedMultiplier());
    return {
      pulse: this.orchestrator.chainPulseDuration(),
      // `exit` is the duration the orchestrator waits before dispatching the
      // next event — it's the timing-contract value, not the visual length
      // of the CSS keyframe. The keyframe itself uses `exitVisual` (shorter)
      // so the exiting card disappears before the cascade replacement glides
      // into its slot, avoiding the visual pile-up at mid-screen.
      exit: this.orchestrator.chainExitDuration(),
      exitVisual: scale(300),
      overlayFadeOut: Math.max(200, scale(300)),
      // F4 (2026-06-04) — `overlayFadeIn` ALSO feeds the SCSS
      // `animation-delay` on `chain-card--entering` / `chain-card--shoved`
      // (see `cssDurations.overlayFadeIn` below + the template style
      // binding `--chain-overlay-fadein-ms`). Hardcoding 300ms in SCSS
      // diverged from this scaled JS value under slow playback.
      overlayFadeIn: Math.max(200, scale(300)),
      impactPause: Math.max(200, scale(300)),
      constructAppear: scale(800),
      constructFadeOut: scale(600),
      entry: scale(600),
      overflow: scale(600),
      /** "Shove up" anim on the previous same-side link when a new chain link
       *  arrives — the older link visibly translates + shrinks toward its new
       *  slot. Bundled with `entry` since they play together. */
      shove: scale(500),
    };
  });

  /**
   * Distribute chain links across 2 sides (viewer=left, opposant=right) with
   * up to 3 slots per side (front=bottom/largest, mid=middle, back=top/smallest).
   *
   * Distribution rules:
   *   · Each link's side is derived from `link.player` via
   *     `DuelContext.relativePlayer` (relative 0 → left, relative 1 → right).
   *   · Total limit: 5 cards across both sides (3 majority + 2 minority).
   *   · Mono-side: 3 max — overflow is the oldest of the only side.
   *   · Tie-break (equal counts): the side carrying the most recent link is
   *     majority. The other side keeps 2 max.
   *   · `pendingExitCard` (a link that just resolved, awaiting push by the
   *     next CHAIN_SOLVING) is treated as a virtual "newest" of its side
   *     and occupies its front slot — sides keep counting it toward limits.
   *
   * Within a side, the most recent chain link takes the `front` slot, the
   * previous one `mid`, the one before `back`. Older links are dropped
   * from the visible set (their overflow exit anim is triggered by Effect A
   * when the 4th link of a side arrives, NOT by this computed — see
   * `onNewChainLink`).
   */
  readonly visibleCards = computed<VisibleCard[]>(() => {
    // While the DEP gate stalls the overlay show, render the OLD links
    // (snapshot taken just before the newcomer joined) so the previous
    // card stays at its previous slot. When `_runOverlayShowSequence`
    // releases the gate, this signal flips to null and the live links
    // take over — the recompute drives the cascade transitions in sync
    // with the new card's swoop animation.
    const frozen = this._frozenLinks();
    const links = frozen ?? this.activeChainLinks();
    const pending = this.pendingExitCard();
    const ownIdx = this.duelCtx.ownPlayerIndex();

    type LinkInput = { chainIndex: number; cardCode: number; cardName: string; player: number };
    const inputs: LinkInput[] = links.map(l => ({
      chainIndex: l.chainIndex, cardCode: l.cardCode, cardName: l.cardName, player: l.player,
    }));
    if (pending) {
      inputs.push({
        chainIndex: pending.card.chainIndex,
        cardCode: pending.card.cardCode,
        cardName: pending.card.cardName,
        player: pending.card.player,
      });
    }

    // Side derivation: viewer (own absolute index) → left, other → right.
    const sideOf = (player: number): ChainSide => player === ownIdx ? 'left' : 'right';

    // Split by side, then cap each side at 3 (majority) / 2 (minority).
    const leftLinks: LinkInput[] = [];
    const rightLinks: LinkInput[] = [];
    for (const l of inputs) {
      (sideOf(l.player) === 'left' ? leftLinks : rightLinks).push(l);
    }
    // Sort DESC so index 0 of each list = newest of the side.
    leftLinks.sort((a, b) => b.chainIndex - a.chainIndex);
    rightLinks.sort((a, b) => b.chainIndex - a.chainIndex);

    // Card caps : see `CHAIN_OVERLAY_*_CAP` in `animation-constants.ts`
    // for the doctrine — desktop 2/2 (4 max), short viewport 2/1 (3 max).
    // SCSS depends on these values for per-level top/left/size — bump
    // requires SCSS update.
    const short = this._isShortViewport();
    const monoCap = CHAIN_OVERLAY_MONO_CAP;
    const majorityCap = CHAIN_OVERLAY_MAJORITY_CAP;
    const minorityCap = short ? CHAIN_OVERLAY_MINORITY_CAP_CRAMPED : CHAIN_OVERLAY_MINORITY_CAP;
    let leftCap = monoCap, rightCap = monoCap;
    if (leftLinks.length > 0 && rightLinks.length > 0) {
      const leftIsMajority = leftLinks.length > rightLinks.length
        || (leftLinks.length === rightLinks.length && leftLinks[0].chainIndex > rightLinks[0].chainIndex);
      if (leftIsMajority) { leftCap = majorityCap; rightCap = minorityCap; }
      else { leftCap = minorityCap; rightCap = majorityCap; }
    }

    const visibleLeft = leftLinks.slice(0, leftCap);
    const visibleRight = rightLinks.slice(0, rightCap);

    // Assign shared vertical levels across both sides. Level 0 = top (oldest
    // visible link, smallest), level (N-1) = bottom (newest, largest). Sort
    // all visible cards by chainIndex ASC and map their index → level.
    type WithSide = LinkInput & { side: ChainSide };
    const allVisible: WithSide[] = [
      ...visibleLeft.map(l => ({ ...l, side: 'left' as ChainSide })),
      ...visibleRight.map(l => ({ ...l, side: 'right' as ChainSide })),
    ].sort((a, b) => a.chainIndex - b.chainIndex);

    // Level anchoring: newest visible always lands on level 4 (largest, bottom
    // slot in the CSS). Older cards climb up to levels 3, 2, ... down to level
    // (4 - allVisible.length + i). With cap 2/2 = max 4 cards visible, levels
    // used are 1, 2, 3, 4. With 2/1 = 3 cards, levels 2, 3, 4. Level 0 stays
    // defined in CSS as a safety net but isn't reached under the current caps.
    const levelOffset = 4 - allVisible.length + 1; // i=0 → oldest gets this
    return allVisible.map((l, i) => {
      const sameSide = allVisible.filter(x => x.side === l.side);
      const indexInSide = sameSide.findIndex(x => x.chainIndex === l.chainIndex);
      const positionFromNewest = sameSide.length - 1 - indexInSide;
      const slot: ChainSlot = positionFromNewest === 0 ? 'front'
        : positionFromNewest === 1 ? 'mid'
        : 'back';
      return {
        chainIndex: l.chainIndex,
        cardCode: l.cardCode,
        cardName: l.cardName,
        side: l.side,
        level: (levelOffset + i) as ChainLevel,
        slot,
        player: l.player,
      };
    });
  });

  /**
   * "Is the overlay currently playing a card-level animation that the rest
   * of the UI should wait for before competing for the user's attention?"
   *
   * Consumed by `pvp-prompt-dialog` (gates `dialogState=open`, Approach A)
   * and by `ReplayTransportService.maybeAdvance` (gates the
   * `schedulePromptDismiss` window, F1).
   *
   * True only for BOUNDED visual animations :
   *   · entry swoop-in (`enteringCardIndex !== -1`) — clear timer bounded
   *     at entry + hold + overlayFadeOut (see `_startEnterAndShoveAnims`).
   *   · resolving pulse (`_pulseActive`) — bounded by an explicit timer
   *     in `applyResolvingPulse` (pulse + hold + overlayFadeOut).
   *   · exit pulse in-flight + overflow exit anim.
   *
   * INTENTIONALLY NOT included :
   *   · `resolvingIndex` / `negatedResolvingIndex` (logical state, stays
   *     true through `onChainLinkResolved` async flow — incl. replayBuffer
   *     + impactPause. Gating the replay scheduler on this causes a
   *     deadlock — F1 would never release).
   *   · `overlayVisible()` alone (the overlay can be visible-and-stable
   *     between two links — gating here would block forever in building).
   *   · `pendingExitCard()` (no active anim, just a memo).
   */
  readonly overlayActive = computed<boolean>(() =>
    this.enteringCardIndex() !== -1
    || this._pulseActive()
    || this._exitPulseInFlight()
    || this.exitingCard() !== null
  );

  /** CSS variable values synced with JS durations for accelerated mode */
  readonly cssDurations = computed(() => {
    const d = this.durations();
    return {
      pulse: `${d.pulse}ms`,
      exit: `${d.exit}ms`,
      exitVisual: `${d.exitVisual}ms`,
      entry: `${d.entry}ms`,
      overflow: `${d.overflow}ms`,
      shove: `${d.shove}ms`,
      // F4 (2026-06-04) — fed into SCSS as `--chain-overlay-fadein-ms`
      // so the entering/shoved animation-delay matches the SCALED fade-in
      // (used to be hardcoded 300ms — broke under slow playback).
      overlayFadeIn: `${d.overlayFadeIn}ms`,
      // Cascade cards (chain links shifting forward to fill the slot a
      // resolved card vacated) hold this long before sliding — so the
      // exiting card has visibly cleared the slot BEFORE the replacement
      // glides in. With exitVisual = 300ms and cascadeDelay = 200ms, the
      // cascade starts when the exiting card is at ~67% of its keyframe
      // (well past its half-fade point), eliminating the mid-screen pile-up.
      cascadeDelay: '200ms',
    };
  });

  /** Card image URL helper for template */
  getCardImageUrl(cardCode: number): string {
    return this.artService.resolveUrl(cardCode);
  }

  constructor() {
    // Wire matchMedia listener for the cramped-viewport cap drop. Mirrors
    // the DS `mobile-full` mixin (cf. _responsive.scss). Idempotent teardown
    // via destroyRef. SSR-safe: window check before binding.
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia(PvpChainOverlayComponent.CRAMPED_MQ);
      const onChange = (e: MediaQueryListEvent) => this._isShortViewport.set(e.matches);
      mq.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => mq.removeEventListener('change', onChange));
    }

    this.destroyRef.onDestroy(() => {
      this._resolutionAbort?.abort();
      this.activeTimers.forEach(id => clearTimeout(id));
      this.activeTimers.clear();
      // β.3 Lot 1b — tear down every pending overlay-show effect on
      // component destroy. The injector's DestroyRef would propagate
      // anyway, but explicit destroy keeps the lifecycle obvious.
      // (β.3 red-team finding #10) the map can carry multiple entries
      // when a burst of MSG_CHAINING was in flight; drop them all.
      this._overlayShowEffectRefs.forEach(ref => ref.destroy());
      this._overlayShowEffectRefs.clear();
    });

    // Effect A — main chain logic + building announcements
    effect(() => {
      const links = this.activeChainLinks();
      const phase = this.phase();

      untracked(() => {
        const currentCount = links.length;
        const prevCount = this._previousLinkCount();
        const prevLinks = this._previousLinks();
        this._previousLinkCount.set(currentCount);
        this._previousLinks.set(links);

        if (phase === 'idle') {
          if (currentCount === 0) this.onChainEnd();
          return;
        }

        if (phase === 'building') {
          if (currentCount > prevCount && currentCount > 0) {
            // Defer entry animation while cost prompt is open (see Effect C for replay)
            if (this.promptActive()) {
              this._pendingEntry.set({ prevCount, prevLinks });
            } else {
              this.onNewChainLink(prevCount, links, prevLinks);
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
          this.onNewChainLink(prevCount, links, prevLinks);
        }

        if (!this._resolutionStarted()) {
          this._resolutionStarted.set(true);
          // Cancel any pending building-phase fade-out to avoid race with resolution overlay
          this.cancelEntryTimer();
          // Force clear entry animation gate — resolution takes over
          this.chainManager.chainEntryAnimating.set(false);
        }

        if (currentCount < prevCount && prevCount > 0) {
          // Find the link that was just dropped — the one present in
          // prevLinks but not in links. Pass it directly to
          // onChainLinkResolved so the snapshot is immune to Effect B /
          // cleanup races on `_resolvingCardInfo`.
          const droppedLink = prevLinks.find(p => !links.some(l => l.chainIndex === p.chainIndex));
          this.logger.log(DuelLogCategory.CHAIN, 'Effect A: link removed %d→%d — calling onChainLinkResolved droppedLink=%o', prevCount, currentCount, droppedLink);
          this.onChainLinkResolved(droppedLink);
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
    // F15 (2026-05-31) — reads from `chainManager.chainResolutionAnnounce`,
    // the unified signal that replaced the prior split projection +
    // private sync mirror pair. Same reactive contract for this effect.
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
        const pending = this._pendingEntry();
        if (!isPromptActive && pending) {
          this._pendingEntry.set(null);
          const links = this.activeChainLinks();
          if (links.length > 0 && this.phase() !== 'idle') {
            this.onNewChainLink(pending.prevCount, links, pending.prevLinks);
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

  private onNewChainLink(prevCount: number, links: ChainLinkState[], prevLinks: readonly ChainLinkState[]): void {
    // Chain-1: no overlay — only board glow via animatingZone. Skip entirely.
    if (links.length < 2) return;

    // Overflow exit (>3 cards on a side): identify the oldest link of the side
    // whose new link just arrived, and only animate the overflow if THAT side
    // is now over capacity. Capacity depends on majority/minority — but at this
    // point in the flow, the new link is already in `activeChainLinks`, so we
    // can re-derive the limits the same way `visibleCards` does.
    const newestLink = links[links.length - 1];
    const ownIdx = this.duelCtx.ownPlayerIndex();
    const newSide: ChainSide = newestLink.player === ownIdx ? 'left' : 'right';
    const sideLinks = links.filter(l => (l.player === ownIdx ? 'left' : 'right') === newSide);
    const otherCount = links.length - sideLinks.length;
    // Determine this side's cap using the same rule as `visibleCards`.
    // Constants live in `animation-constants.ts` — see there for SCSS
    // coupling notes.
    const short = this._isShortViewport();
    const monoCap = CHAIN_OVERLAY_MONO_CAP;
    const majorityCap = CHAIN_OVERLAY_MAJORITY_CAP;
    const minorityCap = short ? CHAIN_OVERLAY_MINORITY_CAP_CRAMPED : CHAIN_OVERLAY_MINORITY_CAP;
    let cap: number;
    if (otherCount === 0) cap = monoCap;
    else if (sideLinks.length > otherCount) cap = majorityCap;
    else if (sideLinks.length < otherCount) cap = minorityCap;
    else cap = majorityCap; // tie → newest link's side is majority
    if (sideLinks.length > cap) {
      // sideLinks is in chainIndex-ascending order (filter preserves insertion).
      // The oldest visible-but-now-overflowing link is the one at position
      // `sideLinks.length - cap - 1` from the start (sorted asc).
      const exitingLink = sideLinks[sideLinks.length - cap - 1];
      if (exitingLink) {
        this.exitingCard.set({
          type: 'overflow',
          negated: false,
          card: {
            chainIndex: exitingLink.chainIndex,
            cardCode: exitingLink.cardCode,
            cardName: exitingLink.cardName,
            side: newSide,
            level: 0,
            slot: 'back',
            player: exitingLink.player,
          },
        });
        this.scheduleTimeout(() => this.exitingCard.set(null), this.durations().constructFadeOut);
      }
    }

    // Identify the same-side link that just lost the front slot to the newcomer
    // and mark it as "shoved" so the template plays the chain-shove-up keyframe.
    // The shoved link is the second-most-recent link on the new card's side.
    // If there's none (newcomer is the first link of its side), no shove.
    // NOTE: the `shovedCardIndex` set is also deferred to `_runOverlayShowSequence`
    // (along with `enteringCardIndex`) so both animations start in sync with
    // the overlay fade-in. PvP: the DEP gate can delay the show by 0–2s while
    // waiting for the cost MSG_MOVE's AnimationCompleted; without deferral
    // the timers below would expire before the overlay even appears,
    // leaving the user with a card already settled in its slot.
    const sameSidePrev = sideLinks
      .filter(l => l.chainIndex !== newestLink.chainIndex)
      .sort((a, b) => b.chainIndex - a.chainIndex)[0];
    this._pendingEnterIndex = newestLink.chainIndex;
    this._pendingShoveIndex = sameSidePrev?.chainIndex ?? -1;

    // Freeze the visible layout to the BEFORE-newcomer state. Released by
    // `_runOverlayShowSequence` when the DEP gate finally fires. The freeze
    // ensures `visibleCards()` returns the OLD positions so the previous
    // card sits at its previous slot — when the gate releases and the
    // freeze drops, the recompute drives the cascade transition.
    this._frozenLinks.set(prevLinks);

    // Burst detection: if entry anim still in progress, skip fade-out/fade-in cycle.
    // The previously-running show sequence already set overlayVisible=true; the new
    // link just needs a refreshed fade-out timer. No gating needed here — the
    // overlay is already up. `entryTimerId !== null` is the source of truth —
    // β.3 Lot 2.1bis dropped the legacy `_entryAnimInProgress` mirror signal.
    if (this.entryTimerId !== null) {
      // Burst: drop the freeze immediately — overlay is already visible, the
      // cascade should run normally.
      this._frozenLinks.set(null);
      this.cancelEntryTimer();
      this._startEnterAndShoveAnims();
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
   * Apply the enter/shove signals + their clear timers. Called from
   * `_runOverlayShowSequence` (deferred path) and from the burst-detection
   * path in `onNewChainLink`. Reads from `_pendingEnterIndex` /
   * `_pendingShoveIndex` set by `onNewChainLink` so the right chainIndex
   * is used even if multiple MSG_CHAINING arrived since.
   */
  private _startEnterAndShoveAnims(): void {
    if (this._pendingEnterIndex !== -1) {
      const idx = this._pendingEnterIndex;
      this.enteringCardIndex.set(idx);
      // Clear timer = entry + breathing-room hold + overlayFadeOut. The
      // hold lets the user perceive the card after the visual swoop ;
      // the +overlayFadeOut tail keeps `overlayActive` true UNTIL the
      // overlay's CSS opacity transition has fully completed, so a
      // gated consumer (prompt dialog, replay scheduler) doesn't show
      // while the overlay is still mid-fade. Without this tail, the
      // prompt would slide in under a still-visible (opacity > 0)
      // chain card. Cf. chat 2026-06-03 "prompt under overlay".
      const hold = this.duelCtx.scaledDuration(OVERLAY_ANIM_HOLD_MS, OVERLAY_ANIM_HOLD_MIN_MS);
      const tail = this.durations().overlayFadeOut;
      this.scheduleTimeout(() => {
        if (this.enteringCardIndex() === idx) this.enteringCardIndex.set(-1);
      }, this.durations().entry + hold + tail);
      this._pendingEnterIndex = -1;
    }
    if (this._pendingShoveIndex !== -1) {
      const idx = this._pendingShoveIndex;
      this.shovedCardIndex.set(idx);
      this.scheduleTimeout(() => {
        if (this.shovedCardIndex() === idx) this.shovedCardIndex.set(-1);
      }, this.durations().shove);
      this._pendingShoveIndex = -1;
    }
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
    // Release both the gate flag AND the layout freeze BEFORE applying the
    // enter/shove signals. Dropping `_frozenLinks` triggers a recompute of
    // `visibleCards()`, which switches the cards from their OLD positions
    // to their NEW positions — the CSS transition (top/left/transform/size)
    // kicks off naturally, in sync with the new card's swoop animation that
    // `_startEnterAndShoveAnims` is about to arm.
    this.gatePending.set(false);
    this._frozenLinks.set(null);
    // Apply the entering + shoved class signals NOW (deferred from
    // `onNewChainLink`) so their clear timers don't expire during the
    // overlay-show wait. In PvP this wait can be up to ~2s while the DEP
    // tracks the cost MSG_MOVE animation; in replay it's near-instant.
    this._startEnterAndShoveAnims();
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
    // β.3 red-team finding #10 — each chainIndex owns its own pending
    // effect. If this chainIndex already has an effect installed (rare:
    // duplicate MSG_CHAINING for the same link), drop it before
    // re-installing.
    this._overlayShowEffectRefs.get(chainIndex)?.destroy();
    this._overlayShowEffectRefs.delete(chainIndex);

    if (this.orchestrator.overlayShowReady.isReady(chainIndex)) {
      this._runOverlayShowSequence();
      return;
    }

    // DEP gate is going to delay — freeze the cascade transition until the
    // show sequence fires. See `gatePending` docstring.
    this.gatePending.set(true);

    const ref = effect(() => {
      const ready = this.orchestrator.overlayShowReady.value();
      if (!ready.has(chainIndex)) return;
      // One-shot: destroy this effect from outside the effect body to
      // avoid re-entrance, then run the sequence in `untracked` so the
      // signal reads inside the sequence don't tie this effect to extra
      // dependencies (it's about to be destroyed anyway).
      untracked(() => {
        const stored = this._overlayShowEffectRefs.get(chainIndex);
        stored?.destroy();
        this._overlayShowEffectRefs.delete(chainIndex);
        this._runOverlayShowSequence();
      });
    }, { injector: this.injector });
    this._overlayShowEffectRefs.set(chainIndex, ref);
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
   * Resolution sequence per link (post 2026-06-02 — no final re-show ;
   * post 2026-06-03 — breathing-room hold) :
   *   1. Set pendingExitCard (will fade-in at the next MSG_CHAIN_SOLVING)
   *   2. Breathing-room hold (`OVERLAY_ANIM_HOLD_MS`) — the resolved card
   *      stays visible for a beat after its pulse glow
   *   3. Hide overlay (fade-out) so the board is free
   *   4. Replay buffered board events on the free board (player sees impact)
   *   5. Pause so the player can absorb the board change
   *   6. Signal ready → orchestrator processes next MSG_CHAIN_SOLVING
   *
   * Overlay does NOT re-show at the end. The next MSG_CHAIN_SOLVING triggers
   * Effect B which fades the overlay back in WITH the pendingExitCard
   * visible at front, then the new resolving link pushes it out via its
   * exit animation. On MSG_CHAIN_END, overlay stays off — `onChainEnd`
   * clears the pendingExitCard silently.
   *
   * Cancellation: when chain end / destroy fires `clearAllTimers()` (via
   * `onChainEnd` or the destroyRef hook), the AbortController short-circuits
   * each remaining `waitForOrAbort`. The `finally` block resets
   * `_resolvingInFlight` so a fresh chain can re-enter the sequence
   * immediately after the cancel.
   */
  private async onChainLinkResolved(droppedLink: ChainLinkState | undefined): Promise<void> {
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
      // 1. Store resolved card for deferred exit (pushed out by next resolving
      //    link when it fades the overlay back in via Effect B). The link
      //    data is read from the dropped link snapshot passed by Effect A —
      //    immune to concurrent Effect B updates / cleanup races on
      //    `_resolvingCardInfo`.
      if (droppedLink) {
        const ownIdx = this.duelCtx.ownPlayerIndex();
        this.pendingExitCard.set({
          type: 'resolved',
          negated: droppedLink.negated,
          card: {
            chainIndex: droppedLink.chainIndex,
            cardCode: droppedLink.cardCode,
            cardName: droppedLink.cardName,
            side: droppedLink.player === ownIdx ? 'left' : 'right',
            level: 4,
            slot: 'front',
            player: droppedLink.player,
          },
        });
      }
      const negated = droppedLink?.negated ?? false;

      // 2. Breathing-room hold (chat 2026-06-03) — the just-resolved card
      //    stays visible for `OVERLAY_ANIM_HOLD_MS` after its pulse glow
      //    finishes, so the user can register the resolution before the
      //    overlay fades out + the board replay starts. The `applyResolvingPulse`
      //    setTimeout-driven hide would already have applied a hold, but
      //    that timer rarely fires first in practice (MSG_CHAIN_SOLVED
      //    typically lands during the pulse CSS animation, triggering
      //    this path which then wins the "first to hide" race). Pinning
      //    the hold here makes the breathing room observable.
      const hold = this.duelCtx.scaledDuration(OVERLAY_ANIM_HOLD_MS, OVERLAY_ANIM_HOLD_MIN_MS);
      await this.waitForOrAbort(hold, aborted);
      if (aborted.aborted) return;

      // 3. Hide overlay so the board is free for the player to watch the
      //    replay + impact
      this.overlayVisible.set(false);
      await this.waitForOrAbort(this.durations().overlayFadeOut, aborted);
      if (aborted.aborted) return;

      // 4. Replay board events + pause for impact (skip for negated — no board change)
      await this.replayAndPause(negated, aborted);
      if (aborted.aborted) return;

      // 5. Cleanup resolving state + signal ready — overlay stays off.
      //    The next MSG_CHAIN_SOLVING is what re-shows it (Effect B).
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

  /**
   * Apply the pulse glow (or negated shake) to the resolving link.
   *
   * Slot positioning is handled implicitly by the `visibleCards` computed:
   * the resolving link is by definition the most recent link on its side
   * (chain resolution is top-down, so the newest of each side resolves
   * first), and the computed sorts by chainIndex DESC within a side, so
   * the resolving link always lands at `slot: 'front'` of its side.
   * No explicit glide animation is needed.
   */
  private applyResolvingPulse(chainIndex: number, negated: boolean): void {
    if (negated) {
      this.negatedResolvingIndex.set(chainIndex);
      this.resolvingIndex.set(-1);
    } else {
      this.resolvingIndex.set(chainIndex);
    }
    // Bounded `_pulseActive` window — gates `overlayActive` during the
    // VISIBLE part of the resolution (pulse + hold + fade-out). Clears
    // automatically at total = pulse + hold + overlayFadeOut so the
    // replay scheduler can never deadlock waiting on it.
    const hold = this.duelCtx.scaledDuration(OVERLAY_ANIM_HOLD_MS, OVERLAY_ANIM_HOLD_MIN_MS);
    const tail = this.durations().overlayFadeOut;
    const pulseWindow = this.durations().pulse + hold + tail;
    this._pulseActive.set(true);
    this.scheduleTimeout(() => this._pulseActive.set(false), pulseWindow);
    // Fade-out overlay after the pulse anim completes + a breathing-room
    // hold. Board stays free while we wait for MSG_CHAIN_SOLVED — which
    // can be blocked by an opponent prompt (SELECT_CARD targeting from
    // the resolving effect, etc.). Idempotent vs `onChainLinkResolved`
    // step 3 (which also hides) — both converge on `overlayVisible=false`.
    this.scheduleTimeout(() => {
      this.overlayVisible.set(false);
    }, this.durations().pulse + hold);
  }

  // ---------------------------------------------------------------------------
  // Chain end
  // ---------------------------------------------------------------------------

  private onChainEnd(): void {
    this.overlayVisible.set(false);
    this.clearAllTimers();
    // β.3 Lot 1b — drop every pending "wait for overlay-show ready"
    // effect. A chain that ends before any link's overlay-show
    // readiness fires (e.g. very fast negation chain that resolves
    // before the cost animation completes — pathological but legal)
    // must not leave effects dangling: they would fire on the NEXT
    // chain's readiness flip and pop stale overlays. (β.3 red-team
    // finding #10) sweep the whole map — multiple in-flight links
    // can each carry their own pending effect.
    this._overlayShowEffectRefs.forEach(ref => ref.destroy());
    this._overlayShowEffectRefs.clear();
    this._resolutionStarted.set(false);
    this._resolvingInFlight.set(false);
    this._exitPulseInFlight.set(false);
    this._pulseActive.set(false);
    this.exitingCard.set(null);
    this.pendingExitCard.set(null);
    this.resolvingIndex.set(-1);
    this.negatedResolvingIndex.set(-1);
    this._resolvingCardInfo.set(null);
    this._resolvingNegated.set(false);
    this._pendingEntry.set(null);
    this._pendingEnterIndex = -1;
    this._pendingShoveIndex = -1;
    // Clear the live entering / shoved signals too (the pending-* fields
    // above are for entries that haven't fired yet ; these two are for
    // entries that ALREADY fired but whose clear timer hadn't expired).
    // Without this, `overlayActive` (which tracks `enteringCardIndex !== -1`)
    // would stay true after chain end until the bounded clear timer ticks.
    this.enteringCardIndex.set(-1);
    this.shovedCardIndex.set(-1);
    this.gatePending.set(false);
    this._frozenLinks.set(null);

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
