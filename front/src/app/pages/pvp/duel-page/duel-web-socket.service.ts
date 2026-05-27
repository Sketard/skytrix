import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DuelConnection, ResponseData } from './duel-connection';
import { DebugLogService } from './debug-log.service';
import { DuelLogger, DuelLogCategory } from './duel-logger';
import { DuelCardArtService } from './duel-card-art.service';
import type { AnimationDataSource, QueueDirective, QueueEntry } from './animation-data-source';
import type { StreamEvent } from '../types';
import type { DuelEventProcessor } from './duel-event-processor';
import { DuelContext } from './duel-context';

export { ResponseData } from './duel-connection';

/**
 * γ commit 4 (2026-05-26) — `_activeConnection` removed (§3.3 spec).
 *
 * Two routing layers depending on the mode :
 *
 *  ── PvP normal (default) ──
 *     `_transports[0] === _transports[1] === _defaultConnection`. The
 *     "active transport" = `_defaultConnection` regardless of perspective
 *     (which is always 0 in PvP). All reads work as before.
 *
 *  ── SOLO ──
 *     `SoloDuelOrchestratorService.init()` calls `bindSharedProcessor(...)`
 *     + `bindTransports(t0, t1)`. The wsService then routes :
 *       · **shared-state reads** (chain machine + animation queue + board
 *         state + cardCodes) → directly from the shared processor /
 *         renderedBoardState — IDENTICAL across the 2 transports.
 *       · **transport-local reads** (pendingPrompt, timerState,
 *         connectionStatus, rematchState, …) → `_transports[perspective()]`
 *         — depends on which identity the viewer is currently inhabiting.
 *
 * The cardinal invariant of γ holds : a `switchPerspective()` no longer
 * routes WS messages to a different processor — both transports kept
 * pushing into the SAME processor all along. Only the read of
 * `transport-local` accumulators flips, which is exactly what the user
 * sees changing visually.
 *
 * **Replay**: this service is NOT used by `ReplayPageComponent` (the
 * replay-page uses `ReplayDuelAdapter` directly). γ commit 4 leaves
 * replay untouched.
 */
@Injectable()
export class DuelWebSocketService implements AnimationDataSource, OnDestroy {
  private readonly debugLog = inject(DebugLogService);
  private readonly logger = inject(DuelLogger);
  private readonly artService = inject(DuelCardArtService);
  private readonly duelCtx = inject(DuelContext);

  private readonly _defaultConnection = new DuelConnection(environment.wsUrl, true, undefined, this.logger);

  // γ commit 4 — `_activeConnection` replaced by `_transports[perspective()]`.
  // Default (PvP-normal): both slots = defaultConnection, so reads behave
  // identically to the legacy code. SOLO overrides via `bindTransports`.
  // _transport_*: per α.1 tagging convention, internal transport state.
  private readonly _transport_connections = signal<[DuelConnection, DuelConnection]>(
    [this._defaultConnection, this._defaultConnection],
  );

  // γ commit 4 — set by `SoloDuelOrchestratorService.init()`. When non-null,
  // the chain-state machine + animation queue reads come from this single
  // processor instance instead of from `active().processor`. PvP-normal
  // leaves it null and falls back to `_defaultConnection.processor`.
  private _sharedProcessor: DuelEventProcessor | null = null;

  onStateSync?: (msg: import('../duel-ws-system.types').StateSyncMsg) => void;

  /** Palier 0 — EventStream sink (orchestrator's `notifyOutOfBandEvent`).
   *  Retained so we can re-apply it on `bindTransports`. */
  private _outOfBandSink?: (event: StreamEvent) => void;
  private _drawNewTurnSink?: (turnPlayer: number, turnCount: number) => void;

  constructor() {
    this._defaultConnection.artService = this.artService;
    this._defaultConnection.onMessage = msg => {
      this.debugLog.logServerMessage(msg);
    };
    this._defaultConnection.onResponse = (promptType, data) => {
      this.debugLog.logPlayerResponse(promptType, data);
    };
    this._defaultConnection.onStateSync = (msg) => {
      this.checkpointLog(msg, 0);
      this.onStateSync?.(msg);
    };
  }

  // ───────────────────────────────────────────────
  //  γ commit 4 — SOLO wiring (replaces setActiveConnection)
  // ───────────────────────────────────────────────

  /** SOLO only. The shared processor lives on
   *  `AnimationOrchestratorService.processor` (commit 2). When set, ALL
   *  chain-state + animation-queue reads route through it, IGNORING
   *  which connection received the WS message. PvP-normal never calls
   *  this and the wsService falls back to `_defaultConnection.processor`. */
  bindSharedProcessor(proc: DuelEventProcessor): void {
    this._sharedProcessor = proc;
  }

  /** SOLO only. Pass the two transport connections in OCGCore-identity
   *  order (`t0` = server identity 0, `t1` = server identity 1). The
   *  wsService re-applies its sinks (out-of-band + draw-new-turn +
   *  onStateSync) on both connections, then routes transport-local
   *  reads via `_transports[perspective()]`.
   *
   *  R1 mitigation (§8 spec) : each transport's `onStateSync` now
   *  emits a PIPELINE log line before forwarding, so the first T4 test
   *  observes the actual interleaving of the 2 STATE_SYNC and the
   *  dedup predicate can be frozen against measurement, not guesswork. */
  bindTransports(t0: DuelConnection, t1: DuelConnection): void {
    this._transport_connections.set([t0, t1]);
    // Re-apply sinks on the (potentially new) connections. Idempotent.
    if (this._outOfBandSink) {
      t0.attachOutOfBandSink(this._outOfBandSink);
      t1.attachOutOfBandSink(this._outOfBandSink);
    }
    if (this._drawNewTurnSink) {
      t0.onDrawNewTurn = this._drawNewTurnSink;
      t1.onDrawNewTurn = this._drawNewTurnSink;
    }
    // R1: log + forward both transports' STATE_SYNC. The SOLO orchestrator
    // wires its own forwarding to `wsService.onStateSync?.()` in `init()`
    // (the existing path) — here we instrument the boundary so the first
    // T4 test observation pinpoints the dedup predicate.
    t0.onStateSync = (msg) => { this.checkpointLog(msg, 0); this.onStateSync?.(msg); };
    t1.onStateSync = (msg) => { this.checkpointLog(msg, 1); this.onStateSync?.(msg); };
  }

  /** γ commit 4 — R1 instrumentation. The PIPELINE category is off by
   *  default; enable via `__skytrixDebug.enableAll()` or the DevHub
   *  toggle to see the trace. Each transport's STATE_SYNC fires this
   *  line BEFORE the upstream callback runs ; consecutive lines on
   *  the same duel are the data point for the dedup predicate
   *  (commit 5). Format kept minimal — we don't speculate on payload
   *  shape until T4 reveals what to gate on. */
  private checkpointLog(msg: { type: string }, transportIdx: 0 | 1): void {
    this.logger.log(
      DuelLogCategory.PIPELINE,
      'wsService.onStateSync via transport %d type=%s', transportIdx, msg.type,
    );
  }

  /** Active transport for transport-local reads. PvP-normal: always
   *  `_defaultConnection`. SOLO: tracks `DuelContext.perspective()`. */
  private active(): DuelConnection {
    return this._transport_connections()[this.duelCtx.perspective()()];
  }

  /** Chain machine + animation queue host. SOLO: the shared processor.
   *  PvP-normal: the default connection's locally-owned processor. */
  private proc(): DuelEventProcessor {
    return this._sharedProcessor ?? this._defaultConnection.processor;
  }

  // ───────────────────────────────────────────────
  //  Out-of-band sinks (Palier 0 + β.3 cas #13)
  // ───────────────────────────────────────────────

  /** Palier 0 — wire the EventStream sink onto the active transport (and
   *  any future one set via `bindTransports`). Called by the page at
   *  bootstrap with `orchestrator.notifyOutOfBandEvent`. In SOLO with a
   *  shared processor, both transports' processors are the SAME, but the
   *  sink lives on the processor's `onEvent` callback — wiring it on the
   *  active transport sets it once on the shared processor. The
   *  `bindTransports` re-wiring is therefore idempotent. */
  attachOutOfBandSink(sink: (event: StreamEvent) => void): void {
    this._outOfBandSink = sink;
    this.active().attachOutOfBandSink(sink);
  }

  attachDrawNewTurnSink(sink: (turnPlayer: number, turnCount: number) => void): void {
    this._drawNewTurnSink = sink;
    this.active().onDrawNewTurn = sink;
  }

  // ───────────────────────────────────────────────
  //  Reads
  // ───────────────────────────────────────────────
  // The big triage of §3.3 : shared-state reads come from `proc()` /
  // `active().renderedBoardState` (both transports share the same
  // processor in SOLO ; in PvP-normal there's only one transport
  // anyway). Transport-local reads come from `active()` — they react
  // to `DuelContext.perspective()` via the `_transport_connections`
  // signal that `active()` reads, so the computed re-evaluates on
  // switch and the UI re-renders prompt / timer / rematch / first
  // player / etc. for the new viewer identity.

  // --- Shared (processor + RBS) ---
  get renderedBoardState() { return this.active().renderedBoardState; }
  get boardStateView() { return this.active().boardStateView; }
  readonly animationQueue = computed(() => this.proc().animationQueue());
  readonly activeChainLinks = computed(() => this.proc().activeChainLinks());
  readonly chainPhase = computed(() => this.proc().chainPhase());
  readonly hasPendingChainEntry = computed(() => this.proc().hasPendingChainEntry());
  readonly pendingChainEntry = computed(() => this.proc().pendingChainEntry());

  // --- Transport-local ---
  readonly pendingPrompt = computed(() => this.active().pendingPrompt());
  readonly hintContext = computed(() => this.active().hintContext());
  readonly timerState = computed(() => this.active().timerState());
  readonly timerStatePerPlayer = computed(() => this.active().timerStatePerPlayer());
  readonly connectionStatus = computed(() => this.active().connectionStatus());
  readonly protocolMismatch = computed(() => this.active().protocolMismatch());
  readonly opponentDisconnected = computed(() => this.active().opponentDisconnected());
  readonly disconnectGraceSec = computed(() => this.active().disconnectGraceSec());
  readonly duelResult = computed(() => this.active().duelResult());
  readonly diceResult = computed(() => this.active().diceResult());
  readonly diceInProgress = computed(() => this.active().diceInProgress());
  readonly ocgPlayerIndex = computed(() => this.active().ocgPlayerIndex());
  readonly cardCodes = computed(() => this.active().cardCodes());
  readonly rematchState = computed(() => this.active().rematchState());
  readonly rematchStarting = computed(() => this.active().rematchStarting());
  readonly inactivityWarning = computed(() => this.active().inactivityWarning());
  readonly waitingForOpponent = computed(() => this.active().waitingForOpponent());
  readonly firstPlayerResult = computed(() => this.active().firstPlayerResult());
  readonly firstPlayerResponseSent = computed(() => this.active().firstPlayerResponseSent());
  readonly sessionPhase = computed(() => this.active().sessionPhase());

  readonly canRetry = computed(() => this.active().canRetry());
  readonly totalAutoRetries = computed(() => this.active().totalAutoRetries());
  readonly justReconnected = computed(() => this.active().justReconnected());

  // ───────────────────────────────────────────────
  //  Delegated methods — route through `active()`
  // ───────────────────────────────────────────────
  // Most mutations target the active transport (sendResponse, sendSurrender,
  // sendActivityPing, …) — those are inherently transport-local (a
  // PLAYER_RESPONSE goes to ONE socket). The chain-machine mutations
  // (applyChainSolving / applyChainSolved / applyChainEnd) also route via
  // `active()` because DuelConnection's `processor` reference IS the shared
  // instance in SOLO — calling `active().applyChainSolving(N)` mutates the
  // same processor regardless of which transport was picked. The queue
  // mutations (dequeueAnimation, prependToQueue, …) likewise reach the same
  // shared queue in SOLO.

  connect(wsToken: string): void {
    this.active().connect(wsToken);
  }

  sendResponse(promptType: string, data: ResponseData): void {
    this.active().sendResponse(promptType, data);
  }

  get lastSelectedCards(): import('../duel-ws.types').CardInfo[] {
    return this.active().lastSelectedCards;
  }

  get lastConfirmedCards(): import('../duel-ws.types').CardInfo[] {
    return this.active().lastConfirmedCards;
  }

  confirmedCardsForChainIndex(idx: number | null): import('../duel-ws.types').CardInfo[] {
    return this.active().confirmedCardsForChainIndex(idx);
  }

  clearDiceResult(): void {
    this.active().clearDiceResult();
  }

  sendSurrender(): void {
    this.active().sendSurrender();
  }

  sendCancelPromptSequence(): void {
    this.active().sendCancelPromptSequence();
  }

  sendRequestStateSync(): void {
    this.active().sendRequestStateSync();
  }

  sendRematchRequest(): void {
    this.active().sendRematchRequest();
  }

  sendActivityPing(): void {
    this.active().sendActivityPing();
  }

  sendAnimationsDone(): void {
    this.active().sendAnimationsDone();
  }

  dequeueAnimation(): QueueEntry | null {
    return this.active().dequeueAnimation();
  }

  removeAnimationAt(index: number): void {
    this.active().removeAnimationAt(index);
  }

  prependToQueue(entries: QueueEntry[]): void {
    this.active().prependToQueue(entries);
  }

  enqueueDirective(directive: QueueDirective): void {
    this.active().enqueueDirective(directive);
  }

  clearAnimationQueue(): void {
    this.active().skipPendingAnimations();
  }

  setBoardActive(active: boolean): void {
    this.active().setBoardActive(active);
  }

  setAnimating(animating: boolean): void {
    this.active().setAnimating(animating);
  }

  applyChainSolving(chainIndex: number): void {
    this.active().applyChainSolving(chainIndex);
  }

  applyChainSolved(chainIndex: number): void {
    this.active().applyChainSolved(chainIndex);
  }

  applyChainEnd(): void {
    this.active().applyChainEnd();
  }

  retryConnection(): void {
    this.active().retryConnection();
  }

  ngOnDestroy(): void {
    this._defaultConnection.cleanup();
  }
}
