import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DuelConnection, ResponseData } from './duel-connection';
import { wireConnectionDebugSinks } from './duel-connection-wiring';
import { DebugLogService } from './debug-log.service';
import { DuelLogger } from './duel-logger';
import { DuelCardArtService } from './duel-card-art.service';
import type { AnimationDataSource, QueueDirective, QueueEntry } from './animation-data-source';
import type { StreamEvent } from '../types';
import { DuelContext } from './duel-context';
import { duelAssert } from '../../../core/utilities/duel-assert';
import { WebSocketFactoryService } from './websocket-factory.service';

export { ResponseData } from './duel-connection';

/**
 * γ Option C PR2 c8 (2026-05-29) — `_transports` pair + `_sharedProcessor`
 * dropped after the c6a single-connection refactor consolidated SOLO
 * multiplex onto one `DuelConnection`. The wsService now holds a single
 * `_connection: WritableSignal<DuelConnection>` :
 *
 *  ── PvP normal (default) ──
 *     The ctor creates a default `DuelConnection` and seeds
 *     `_transport_connection` with it. `RoomStateMachineService.connect`
 *     calls `wsService.connect(wsToken)` which delegates to it.
 *
 *  ── SOLO ──
 *     `SoloDuelOrchestratorService.init()` creates the SOLO conn and
 *     calls `bindSoloConnection(conn)` (c8) which `_connection.set(conn)`
 *     + re-applies any registered sinks (out-of-band, draw-new-turn,
 *     onStateSync). The old `bindSharedProcessor` + `bindTransports` pair
 *     is gone — one method does both atomically.
 *
 *  The cardinal γ invariant holds : a `switchPerspective()` no longer
 *  routes WS messages to a different processor — there's only one
 *  connection now, hence only one processor. The viewer flip reads
 *  `_slots[perspectiveSlot()]` on the same connection.
 *
 * **Replay**: this service is NOT used by `ReplayPageComponent` (the
 * replay-page uses `ReplayDuelAdapter` directly). c8 leaves replay
 * untouched.
 */
@Injectable()
export class DuelWebSocketService implements AnimationDataSource, OnDestroy {
  private readonly debugLog = inject(DebugLogService);
  private readonly logger = inject(DuelLogger);
  private readonly artService = inject(DuelCardArtService);
  private readonly duelCtx = inject(DuelContext);
  /** γ Option C PR2 c7a (A15) — factory indirection for `new WebSocket(url)`
   *  so the SOLO multiplex chain spec can feed frames through a MockWebSocket. */
  private readonly wsFactory = inject(WebSocketFactoryService);

  /** γ Option C PR2 c5b — Set to `true` by `SoloDuelOrchestratorService.init()`
   *  on the SOLO multiplex path. Branches the `perspectiveSlot()` helper
   *  (perspective-driven in SOLO, ownPlayerIndex-driven in PvP normal) and
   *  the c5c `sendXxx forPlayer` tagging.
   *
   *  Tag α.1 `soloModeSource` — `@Environment` input from the SOLO orchestrator
   *  (cf. CLAUDE.md "Signal tagging convention (α.1)" sub-section under
   *  "Animation Pipeline v2"). Read-only from the pipeline's POV ; the SOLO
   *  orchestrator writes via `.set(true)` at init.
   *
   *  Signal (not plain boolean) by design (BH-2 c5b code review) : the 4
   *  per-perspective computeds (pendingPrompt, hintContext, inactivityWarning,
   *  waitingForOpponent) read this via `perspectiveSlot()`. A plain boolean flip
   *  would NOT invalidate the computeds — the SOLO branch would be silently
   *  unreachable until ANOTHER tracked dep (perspective / ownPlayerIndex)
   *  changed. With a signal, the `init()` flip alone re-evaluates the
   *  computeds correctly. */
  readonly soloModeSource = signal(false);

  // γ Option C PR2 c8 — single connection signal. Default value is the
  // PvP-normal connection created in the ctor ; `bindSoloConnection` in
  // SOLO bootstrap swaps it for the SOLO multiplex conn.
  // _transport_*: per α.1 tagging convention, internal transport state.
  private readonly _transport_connection: ReturnType<typeof signal<DuelConnection>>;

  onStateSync?: (msg: import('../duel-ws-system.types').StateSyncMsg) => void;

  /** Palier 0 — EventStream sink (orchestrator's `pushToStream`).
   *  Retained so we can re-apply it on `bindSoloConnection`. */
  private _outOfBandSink?: (event: StreamEvent) => void;
  private _drawNewTurnSink?: (turnPlayer: number, turnCount: number) => void;

  constructor() {
    // PvP-normal default connection. SOLO bootstrap immediately swaps it
    // via `bindSoloConnection`. The PvP-normal conn carries `duelCtx` for
    // BOARD_STATE swap parity (c4.4 BH-3) — never actually triggered in
    // PvP because `soloMode` stays false, but kept uniform.
    const defaultConn = new DuelConnection(
      environment.wsUrl, true, undefined, this.logger,
      { duelCtx: this.duelCtx, wsFactory: this.wsFactory },
    );
    this.applySinks(defaultConn);
    this._transport_connection = signal<DuelConnection>(defaultConn);
  }

  /** U31 (audit-4-modes-2026-06-01) — wires every sink the wsService owns
   *  on a fresh `DuelConnection`. Called once in the ctor (PvP-normal
   *  default conn) and once in `bindSoloConnection` (SOLO multiplex
   *  swap). Previously the two call sites had divergent wiring —
   *  `wireConnectionDebugSinks` was duplicated in the SOLO orchestrator
   *  but the lifecycle sinks (`_outOfBandSink`, `_drawNewTurnSink`,
   *  `onStateSync`) were only re-applied on bind. Adding a 5th sink
   *  required coordinated edits in 3 places ; this method makes it 1. */
  private applySinks(conn: DuelConnection): void {
    wireConnectionDebugSinks(conn, { artService: this.artService, debugLog: this.debugLog });
    if (this._outOfBandSink) conn.attachOutOfBandSink(this._outOfBandSink);
    if (this._drawNewTurnSink) conn.onDrawNewTurn = this._drawNewTurnSink;
    conn.onStateSync = (msg) => { this.onStateSync?.(msg); };
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

  /** γ c5b A39 resolution — which `_slots[0|1]` index the viewer projects
   *  on the active `DuelConnection`.
   *
   *  - **PvP normal / replay** : `ownPlayerIndex` (the absolute server
   *    identity of the viewer). In non-SOLO modes, the server filters
   *    omniscient state per-player, so `_slots[ownPlayerIndex]` is the
   *    only populated slot. `DuelContext.perspective()` stays at 0,
   *    reading it would mis-route P1 prompts to slot 0.
   *  - **SOLO multiplex** : `perspective()` (the visual slot that flips
   *    on user switch). The conn is omniscient and populates BOTH
   *    `_slots[0]` and `_slots[1]` ; the viewer choice picks which
   *    one's accumulators surface to the UI.
   *
   *  γ-c cleanup F-2.1 (audit) — renamed from `slotIndex`. The previous
   *  pair (`slotIndex` for read-side, `sendForPlayer` for send-side) had
   *  near-identical bodies in SOLO and was kept separate for nominal
   *  readability ; the new name describes the role (perspective-driven
   *  slot projection on the conn) and `sendForPlayer` now delegates here
   *  to keep the SOLO branch DRY.
   *
   *  Narrowed via `duelAssert` rather than mutating the `DuelContext`
   *  typing (`ownPlayerIndex(): number`) — defensive at the call site.
   *  Prod fall-through clamp (`idx === 1 ? 1 : 0`) replaces `as 0|1` so
   *  a post-assert prod survival path returns a valid slot index even if
   *  a future bug emits a non-0/1 value (BH-3 c5b code review patch). */
  private perspectiveSlot(): 0 | 1 {
    if (this.soloModeSource()) return this.duelCtx.perspective()();
    const idx = this.duelCtx.ownPlayerIndex();
    duelAssert(idx === 0 || idx === 1, 'DuelWebSocketService.perspectiveSlot',
      `ownPlayerIndex must be 0 or 1, got ${idx}`);
    return idx === 1 ? 1 : 0;
  }

  // ───────────────────────────────────────────────
  //  γ Option C PR2 c8 — SOLO connection bind
  // ───────────────────────────────────────────────

  /** γ Option C PR2 c8 — SOLO only. Swap the wsService's single
   *  `_transport_connection` for the SOLO multiplex conn created by
   *  `SoloDuelOrchestratorService.init()`. Replaces the c6a-era pair
   *  `bindSharedProcessor(conn.processor) + bindTransports(conn, conn)`.
   *
   *  **Caller contract** — `conn` MUST have its `onMessage` / `onResponse`
   *  callbacks wired BEFORE this call (those carry async closures that
   *  depend on caller-side state and aren't owned by the wsService).
   *  Every sink the WSSERVICE owns — debug-log (cardArt/debugLog hooks),
   *  Palier 0 out-of-band, draw-new-turn, onStateSync — is re-applied
   *  here via `applySinks` (U31).
   *
   *  **Default conn cleanup** — the ctor-built default conn is orphaned
   *  by this swap (in SOLO it never receives `connect()`, so no live
   *  WebSocket leaks ; the processor + RBS hold no timers either). We
   *  still call `cleanup()` on it explicitly to release any future
   *  teardown obligation the `DuelConnection` class might add.
   *
   *  PvP-normal never calls this and reads continue against the default
   *  connection created in the ctor. */
  bindSoloConnection(conn: DuelConnection): void {
    // Drop the orphaned default conn first — defensive against future
    // teardown obligations on `DuelConnection` (BlindHunter P2.1 c8).
    const previous = this._transport_connection();
    if (previous !== conn) previous.cleanup();

    this._transport_connection.set(conn);
    this.applySinks(conn);
  }

  /** Active transport for all reads. c8: a single `_transport_connection`
   *  serves both PvP normal (the default conn) and SOLO (the multiplex
   *  conn swapped in via `bindSoloConnection`). */
  private active(): DuelConnection {
    return this._transport_connection();
  }

  // ───────────────────────────────────────────────
  //  Out-of-band sinks (Palier 0 + β.3 cas #13)
  // ───────────────────────────────────────────────

  /** Palier 0 — wire the EventStream sink onto the active connection.
   *  Called by the page at bootstrap with `orchestrator.pushToStream`.
   *  `bindSoloConnection` re-applies the sink onto the SOLO conn when it
   *  swaps in (idempotent). The sink lives on the processor's `onEvent`
   *  callback so `MSG_CHAIN_NEGATED` surfaces in the stream too. */
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
  // c8 — all reads go through `active()` which returns the single
  // `_transport_connection`. Shared-state reads (chain machine, animation
  // queue, board state) live on `active().processor` and `active().renderedBoardState`.
  // Transport-local reads use `getXxxFor(perspectiveSlot())()` so PvP normal
  // reads `_slots[ownPlayerIndex]` (absolute) and SOLO reads
  // `_slots[perspective()]` (visual) on the SAME connection. The
  // `perspectiveSlot` switch is what makes the perspective flip user-visible
  // without re-routing WS messages between processors.

  // --- Shared (processor + RBS) ---
  // c8: `active()` is the single connection ; its processor is the host
  // of the chain machine + animation queue in BOTH modes (PvP normal +
  // SOLO). The old `proc()` indirection (shared processor or fallback)
  // is gone because there's no longer a separate shared instance.
  get renderedBoardState() { return this.active().renderedBoardState; }
  get boardStateView() { return this.active().boardStateView; }
  readonly animationQueue = computed(() => this.active().processor.animationQueue());
  readonly activeChainLinks = computed(() => this.active().processor.activeChainLinks());
  readonly chainPhase = computed(() => this.active().processor.chainPhase());
  readonly hasPendingChainEntry = computed(() => this.active().processor.hasPendingChainEntry());
  readonly pendingChainEntry = computed(() => this.active().processor.pendingChainEntry());

  // --- Transport-local — per-perspective (A8 + A39 c5b) ---
  // The 4 signals that live in `PerspectiveSlot` (c4.1/c4.2). Route through
  // `getXxxFor(perspectiveSlot())()` so PvP normal reads `_slots[ownPlayerIndex]`
  // (absolute) and SOLO multiplex reads `_slots[perspective()]` (visual).
  // Cf. A39 resolution in checklist Commit 5.
  readonly pendingPrompt = computed(() => this.active().getPendingPromptFor(this.perspectiveSlot())());
  readonly hintContext = computed(() => this.active().getHintContextFor(this.perspectiveSlot())());
  readonly inactivityWarning = computed(() => this.active().getInactivityWarningFor(this.perspectiveSlot())());
  readonly waitingForOpponent = computed(() => this.active().getWaitingForOpponentFor(this.perspectiveSlot())());

  /** γ Option C PR2 c6f — explicit per-slot accessor for the switch-player
   *  glow gating. The default `waitingForOpponent` reads the slot of the
   *  current viewer ; this variant lets a SOLO consumer read the OTHER
   *  slot (the one the viewer is NOT looking at) so a banner / glow can
   *  surface "action pending on the slot you can't see, click to switch".
   *  Returns a `Signal<boolean>` — consumer wraps in a computed. */
  waitingForOpponentForSlot(slot: 0 | 1): import('@angular/core').Signal<boolean> {
    return this.active().getWaitingForOpponentFor(slot);
  }

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
  readonly earlyDeckPrefetchReceived = computed(() => this.active().earlyDeckPrefetchReceived());
  readonly rematchState = computed(() => this.active().rematchState());
  readonly rematchStarting = computed(() => this.active().rematchStarting());
  readonly firstPlayerResult = computed(() => this.active().firstPlayerResult());
  readonly firstPlayerResponseSent = computed(() => this.active().firstPlayerResponseSent());
  readonly sessionPhase = computed(() => this.active().sessionPhase());

  readonly canRetry = computed(() => this.active().canRetry());
  readonly totalAutoRetries = computed(() => this.active().totalAutoRetries());

  /** γ Option C PR2 c6g (A32 front) — perspective-agnostic server ERROR
   *  surface. Read by the duel-page toast effect. The ERROR payload is
   *  set by `DuelConnection` case 'ERROR' (c4.4) ; the consumer calls
   *  `clearLastError()` after rendering. Single-user / single-slot in
   *  PvP normal, single-user across the 2 slots in SOLO multiplex
   *  (the message describes WHICH player when relevant via `player`). */
  readonly lastError = computed(() => this.active().lastError());
  clearLastError(): void { this.active().clearLastError(); }
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

  /** γ c5c A21 — sendside `forPlayer` tag. Thin wrapper around
   *  `perspectiveSlot()` : same SOLO value (`perspective()()`), `undefined`
   *  in PvP normal / replay because the server's A2 validation rejects
   *  any `forPlayer` field present in non-SOLO mode.
   *
   *  γ-c cleanup F-2.1 (audit) — delegated to `perspectiveSlot()` to keep
   *  the SOLO branch DRY. Pre-cleanup these two helpers had near-identical
   *  bodies branching on `soloModeSource()`. */
  private sendForPlayer(): 0 | 1 | undefined {
    return this.soloModeSource() ? this.perspectiveSlot() : undefined;
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
    return this.active().getLastSelectedCardsFor(this.perspectiveSlot());
  }

  get lastConfirmedCards(): import('../duel-ws.types').CardInfo[] {
    return this.active().getLastConfirmedCardsFor(this.perspectiveSlot());
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

  /** γ c5c A37 — ANIMATIONS_DONE forPlayer tag.
   *
   *  The server's animations-done gate (`ctx.pendingPlayer === playerIndex`)
   *  needs to know WHICH SOLO identity finished its animations. The caller
   *  (today: `_animationsDoneEffect` in `DuelPageComponent` which fires on
   *  `(pendingPrompt, isAnimating)`) passes `player` as the absolute slot
   *  index of the SELECT_* that triggered the send. By protocol contract,
   *  this is strictly equal to the server's `ctx.pendingPlayer`: the server
   *  set `ctx.pendingPlayer = msg.player` when broadcasting the prompt, the
   *  client reads back `pendingPrompt.player`, the round-trip preserves it.
   *
   *  History — F4 (2026-05-31) replaced a 3-level fallback triangulation
   *  whose sources could legitimately diverge from `pendingPrompt.player`
   *  (stale memoize after a server-driven turn change → ANIMATIONS_DONE
   *  picks the wrong slot → server gate no-op → turn timer never armed).
   *  The explicit `player` argument reads the authoritative value
   *  directly from the caller, no fallback chain needed.
   *
   *  PvP normal sends `undefined` — A2 strict validation rejects forPlayer
   *  presence in PvP. */
  sendAnimationsDone(player: 0 | 1): void {
    const forPlayer = this.soloModeSource() ? player : undefined;
    this.active().sendAnimationsDone(forPlayer);
  }

  /**
   * animations-ready-protocol-2026-06-05 — signal the server that the
   * client has finished its visual setup. Fired by
   * `DuelLoadingEffectsService` once `thumbnailsReady=true`. SOLO
   * multiplex tags `forPlayer: 0` (the only live slot); PvP normal
   * omits the tag (A2 strict — server-side validation rejects PvP
   * payloads carrying `forPlayer`).
   *
   * F4 review — returns `safeSend`'s result so the caller can guard
   * its idempotence flag on a successful send. See
   * `DuelConnection.sendAnimationsReady` JSDoc for the race scenario.
   */
  sendAnimationsReady(): boolean {
    const forPlayer = this.soloModeSource() ? 0 : undefined;
    return this.active().sendAnimationsReady(forPlayer);
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
    // c8 — `active()` is the single connection. In SOLO it's already
    // been cleaned by `SoloDuelOrchestratorService.cleanup()` (cleanup
    // is idempotent — ws.close on a closed socket is a no-op). In PvP
    // normal this is the only cleanup site for `_transport_connection`.
    this.active().cleanup();
  }
}
