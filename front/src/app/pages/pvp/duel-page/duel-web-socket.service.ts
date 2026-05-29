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
import { duelAssert } from '../../../core/utilities/duel-assert';

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

  /** γ Option C PR2 c5b — Set to `true` by `SoloDuelOrchestratorService.init()`
   *  on the SOLO multiplex path. Branches the `slotIndex()` helper
   *  (perspective-driven in SOLO, ownPlayerIndex-driven in PvP normal) and
   *  the c5c `sendXxx forPlayer` tagging.
   *
   *  Tag α.1 `soloModeSource` — `@Environment` input from the SOLO orchestrator
   *  (cf. CLAUDE.md "Pipeline Signal Tagging Convention"). Read-only from the
   *  pipeline's POV ; the SOLO orchestrator writes via `.set(true)` at init.
   *
   *  Signal (not plain boolean) by design (BH-2 c5b code review) : the 4
   *  per-perspective computeds (pendingPrompt, hintContext, inactivityWarning,
   *  waitingForOpponent) read this via `slotIndex()`. A plain boolean flip
   *  would NOT invalidate the computeds — the SOLO branch would be silently
   *  unreachable until ANOTHER tracked dep (perspective / ownPlayerIndex)
   *  changed. With a signal, the `init()` flip alone re-evaluates the
   *  computeds correctly. */
  readonly soloModeSource = signal(false);

  private readonly _defaultConnection: DuelConnection;

  // γ commit 4 — `_activeConnection` replaced by `_transports[perspective()]`.
  // Default (PvP-normal): both slots = defaultConnection, so reads behave
  // identically to the legacy code. SOLO overrides via `bindTransports`.
  // _transport_*: per α.1 tagging convention, internal transport state.
  private readonly _transport_connections: ReturnType<typeof signal<[DuelConnection, DuelConnection]>>;

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
    // γ c5b — _defaultConnection moved from field init to ctor so we can pass
    // `{ duelCtx }`. The c4.4 BOARD_STATE swap assertion (BH-3 patch) throws
    // when `soloMode=true` and ctor `duelCtx` is undefined ; in PvP normal
    // soloMode stays false so the swap branch never runs, but passing the
    // ctx here makes the wiring uniform and keeps any future c4.4 invariant
    // honest if a non-SOLO consumer ever needs the swap path.
    this._defaultConnection = new DuelConnection(
      environment.wsUrl, true, undefined, this.logger, { duelCtx: this.duelCtx },
    );
    this._transport_connections = signal<[DuelConnection, DuelConnection]>(
      [this._defaultConnection, this._defaultConnection],
    );
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
  //  γ Option C PR2 c5b — slot indexing
  // ───────────────────────────────────────────────

  /** γ c5b — SOLO orchestrator API to flip into multiplex mode. Mirror of
   *  `DuelContext.setPerspective` pattern. Called by
   *  `SoloDuelOrchestratorService.init()` at c6 ; PvP normal / replay never
   *  call this. */
  setSoloMode(value: boolean): void {
    this.soloModeSource.set(value);
  }

  /** γ c5b A39 resolution — slot index for per-perspective reads.
   *  - **PvP normal / replay** : `ownPlayerIndex` (the absolute server
   *    identity of the viewer). `DuelContext.perspective()` stays at 0
   *    in these modes, so reading it would mis-route P1 prompts to slot 0.
   *  - **SOLO multiplex** : `perspective()` (the visual slot that flips
   *    on user switch). The 2 server identities are both projected onto
   *    one connection ; the viewer choice picks which slot's accumulators
   *    surface to the UI.
   *
   *  Narrowed via `duelAssert` rather than mutating the `DuelContext`
   *  typing (`ownPlayerIndex(): number`) — defensive at the call site.
   *  Prod fall-through clamp (`idx === 1 ? 1 : 0`) replaces `as 0|1` so
   *  a post-assert prod survival path returns a valid slot index even if
   *  a future bug emits a non-0/1 value (BH-3 c5b code review patch). */
  private slotIndex(): 0 | 1 {
    if (this.soloModeSource()) return this.duelCtx.perspective()();
    const idx = this.duelCtx.ownPlayerIndex();
    duelAssert(idx === 0 || idx === 1, 'DuelWebSocketService.slotIndex',
      `ownPlayerIndex must be 0 or 1, got ${idx}`);
    return idx === 1 ? 1 : 0;
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
    //
    // c6a — when `t0 === t1` (SOLO multiplex mono-connection), the second
    // assignment would overwrite the first → every STATE_SYNC would log as
    // `via transport 1` which mis-tags the log line in mono-conn dedup
    // measurements. Detect the mono-conn case and bind once with a neutral
    // tag. The dedup measurement is moot in mono-conn (only 1 STATE_SYNC
    // per duel) but we keep the log line accurate.
    if (t0 === t1) {
      t0.onStateSync = (msg) => { this.checkpointLog(msg, 0); this.onStateSync?.(msg); };
    } else {
      t0.onStateSync = (msg) => { this.checkpointLog(msg, 0); this.onStateSync?.(msg); };
      t1.onStateSync = (msg) => { this.checkpointLog(msg, 1); this.onStateSync?.(msg); };
    }
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

  // --- Transport-local — per-perspective (A8 + A39 c5b) ---
  // The 4 signals that live in `PerspectiveSlot` (c4.1/c4.2). Route through
  // `getXxxFor(slotIndex())()` so PvP normal reads `_slots[ownPlayerIndex]`
  // (absolute) and SOLO multiplex reads `_slots[perspective()]` (visual).
  // Cf. A39 resolution in checklist Commit 5.
  readonly pendingPrompt = computed(() => this.active().getPendingPromptFor(this.slotIndex())());
  readonly hintContext = computed(() => this.active().getHintContextFor(this.slotIndex())());
  readonly inactivityWarning = computed(() => this.active().getInactivityWarningFor(this.slotIndex())());
  readonly waitingForOpponent = computed(() => this.active().getWaitingForOpponentFor(this.slotIndex())());

  // --- Transport-local — global (single source per DuelConnection) ---
  // Not per-slot per A8 inventory (spec §4.3). `firstPlayerResult` +
  // `firstPlayerResponseSent` are dead in SOLO (no dice/RPS phase) — kept
  // wired for PvP normal.
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

  /** γ c5c A21 — sendside `forPlayer` tag. Distinct from `slotIndex` (read-side)
   *  because the semantics differ : sendside tags a payload for the SERVER
   *  (A2 strict validation rejects `forPlayer` from PvP normal), readside
   *  indexes a slot for the UI.
   *  - **PvP normal / replay** : `undefined` — the server's A2 validation
   *    rejects any `forPlayer` present in non-SOLO mode.
   *  - **SOLO multiplex** : `perspective()()` — the visual slot the user
   *    currently sees. The 2 server identities are both projected onto one
   *    connection ; the tag tells the server which identity the response /
   *    surrender / rematch / etc. applies to. */
  private sendForPlayer(): 0 | 1 | undefined {
    return this.soloModeSource() ? this.duelCtx.perspective()() : undefined;
  }

  connect(wsToken: string): void {
    this.active().connect(wsToken);
  }

  sendResponse(promptType: string, data: ResponseData): void {
    this.active().sendResponse(promptType, data, this.sendForPlayer());
  }

  // γ c5b A8 + A39 — per-slot (PerspectiveSlot c4.1). PvP normal reads
  // slot[ownPlayerIndex] (= 0 in practice), SOLO reads slot[perspective()].
  get lastSelectedCards(): import('../duel-ws.types').CardInfo[] {
    return this.active().getLastSelectedCardsFor(this.slotIndex());
  }

  get lastConfirmedCards(): import('../duel-ws.types').CardInfo[] {
    return this.active().getLastConfirmedCardsFor(this.slotIndex());
  }

  // γ c5b — `_confirmedCardsByChain` is keyed by `chainIndex` (global per
  // A8 inventory). Not per-slot ; lookup goes through `active()` unchanged.
  confirmedCardsForChainIndex(idx: number | null): import('../duel-ws.types').CardInfo[] {
    return this.active().confirmedCardsForChainIndex(idx);
  }

  clearDiceResult(): void {
    this.active().clearDiceResult();
  }

  sendSurrender(): void {
    this.active().sendSurrender(this.sendForPlayer());
  }

  sendCancelPromptSequence(): void {
    this.active().sendCancelPromptSequence(this.sendForPlayer());
  }

  sendRequestStateSync(): void {
    this.active().sendRequestStateSync(this.sendForPlayer());
  }

  sendRematchRequest(): void {
    this.active().sendRematchRequest(this.sendForPlayer());
  }

  sendActivityPing(): void {
    this.active().sendActivityPing(this.sendForPlayer());
  }

  /** γ c5c A37 — ANIMATIONS_DONE fallback. The server's animations-done
   *  gate (`ctx.pendingPlayer === playerIndex`) needs to know WHICH SOLO
   *  identity finished its animations, but the user has no "current prompt"
   *  context when this fires (it's emitted after the queue drains, not in
   *  response to a SELECT_*). Three-level fallback in SOLO :
   *
   *  1. `_lastSentForPlayer` (A9 memoize) — set by the last `_tagForPlayer`
   *     call on the DuelConnection. Cheapest + most accurate when a recent
   *     PLAYER_RESPONSE / surrender / rematch tagged a slot.
   *  2. `timerState().pendingPlayer` (A37 server populate, c5a) — set by
   *     `scheduleTimerStart` server-side ; the server knows which identity
   *     it's waiting on even if no client send happened recently.
   *  3. `perspective()()` last-resort — covers bootstrap (first turn before
   *     any send) + early switch race. Not as authoritative but never wrong
   *     for a duel that just started.
   *
   *  PvP normal sends `undefined` — A2 strict validation rejects forPlayer
   *  presence in PvP. */
  sendAnimationsDone(): void {
    if (!this.soloModeSource()) {
      this.active().sendAnimationsDone(undefined);
      return;
    }
    const forPlayer = this.active().lastSentForPlayer
      ?? this.active().timerState()?.pendingPlayer
      ?? this.duelCtx.perspective()();
    this.active().sendAnimationsDone(forPlayer);
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
