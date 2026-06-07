import { computed, signal, type Signal } from '@angular/core';

import {
  syncAfterBoardState,
  type AnimationDataSource,
  type QueueDirective,
  type QueueEntry,
} from '../duel-page/animation-data-source';
import { DuelEventProcessor } from '../duel-page/duel-event-processor';
import { DuelLogCategory, type DuelLogger } from '../duel-page/duel-logger';
import { RenderedBoardStateService, type BoardStateView } from '../duel-page/rendered-board-state.service';
import { swapBoardState } from '../board-state-swap';
import { chainingMsgsToLinkStates } from '../duel-page/chain-state-restore.utils';
import type { HintContext, Prompt, StreamEvent } from '../types';
import type {
  BoardStateMsg, BoardStatePayload, CardInfo, ConfirmCardsMsg, HintMsg, Player,
  SelectCardMsg, SelectChainMsg,
  SelectCounterMsg, SelectSumMsg, SelectTributeMsg, SelectUnselectCardMsg,
  ServerMessage, WinMsg,
  ReplayStreamAutoResponse, ReplayStreamNavEntry,
} from '../duel-ws.types';
import { duelAssert } from '../../../core/utilities/duel-assert';

/**
 * Anim-pipeline v4 Phase 1 — read-only data source for replay playback.
 *
 * `MockDuelConnection` is the v4 replacement for `ReplayDuelAdapter`. It
 * implements the same `AnimationDataSource` contract as `DuelConnection`
 * (PvP/SOLO) so the animation pipeline (orchestrator + managers + queue
 * runner + chain overlay) runs through the SAME code path in both modes.
 * The only difference is the source of messages : a pre-computed
 * `ReplayStream` instead of a live WS frame.
 *
 * **Phase 1 scope** : design + standalone test. NOT branched into
 * `replay-page` yet. Wiring happens in Phase 3 ; `seekToOffset` is a
 * stub here and lands in Phase 4 ; the full removal of `ReplayDuelAdapter`
 * lands in Phase 5.
 *
 * **Doctrine** : keep this class pure data layer. No DOM access, no
 * `setTimeout`, no UI scheduling. The auto-respond / auto-advance loop
 * lives in a dedicated `ReplayTransportService`-equivalent (Phase 3).
 *
 * **Dispatch contract** : `dispatchNext()` reproduces the subset of
 * `DuelConnection.handleMessage` that matters in replay :
 *   - perspective swap (`boardStateAfter` per-event snapshot + top-level
 *     `BOARD_STATE.data`)
 *   - routing-table dispatch for the replay-pertinent types (GAME_EVENT,
 *     SELECT_*, MSG_CHAINING / MSG_CHAIN_END / MSG_CONFIRM_CARDS, BOARD_STATE).
 *
 * Types out of replay scope (`DICE_*`, `DUEL_STARTING`, `SESSION_*`,
 * `REMATCH_*`, `TIMER_STATE`, `INACTIVITY_WARNING`, `EARLY_DECK_PREFETCH`,
 * …) are deliberately skipped — they belong to live PvP bootstrap +
 * matchmaking, not playback. An unknown type logs a `warn` ; the dispatch
 * is fail-soft.
 *
 * See `_bmad-output/planning-artifacts/anim-pipeline-v4-replay-unification-2026-06-05.md`
 * and the companion `replay-adapter-inventory-2026-06-05.md` for the full
 * design rationale.
 */
export class MockDuelConnection implements AnimationDataSource {

  // ══════════════════════════════════════════════════
  //  AnimationDataSource contract — pass-through to processor + rbs
  // ══════════════════════════════════════════════════

  private readonly _logger?: DuelLogger;

  readonly processor: DuelEventProcessor;
  private readonly rbs = new RenderedBoardStateService();
  readonly renderedBoardState = this.rbs;
  readonly boardStateView: BoardStateView = this.rbs;

  readonly animationQueue;
  readonly activeChainLinks;
  readonly chainPhase;
  readonly hasPendingChainEntry;
  readonly pendingChainEntry;
  /** Data-layer surface — mirror of `DuelConnection._slots[].pendingPrompt`
   *  (itself baseline-allowed). Not a pipeline projection ; the α.1
   *  signal-tagging rule targets pipeline-internal state. */
  // why: data-layer public surface, not a pipeline projection.
  // eslint-disable-next-line skytrix-pipeline/pipeline-signal-tagged
  readonly pendingPrompt = signal<Prompt | null>(null);

  // ─── v4 Phase 5 (2026-06-05) — UI-facing surfaces formerly on adapter ────
  //
  // Mirror of the `_lastHint` / `lastConfirmedCards` accumulators in
  // `replay-precompute.ts:runReplayPreComputation` (server side). The
  // client mock tracks the same state from incoming MSG_HINT /
  // MSG_CONFIRM_CARDS messages so `pvp-prompt-dialog` (a shared PvP
  // component) gets identical inputs in replay as in live PvP. Cleared
  // when a SELECT_* is dispatched (consumed by the prompt) or when
  // `seekToOffset` / `reset` is called.

  /** Last MSG_HINT seen since the previous SELECT_* — the next prompt's
   *  hint context. Cleared on SELECT_* dispatch + on seek. */
  private readonly _transport_lastHint = signal<HintContext | null>(null);
  /** Last MSG_CONFIRM_CARDS payload — the next prompt's confirmed-cards
   *  context. Cleared on SELECT_* dispatch + on seek. */
  private readonly _transport_lastConfirmedCards = signal<CardInfo[] | null>(null);

  /**
   * `busy` — true while the animation pipeline is dispatching events
   * (queue non-empty OR active prompt waiting). Read by the transport
   * scheduler to gate auto-advance. Replaces `adapter.busy()` exactly :
   * the legacy adapter's busy flag was true while its step queue had
   * un-dispatched steps OR an active decision ; here the equivalent is
   * "animation queue not yet drained" + "prompt waiting".
   */
  readonly busy: Signal<boolean> = computed(() =>
    this.animationQueue().length > 0 || this.pendingPrompt() !== null);

  /** The player index of the currently-shown prompt (mirror of
   *  `adapter.activePlayer`). Derived from `pendingPrompt.player`. */
  readonly activePlayer: Signal<Player> = computed(() => {
    const p = this.pendingPrompt();
    return (p && 'player' in p ? (p as { player: Player }).player : 0) as Player;
  });

  /** The hint context associated with the currently-shown prompt (mirror
   *  of `adapter.activeHint`). Surfaced by the prompt-dialog header.
   *  Captured from MSG_HINT messages dispatched since the previous
   *  SELECT_*. */
  readonly activeHint: Signal<HintContext | null> = this._transport_lastHint.asReadonly();

  /** The confirmed-cards context associated with the currently-shown
   *  prompt (mirror of `adapter.activeConfirmedCards`). Captured from
   *  MSG_CONFIRM_CARDS messages dispatched since the previous SELECT_*. */
  readonly activeConfirmedCards: Signal<CardInfo[] | null> = this._transport_lastConfirmedCards.asReadonly();

  /**
   * The pre-recorded player response data for the currently-shown
   * prompt (mirror of `adapter.activeResponse`). Surfaced by
   * `pvp-prompt-dialog` to show what the original player picked. Read
   * from `autoResponses[cursor]` ; null if the current cursor doesn't
   * point at an answered prompt (e.g. seek landed off a prompt boundary).
   */
  readonly activeResponse: Signal<Record<string, unknown> | null> = computed(() => {
    if (this.pendingPrompt() === null) return null;
    const offset = this._transport_messageCursor();
    // The prompt was dispatched at offset `offset - 1` (the cursor
    // already advanced past it inside `dispatchNext`). Lookup the
    // auto-response at that earlier offset.
    const ar = this.getAutoResponseAt(offset - 1);
    return ar ? ar.data : null;
  });

  private _outOfBandSink?: (event: StreamEvent) => void;

  constructor(options: {
    logger?: DuelLogger;
    /** Same pattern as `DuelConnection.options.duelCtx` (PR2 c4.4 SOLO
     *  multiplex). Replay precompute arrives in absolute P0 order ; when
     *  the viewer perspective flips to 1, `BOARD_STATE.data` and the
     *  per-event `boardStateAfter` snapshots must be swapped before the
     *  processor / orchestrator consume them. Omit to disable swap. */
    duelCtx?: { perspective(): Signal<0 | 1> };
  } = {}) {
    this._logger = options.logger;
    this._duelCtx = options.duelCtx;
    this.processor = new DuelEventProcessor();
    this.processor.logger = options.logger;
    this.rbs.logger = options.logger;
    this.animationQueue = this.processor.animationQueue;
    this.activeChainLinks = this.processor.activeChainLinks;
    this.chainPhase = this.processor.chainPhase;
    this.hasPendingChainEntry = this.processor.hasPendingChainEntry;
    this.pendingChainEntry = this.processor.pendingChainEntry;
  }

  dequeueAnimation(): QueueEntry | null {
    return this.processor.dequeueAnimation();
  }

  removeAnimationAt(index: number): void {
    this.processor.removeAnimationAt(index);
  }

  prependToQueue(entries: QueueEntry[]): void {
    this.processor.prependToQueue(entries);
  }

  enqueueDirective(directive: QueueDirective): void {
    this.processor.enqueueDirective(directive);
  }

  setAnimating(_animating: boolean): void {
    // Phase 1 — no-op. The `ReplayDuelAdapter` used this hook to drive its
    // `advanceStep` step queue ; in v4 the auto-advance loop lives in the
    // (future) transport scheduler which polls `mockConn.messageCursor` +
    // `orchestrator.isAnimating()` directly. Phase 3 wires that scheduler.
  }

  applyChainSolving(chainIndex: number): void {
    this.processor.applyChainSolving(chainIndex);
  }

  applyChainSolved(chainIndex: number): void {
    this.processor.applyChainSolved(chainIndex);
  }

  applyChainEnd(): void {
    this.processor.applyChainEnd();
  }

  attachOutOfBandSink(sink: (event: StreamEvent) => void): void {
    this._outOfBandSink = sink;
    this.processor.onEvent = sink;
  }

  // ══════════════════════════════════════════════════
  //  Perspective swap — mirror of DuelConnection SOLO multiplex (c4.4)
  // ══════════════════════════════════════════════════

  private readonly _duelCtx?: { perspective(): Signal<0 | 1> };

  private _currentPerspective(): 0 | 1 {
    return this._duelCtx?.perspective()() ?? 0;
  }

  private _maybeSwapBoardState(bs: BoardStatePayload): BoardStatePayload {
    return swapBoardState(bs, this._currentPerspective());
  }

  private _maybeSwapBoardStateAfter(message: ServerMessage): void {
    const perspective = this._currentPerspective();
    if (perspective === 0) return;
    const m = message as { boardStateAfter?: BoardStatePayload };
    if (!m.boardStateAfter) return;
    m.boardStateAfter = swapBoardState(m.boardStateAfter, perspective);
  }

  // ══════════════════════════════════════════════════
  //  Mock-specific API (Phase 1.3) — stream + dispatch + cursor
  // ══════════════════════════════════════════════════

  /** Mutable internal stream buffer. Grows via `appendChunk` so the
   *  transport scheduler can start dispatching as soon as the first chunk
   *  arrives, without waiting for the precompute to finish. */
  private readonly _messages: ServerMessage[] = [];
  /** Auto-respond payloads keyed by their global offset in `_messages`. */
  private readonly _autoResponses = new Map<number, ReplayResponse>();
  /** Nav entries accumulated incrementally. Reactive signal so the
   *  transport scheduler (Phase 3) can compute the target offset for a
   *  step-forward operation against the latest known nav data. */
  private readonly _transport_navIndex = signal<ReplayStreamNavEntry[]>([]);
  /** Total expected messages — set by `loadStreamInit` once the precompute
   *  finishes. Null until then ; the transport must NOT assume the stream
   *  is complete unless this is set. */
  private _totalMessages: number | null = null;
  private readonly _transport_messageCursor = signal(0);
  /** Position of the next message to dispatch in the message buffer.
   *  Reactive so the transport scheduler can `effect()` on cursor changes. */
  readonly messageCursor: Signal<number> = this._transport_messageCursor.asReadonly();
  /** Read-only view of the navIndex accumulated so far. */
  readonly navIndex: Signal<ReadonlyArray<ReplayStreamNavEntry>> = this._transport_navIndex.asReadonly();

  /** Length of the message buffer ingested so far (NOT the cursor — the
   *  cursor is where dispatch has reached, this is where data has landed). */
  bufferedMessageCount(): number {
    return this._messages.length;
  }

  /** Total expected messages once `REPLAY_STREAM_INIT` lands. Null before
   *  then — the transport must not flip to "stream complete" state until
   *  this is set AND `cursor === totalMessages`. */
  totalMessages(): number | null {
    return this._totalMessages;
  }

  /** Append a chunk of messages + their auto-responses + their nav entries
   *  to the internal buffer. Idempotent on the cursor (does not reset it).
   *  Called by `ReplayConnectionService` on every `REPLAY_STREAM_CHUNK`. */
  appendChunk(chunk: {
    messages: ServerMessage[];
    autoResponses: ReplayStreamAutoResponse[];
    navEntries: ReplayStreamNavEntry[];
  }): void {
    // F21/F22 diag (2026-06-07) — trace chunk arrivals to debug precompute
    // streaming. Stall is reproduced with only 1 chunk received → either
    // worker precompute crashes after turn 0, or the routing drops chunks.
    console.warn('[F21] appendChunk turn? +%dmsg +%dnav now: %dmsg %dnav',
      chunk.messages.length, chunk.navEntries.length,
      this._messages.length + chunk.messages.length,
      this._transport_navIndex().length + chunk.navEntries.length);
    for (const m of chunk.messages) this._messages.push(m);
    for (const ar of chunk.autoResponses) {
      this._autoResponses.set(ar.offset, { promptType: ar.promptType, data: ar.data });
    }
    if (chunk.navEntries.length > 0) {
      this._transport_navIndex.update(arr => [...arr, ...chunk.navEntries]);
    }
  }

  /** Finalise the stream — sets the expected total. Called by
   *  `ReplayConnectionService` on `REPLAY_STREAM_INIT`. */
  loadStreamInit(init: { totalMessages: number; navIndex: ReplayStreamNavEntry[] }): void {
    this._totalMessages = init.totalMessages;
    // Replace navIndex with the authoritative final list (in case any
    // chunk lost an entry — defensive, should be equivalent to the
    // incremental accumulation by construction).
    this._transport_navIndex.set([...init.navIndex]);
  }

  /**
   * @internal — test-only convenience. Production code uses the chunked
   * path (`appendChunk` + `loadStreamInit`) wired via
   * `ReplayConnectionService.onStreamChunk` / `onStreamInit`. Kept on the
   * class (rather than extracted into `__test__`) because Karma stubs
   * already type against `MockDuelConnection` ; moving it would refactor
   * ~5 spec sites for marginal benefit. F13 (2026-06-06 adversarial review)
   * accepted as documentation debt.
   *
   * Loads a complete stream in one shot. Resets the cursor and replaces
   * all buffered data.
   */
  loadStream(stream: ReplayStream): void {
    this._messages.length = 0;
    this._autoResponses.clear();
    for (const m of stream.messages) this._messages.push(m);
    for (const [offset, resp] of stream.autoResponses) this._autoResponses.set(offset, resp);
    this._transport_navIndex.set(stream.navIndex ? [...stream.navIndex] : []);
    this._totalMessages = stream.messages.length;
    this._transport_messageCursor.set(0);
  }

  /** Lookup an auto-response for a given offset. Returns null if none. */
  getAutoResponseAt(offset: number): ReplayResponse | null {
    return this._autoResponses.get(offset) ?? null;
  }

  /** Dispatches the message at the current cursor as if a WS frame just
   *  landed. Returns `true` if a message was dispatched, `false` if the
   *  cursor is at end (or no stream loaded).
   *
   *  The dispatch reproduces the subset of `DuelConnection.handleMessage`
   *  pertinent to replay : perspective swap on `boardStateAfter` →
   *  routing to processor / pendingPrompt / rbs.updateLogical /
   *  observeBoundary. PvP-only message types (DICE_*, DUEL_STARTING,
   *  SESSION_*, REMATCH_*, TIMER_STATE, INACTIVITY_WARNING,
   *  EARLY_DECK_PREFETCH, OPPONENT_*) are skipped silently — they have
   *  no replay equivalent. Unknown types log a warn. */
  dispatchNext(): boolean {
    if (this._transport_messageCursor() >= this._messages.length) return false;
    const msg = this._messages[this._transport_messageCursor()];
    this._dispatch(msg);
    this._transport_messageCursor.update(n => n + 1);
    return true;
  }

  /** Simulates a player response to the current prompt. Mirror of the
   *  `DuelConnection.sendResponse` clearing side-effects, scoped to what
   *  replay consumes (no actual WS send, no `_slots[]` write-back). */
  simulatePlayerResponse(_response: ReplayResponse): void {
    this.pendingPrompt.set(null);
    // v4 Phase 5 — clear hint + confirmed-cards accumulators after the
    // prompt-dialog has had its chance to read them. Mirrors the
    // `lastHint = null ; lastConfirmedCards = null` lines in
    // `replay-precompute.ts` after the decision is captured.
    this._transport_lastHint.set(null);
    this._transport_lastConfirmedCards.set(null);
  }

  /**
   * Phase 4 (2026-06-05) — restore the rendered + chain state to the nav
   * entry at the given INDEX into `navIndex` (NOT a raw byte offset —
   * matches the `boardStates: PreComputedState[]` index in legacy land).
   *
   * Mirror of `ReplayDuelAdapter.jumpToState` (replay-duel-adapter.ts:373) :
   *   1. `processor.reset()` — wipe queue + activeChainLinks + chainPhase
   *   2. `rbs.updateLogical(swapBs(navEntry.boardStateSnapshot))`
   *   3. `rbs.commitAll('mock:seekToOffset')` — committed state matches
   *   4. If `navEntry.chainSnapshot` is present, restore via the SHARED
   *      `chainingMsgsToLinkStates` + `processor.restoreChainState` +
   *      conditional `processor.applyChainSolving` (F9-bis shared helper)
   *   5. Set `messageCursor` to `navEntry.messageOffset`
   *   6. Clear `pendingPrompt` — a seek through a prompt was clearly
   *      "abandon answer" UX
   *
   * **Caller contract** : the component is expected to have already
   * invoked `orchestrator.resetForReplaySeek()` (dispatches
   * `{PERSPECTIVE_LIFETIME}` to every `ResetTarget` manager) BEFORE
   * calling this method, just like `abortAndClean → transport.seek`
   * does today with the legacy adapter. The mock does NOT touch the
   * orchestrator — single responsibility.
   *
   * No-op if `navIndex` is empty (stream hasn't started) or `index` is
   * out of range.
   */
  seekToOffset(index: number): void {
    const nav = this._transport_navIndex();
    if (index < 0 || index >= nav.length) {
      this._logger?.log(DuelLogCategory.PIPELINE,
        'mock.seekToOffset: skip out-of-range index=%d navLen=%d', index, nav.length);
      return;
    }
    const entry = nav[index];
    this._logger?.log(DuelLogCategory.PIPELINE,
      'mock.seekToOffset: index=%d → cursor=%d label=%s hasChainSnapshot=%s',
      index, entry.messageOffset, entry.label, !!entry.chainSnapshot);

    // 1. Wipe processor (queue + activeChainLinks + chainPhase)
    this.processor.reset();
    // 2. Restore board state ; apply perspective swap on consumption
    const swapped = this._maybeSwapBoardState(entry.boardStateSnapshot);
    this.rbs.updateLogical(swapped);
    // 3. Commit so rendered === logical at the seek target
    this.rbs.commitAll('mock:seekToOffset');
    // 4. Restore chain state if the nav entry was captured mid-chain
    if (entry.chainSnapshot) {
      const negatedSet = new Set(entry.chainSnapshot.negatedIndices);
      const links = chainingMsgsToLinkStates(entry.chainSnapshot.links, negatedSet);
      this.processor.restoreChainState(links, entry.chainSnapshot.phase);
      if (entry.chainSnapshot.currentSolvingChainIndex !== null) {
        this.processor.applyChainSolving(entry.chainSnapshot.currentSolvingChainIndex);
      }
    }
    // 5. Move cursor — subsequent dispatchNext picks up from this offset
    this._transport_messageCursor.set(entry.messageOffset);
    // 6. Clear any prompt visible at the source location + drop the
    //    accumulators (mirror of `simulatePlayerResponse` clearing,
    //    appropriate since a seek through a prompt is "abandon answer").
    this.pendingPrompt.set(null);
    // F7 (2026-06-06) — restore the hint accumulator from the nav entry's
    // embedded snapshot. The precompute pins `entry.hint` whenever a hint
    // was armed at flush time (cleared on `playerResponses[]` consumption).
    // Without this restore, a seek that lands on a SELECT_* nav entry
    // would render the prompt-dialog with `activeHint = null` even though
    // sequential playback would have set it via the prior MSG_HINT dispatch.
    this._transport_lastHint.set(entry.hint ?? null);
    this._transport_lastConfirmedCards.set(null);
  }

  /** Idempotent cleanup. Mirrors `DuelConnection.cleanup` (rbs.destroy is
   *  null-safe) and `ReplayDuelAdapter.ngOnDestroy`. Safe to call multiple
   *  times. F12 (2026-06-06) — now wired in `replay-page.ngOnDestroy` ; the
   *  legacy "0 caller in production" was a leak documented in the
   *  adversarial review.
   *
   *  Clears every piece of state so a future fork-solo round-trip (Phase
   *  7.5) that swaps `mockConn ↔ realConn` doesn't carry the previous
   *  stream into the next instance. The reactive signals are reset to
   *  their initial values rather than left dangling. */
  cleanup(): void {
    this.rbs.destroy();
    this._messages.length = 0;
    this._autoResponses.clear();
    this._transport_navIndex.set([]);
    this._transport_messageCursor.set(0);
    this._totalMessages = null;
    this.pendingPrompt.set(null);
    this._transport_lastHint.set(null);
    this._transport_lastConfirmedCards.set(null);
  }

  // ══════════════════════════════════════════════════
  //  Internal — handleMessage subset for replay
  // ══════════════════════════════════════════════════

  private _dispatch(message: ServerMessage): void {
    this._logger?.log(DuelLogCategory.PIPELINE, 'mock.dispatch type=%s', message.type);
    this._maybeSwapBoardStateAfter(message);

    if (message.type === 'BOARD_STATE') {
      this._handleBoardState(message as BoardStateMsg);
      return;
    }

    // v4 Phase 5 — MSG_HINT accumulates into `_lastHint`. Mirrors the
    // server-side `lastHint` capture in `replay-precompute.ts` (which
    // sets `decision.hint = lastHint` on prompt feed). The next
    // SELECT_* consumes this accumulator and clears it.
    if (message.type === 'MSG_HINT') {
      const hint = message as HintMsg;
      this._transport_lastHint.set({
        hintType: hint.hintType,
        player: hint.player,
        value: hint.value,
        cardName: hint.cardName,
      });
      // MSG_HINT is also a chain-pipeline message — let the processor see it
      // for downstream consumers (chain-state-tracker, etc).
      this.processor.processMessage(message);
      return;
    }

    if (SELECT_MODAL_TYPES.has(message.type)) {
      this._handleSelectModal(message as
        SelectCardMsg | SelectChainMsg | SelectTributeMsg
        | SelectSumMsg | SelectUnselectCardMsg | SelectCounterMsg);
      return;
    }

    if (SELECT_SIMPLE_TYPES.has(message.type)) {
      this._handleSelectSimple(message as Extract<Prompt, { player: 0 | 1 }>);
      return;
    }

    if (CHAIN_PIPELINE_TYPES.has(message.type) || GAME_EVENT_TYPES.has(message.type)) {
      // v4 Phase 5 — MSG_CONFIRM_CARDS additionally feeds the
      // `_lastConfirmedCards` accumulator (mirror of the server
      // `lastConfirmedCards` capture in replay-precompute.ts).
      if (message.type === 'MSG_CONFIRM_CARDS') {
        this._transport_lastConfirmedCards.set((message as ConfirmCardsMsg).cards);
      }
      this.processor.processMessage(message);
      return;
    }

    // F2/F4 (2026-06-06) — MSG_WIN parity with PvP `_handleDuelEnd`. The
    // OCG-emitted MSG_WIN landed in the replay stream (precompute ingests
    // it as the duel ends). PvP live: server converts MSG_WIN → DUEL_END
    // at the WS boundary, then the client synthesizes a MSG_WIN onto the
    // EventStream via `_outOfBandSink` + closes Chain/Phase/Turn via
    // `forceBoundaryClosure('DuelEnded')`. Replay path now mirrors that:
    // push MSG_WIN onto the EventStream so DuelGameLogService renders the
    // 🏆 line, then force-close boundaries in causality order so the
    // journal sees `…events… → MSG_WIN → ChainEnded → PhaseEnded → TurnEnded`.
    if (message.type === 'MSG_WIN') {
      this._outOfBandSink?.(message as WinMsg);
      this.processor.forceBoundaryClosure('DuelEnded');
      return;
    }

    // Skip-list : message types that exist in the protocol but have no
    // replay-side semantic. They never appear in a properly-precomputed
    // replay stream — if one shows up, the precompute filter has a hole.
    if (REPLAY_IGNORED_TYPES.has(message.type)) {
      this._logger?.log(DuelLogCategory.PIPELINE,
        'mock.dispatch: skipping replay-irrelevant type=%s', message.type);
      return;
    }

    this._logger?.warn('MockDuelConnection: unhandled message type=%s', message.type);
  }

  private _handleBoardState(message: BoardStateMsg): void {
    const data = this._maybeSwapBoardState(message.data);
    // F3 (2026-06-06) — wire `syncAfterBoardState` to mirror the PvP
    // tier semantics. Without this, BOARD_STATE arrivals in replay only
    // updated logical state (no syncRendered / syncPileCounts), leaving
    // DECK/EXTRA pile counts + global metadata stale between events
    // (regression doctrinale documented in
    // `_bmad-output/planning-artifacts/anim-pipeline-v4-adversarial-findings-2026-06-06.md`
    // — F3). `boardActive=true` in replay (the pre-activation buffer flow
    // is PvP-only — the replay page configures `isBoardActive: () => true`
    // at mount), so tier 1 (`!boardActive` bootstrap branch) is dead code
    // here ; tier 2 / 3 / 4 fire identically to PvP.
    //
    // Note : `syncAfterBoardState` calls `rbs.updateLogical(data)` itself
    // internally (modulo the Option N skip during resolving + queue !=0).
    // The legacy explicit `rbs.updateLogical(data)` call is gone — it
    // would have double-updated, bypassing Option N.
    syncAfterBoardState(this.rbs, this.processor.chainPhase(),
      this.animationQueue().length, data, /*boardActive*/ true);
    this.processor.observeBoardState(data);
  }

  private _handleSelectModal(
    message: SelectCardMsg | SelectChainMsg | SelectTributeMsg
      | SelectSumMsg | SelectUnselectCardMsg | SelectCounterMsg,
  ): void {
    this.processor.processMessage(message);
    // Palier 0 parity — only SELECT_CARD belongs on the EventStream
    // (game-log builder's secondary MSG_BECOME_TARGET resolver). Mirror of
    // DuelConnection._handleSelectModal.
    if (message.type === 'SELECT_CARD') this._outOfBandSink?.(message);
    duelAssert(message.player === 0 || message.player === 1,
      'MockDuelConnection._handleSelectModal',
      `expected message.player ∈ {0,1}, got ${message.player}`);
    this.pendingPrompt.set(message);
  }

  private _handleSelectSimple(message: Extract<Prompt, { player: 0 | 1 }>): void {
    this.processor.processMessage(message);
    duelAssert(message.player === 0 || message.player === 1,
      'MockDuelConnection._handleSelectSimple',
      `expected message.player ∈ {0,1}, got ${message.player}`);
    this.pendingPrompt.set(message);
  }
}

// ══════════════════════════════════════════════════
//  Replay stream contract
// ══════════════════════════════════════════════════

export interface ReplayResponse {
  promptType: string;
  data: Record<string, unknown>;
}

/**
 * Phase 1 back-compat shape for `loadStream()` — a single-shot batch load
 * used by unit tests. Phase 3 production path uses `appendChunk` +
 * `loadStreamInit` instead, which take the Phase 2 wire types directly.
 */
export interface ReplayStream {
  /** Linear sequence of server messages, in the order a live PvP worker
   *  would emit them (events first, BOARD_STATE confirms). */
  messages: ServerMessage[];
  /** Auto-respond payloads, keyed by the cursor offset of the SELECT_*
   *  message they answer. The transport scheduler reads this map after
   *  each `dispatchNext()` to decide whether to arm a `setTimeout` for
   *  `simulatePlayerResponse`. */
  autoResponses: Map<number, ReplayResponse>;
  /** Optional seek index — uses the Phase 2 wire shape. */
  navIndex?: ReadonlyArray<ReplayStreamNavEntry>;
}

// ══════════════════════════════════════════════════
//  Message-type sets (mirror of DuelConnection's _XXX_TYPES static lists)
// ══════════════════════════════════════════════════
//
// Kept in sync with `duel-connection.ts` by inspection. Drift is detectable
// by `unhandled message type` warns in the mock + the existing
// `duel-connection.spec.ts` coverage on the PvP side. If the PvP list
// grows, mirror the addition here.

const SELECT_MODAL_TYPES: ReadonlySet<string> = new Set([
  'SELECT_CARD', 'SELECT_CHAIN', 'SELECT_TRIBUTE', 'SELECT_SUM',
  'SELECT_UNSELECT_CARD', 'SELECT_COUNTER',
]);

const SELECT_SIMPLE_TYPES: ReadonlySet<string> = new Set([
  'SELECT_IDLECMD', 'SELECT_BATTLECMD', 'SELECT_EFFECTYN', 'SELECT_YESNO',
  'SELECT_PLACE', 'SELECT_DISFIELD', 'SELECT_POSITION', 'SELECT_OPTION',
  'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_NUMBER',
  'SORT_CARD', 'SORT_CHAIN', 'ANNOUNCE_CARD',
]);

const CHAIN_PIPELINE_TYPES: ReadonlySet<string> = new Set([
  'MSG_CHAINING', 'MSG_CHAIN_END',
  'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED', 'MSG_CHAIN_NEGATED',
]);

const GAME_EVENT_TYPES: ReadonlySet<string> = new Set([
  'MSG_MOVE', 'MSG_SET', 'MSG_SHUFFLE_HAND', 'MSG_SHUFFLE_DECK',
  'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
  'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_BECOME_TARGET',
  'MSG_SWAP', 'MSG_ATTACK', 'MSG_BATTLE',
  'MSG_TOSS_COIN', 'MSG_TOSS_DICE', 'MSG_EQUIP',
  'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER',
  'MSG_SHUFFLE_SET_CARD', 'MSG_SWAP_GRAVE_DECK',
  'MSG_DRAW', 'MSG_CONFIRM_CARDS',
]);

/** Server message types intentionally skipped in replay : they belong to
 *  live PvP bootstrap / matchmaking / per-WS lifecycle and would never
 *  appear in a faithful precompute. Listed explicitly so a future addition
 *  to the protocol doesn't silently produce `unhandled message type`
 *  warnings on legitimate skips. */
const REPLAY_IGNORED_TYPES: ReadonlySet<string> = new Set([
  'SESSION_TOKEN', 'SESSION_PHASE',
  'DUEL_STARTING', 'DUEL_END',
  'DICE_ROLL', 'DICE_RESULT',
  'SELECT_FIRST_PLAYER', 'FIRST_PLAYER_RESULT',
  'DECK_PREFETCH', 'EARLY_DECK_PREFETCH',
  'TIMER_STATE', 'INACTIVITY_WARNING', 'WAITING_RESPONSE',
  'OPPONENT_DISCONNECTED', 'OPPONENT_RECONNECTED',
  'REMATCH_INVITATION', 'REMATCH_CANCELLED', 'REMATCH_STARTING',
  'STATE_SYNC', 'CHAIN_STATE',
  // MSG_WIN is NOT here — F2/F4 (2026-06-06) routes it via the explicit
  // branch in `_dispatch` so it reaches the EventStream + closes boundaries
  // identically to PvP `_handleDuelEnd`.
  'ERROR',
]);
