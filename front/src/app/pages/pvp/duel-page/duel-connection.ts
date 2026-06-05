import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import { EMPTY_DUEL_STATE, Prompt, HintContext, GameEvent, ConnectionStatus, StreamEvent } from '../types';
import { syncAfterBoardState, type QueueDirective, type QueueEntry } from './animation-data-source';
import { DuelEventProcessor } from './duel-event-processor';
import { DuelLogCategory, type DuelLogger } from './duel-logger';
import { duelAssert } from '../../../core/utilities/duel-assert';
import { RenderedBoardStateService, type BoardStateView } from './rendered-board-state.service';
import { BoardStateMsg, BoardStatePayload, CardInfo, ChainStateMsg, ConfirmCardsMsg, DeckPrefetchMsg, DiceResultMsg, DiceRollPromptMsg, DrawMsg, DuelEndMsg, DuelStartingMsg, EarlyDeckPrefetchMsg, ErrorMsg, FirstPlayerResultMsg, HintMsg, InactivityWarningMsg, OpponentDisconnectedMsg, PROTOCOL_VERSION, RematchCancelledMsg, SelectCardMsg, SelectChainMsg, SelectCounterMsg, SelectFirstPlayerMsg, SelectSumMsg, SelectTributeMsg, SelectUnselectCardMsg, ServerMessage, SessionPhaseMsg, SessionTokenMsg, StateSyncMsg, TimerStateMsg, WaitingResponseMsg, WinMsg } from '../duel-ws.types';
import { chainingMsgsToLinkStates } from './chain-state-restore.utils';
import { swapBoardState } from '../board-state-swap';
import type { WebSocketFactory } from './websocket-factory.service';

export type ResponseData = Record<string, unknown>;

/**
 * F14 (2026-05-31) — STATE_SYNC buffer fallback delay. Server contract:
 * CHAIN_STATE is sent IN THE SAME tick as STATE_SYNC iff
 * `session.activeChainLinks.length > 0`. If CHAIN_STATE never arrives
 * (the empty-chain case), the client flushes the buffered STATE_SYNC
 * after this delay so a no-chain resync still progresses. 100ms is long
 * enough to absorb TCP segmentation on a degraded link (the pair has
 * never been observed split in production) AND short enough that the
 * user perceives no resync lag. Lower-bound = TCP RTT under abnormal
 * conditions ; tunable if real-world telemetry surfaces edge cases.
 */
const STATE_SYNC_FLUSH_MS = 100;

/**
 * γ Option C (PR2 c4.1, 2026-05-28) — per-perspective transport state.
 *
 * In SOLO multiplex (1 socket, 2 perspectives), prompt-flow and reveal-flow
 * state must be tracked per absolute player so a `switchPerspective` flip
 * lets the UI read the slot the user is now looking at. The 8 fields below
 * were previously single instances on `DuelConnection`; they're now indexed
 * by absolute player (0 | 1).
 *
 * `_lastDrawAnnouncedHash` deliberately stays GLOBAL on `DuelConnection`
 * (cf. A33, spec §4.3) — turn dedup is intrinsically global.
 *
 * `_firstPlayerResult` / `_firstPlayerResponseSent` are dead in SOLO (RPS
 * flow skipped); kept GLOBAL for PvP normal simplicity.
 *
 * **Status c4.1 (this commit)**: `_slots[]` is populated via dual-write
 * alongside the legacy fields — neither is the source of truth yet. The
 * single-source bascule happens in c4.2 (handleMessage) + c4.3 (sendResponse).
 */
export interface PerspectiveSlot {
  pendingPrompt: WritableSignal<Prompt | null>;
  hintContext: WritableSignal<HintContext>;
  inactivityWarning: WritableSignal<InactivityWarningMsg | null>;
  waitingForOpponent: WritableSignal<boolean>;
  lastConfirmedCards: CardInfo[];
  lastSelectedCards: CardInfo[];
  lastSelectedPromptType: string | null;
  hintCardConsumed: boolean;
}

function makeEmptySlot(): PerspectiveSlot {
  return {
    pendingPrompt: signal<Prompt | null>(null),
    hintContext: signal<HintContext>({ hintType: 0, player: 0, value: 0, cardName: '' }),
    inactivityWarning: signal<InactivityWarningMsg | null>(null),
    waitingForOpponent: signal<boolean>(false),
    lastConfirmedCards: [],
    lastSelectedCards: [],
    lastSelectedPromptType: null,
    hintCardConsumed: false,
  };
}

/**
 * Data layer for a single duel WebSocket connection.
 * Owns all reactive state (signals) and translates raw server messages into signal updates.
 *
 * ## Chain animation protocol — phase transitions
 *
 * Chain phases flow: idle → building → resolving → idle.
 * Phase transitions are intentionally split across two layers:
 *
 * - **`building`**: set IMMEDIATELY here in handleMessage when the first MSG_CHAINING arrives.
 *   The overlay needs this instantly to show entry animations during chain construction.
 *
 * - **`resolving` / `idle`**: set DEFERRED — NOT in handleMessage, but in applyChainSolving()
 *   and applyChainEnd(), which are called by the AnimationOrchestratorService when it processes
 *   these events from the animation queue.
 *
 * Why? Messages arrive from the server in bursts (all CHAIN_SOLVING/SOLVED/END at once),
 * but the orchestrator processes them sequentially with animation delays. If we set
 * phase='idle' immediately on MSG_CHAIN_END receipt, the overlay sees idle while the
 * orchestrator is still animating CHAIN_SOLVED events — breaking the async overlay contract.
 *
 * ## Pending chain entry mechanism
 *
 * MSG_CHAINING does NOT immediately add links to activeChainLinks. Instead, the link is
 * stored as a "pending entry" and committed later (by SELECT_CHAIN, WAITING_RESPONSE,
 * MSG_CHAIN_SOLVING, or the next MSG_CHAINING). This ensures cards requiring cost payment
 * complete their cost prompts BEFORE appearing in the chain overlay visually.
 *
 * ## Solo mode single connection (γ Option C, PR2 c6+)
 *
 * SOLO multiplex is single-connection — one `DuelConnection` instance serves
 * both perspectives, with prompt-flow state partitioned into `_slots[absolute
 * player]` (cf. PerspectiveSlot interface above). The `sharedProcessor` ctor
 * option (used by pre-PR2 γ when 2 conns shared a processor) was dropped in
 * c8 ; every `DuelConnection` now owns its processor outright.
 *
 * Transport-local state buckets:
 *   - GLOBAL (single instance): `_confirmedCardsByChain` (keyed by chainIndex),
 *     `_lastTurnPlayer`, `_lastTurnCount`, `_lastDrawAnnouncedHash` (A33), the
 *     processor + RBS + signals on this class.
 *   - PER-SLOT (indexed by absolute player, `_slots[0|1]`): pendingPrompt,
 *     hintContext, inactivityWarning, waitingForOpponent, lastConfirmedCards,
 *     lastSelectedCards, lastSelectedPromptType, hintCardConsumed.
 */
/**
 * γ Option C (PR2 c5d, 2026-05-28) — A39-bis MSG_HINT broadcast intra-slot.
 *
 * Hints whose `hintType` falls in this set are broadcast PUBLIC by the
 * server (`message-filter.ts:32` SAFE_PUBLIC_HINT_TYPES) — both players see
 * them regardless of `forPlayer`. The payload carries `message.player =
 * sourcePlayer` (the originator, NOT the destinataire), so the c4.2 routed
 * write `_slots[message.player].hintContext.set(...)` lands in the slot of
 * the ORIGIN. When the viewer reads `_slots[slotIndex()].hintContext` and
 * slotIndex ≠ origin, the public hint is invisible — symptom of A39-bis.
 *
 * Fix : detect a broadcast hint at handleMessage time, write BOTH slots so
 * any reader (PvP normal own, PvP normal opponent-originated, SOLO viewer
 * before/after switch) surfaces the same hint context.
 *
 * Source of truth lives server-side (`duel-server/src/message-filter.ts:32`).
 * Drift risk between front + server is low — the set has been stable since
 * introduction. Synced manually (no script).
 */
const SAFE_PUBLIC_HINT_TYPES: ReadonlySet<number> = new Set([1, 2, 6, 7, 9]);

export class DuelConnection {
  // --- Signals (13 pairs) ---
  // γ Option C (PR2 c4.2, 2026-05-28) — `_pendingPrompt` / `_hintContext` /
  // `_inactivityWarning` / `_waitingForOpponent` removed; their state now lives
  // exclusively in `_slots[message.player]`. The public aliases
  // (`pendingPrompt`, `hintContext`, ...) project `_slots[0]` for legacy
  // PvP-normal equivalence; c5 will re-route the projection via
  // `slotIndex = soloMode ? perspective() : ownPlayerIndex` (A39 resolution).
  private logger?: DuelLogger;
  /** Optional art service for JIT prefetch of revealed card images. Wired from
   *  DuelWebSocketService / SoloDuelOrchestratorService at construction time so
   *  every revealed cardCode is requested once, before its animation lands.
   *  See P3 audit follow-up — opponent decklist no longer pre-fetched upfront. */
  artService?: { prefetchCard(code: number | null | undefined): void };
  /**
   * Palier 0 — sink for events that bypass the animation queue but belong
   * to the duel's logical event stream (Game Log feeds). Wired by
   * `DuelWebSocketService` to `AnimationOrchestratorService.pushToStream`.
   * Three feeders: `processor.onEvent` (MSG_CHAIN_NEGATED), the
   * `SELECT_CARD` prompt branch, and the `DUEL_END` handler (reconstructs
   * a synthetic MSG_WIN from `winner` + `winReasonCode`).
   */
  private _outOfBandSink?: (event: StreamEvent) => void;
  /**
   * Chain state machine + animation queue. Instantiated locally by the
   * ctor in all modes (PvP normal, SOLO multiplex, replay-not-using-this-
   * class). γ Option C c8 dropped the `sharedProcessor` ctor option since
   * SOLO is single-conn now — there's nothing to share with.
   *
   * R8 acté (phase-gamma-spec.md §8) : pas de classe abstraite
   * `DuelTransport`. La même `DuelConnection` se reconfigure via le
   * constructor option. PvP-normal n'est pas impacté.
   */
  // γ commit 4 — exposed (readonly) so `DuelWebSocketService` can resolve
  // chain-state reads (`activeChainLinks`, `chainPhase`, `pendingChainEntry`,
  // `animationQueue`) directly from the processor. PvP-normal default
  // connection: this is its locally-owned processor. SOLO connections:
  // points at the shared `AnimationOrchestratorService.processor`.
  readonly processor: DuelEventProcessor;
  private readonly rbs = new RenderedBoardStateService();
  /** Full RBS — write/control surface used by AnimationDataSource (orchestrator + managers). */
  readonly renderedBoardState = this.rbs;
  /** Read-only view of board state used by component template + non-orchestrator consumers (audit L25). */
  readonly boardStateView: BoardStateView = this.rbs;
  private _timerState = signal<TimerStateMsg | null>(null);
  private _timerStatePerPlayer = signal<[TimerStateMsg | null, TimerStateMsg | null]>([null, null]);
  private _connectionStatus = signal<ConnectionStatus>('connected');
  /** True when the server closed the WS with code 4426 (protocol version
   *  mismatch). Distinct from `_connectionStatus === 'lost'` so the
   *  component can render an actionable "outdated client, please refresh"
   *  banner instead of the generic reconnect overlay. */
  private _protocolMismatch = signal(false);
  private _opponentDisconnected = signal(false);
  private _disconnectGraceSec = signal(0);
  private _duelResult = signal<DuelEndMsg | null>(null);
  // Pre-duel dice + first-player coordinator (since 2026-05-13). Replaces
  // the legacy RPS pre-duel flow; OCGCore in-game RPS is short-circuited
  // server-side via skipRps=true and never reaches the client.
  private _diceResult = signal<DiceResultMsg | null>(null);
  private _diceInProgress = signal(false);
  private _ocgPlayerIndex = signal<0 | 1 | null>(null);
  private _cardCodes = signal<number[]>([]);
  private _rematchState = signal<'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired'>('idle');
  private _rematchStarting = signal(false);
  // γ Option C (PR2 c4.2) — `_inactivityWarning` + `_waitingForOpponent`
  // moved to `_slots[message.player]`. See public alias projection below.
  private _firstPlayerResult = signal<{ goFirst: boolean } | null>(null);
  private _firstPlayerResponseSent = signal(false);
  /** Mount discriminant. `null` until the first SESSION_PHASE message lands
   *  (always second message after SESSION_TOKEN). Frozen after the initial
   *  set — the discriminant is a mount-time decision, not a reactive flag. */
  private _sessionPhase = signal<'PRE_DUEL' | 'DUELING' | 'ENDED' | null>(null);
  private _boardActive = false;

  /**
   * γ Option C (PR2 c4.4, A32) — last `ERROR` message received from the
   * server. Server sends `ERROR` (defined PR1 c1b) for invalid client
   * messages (e.g. SOLO `forPlayer` validation strike). In SOLO multiplex
   * the message is routed-to-0 with `player?: 0|1` indicating which slot
   * the error originated from (PR2 c4.5 server whitelist A28).
   *
   * The connection just surfaces the latest payload; the wsService /
   * duel-page consumer is responsible for toast rendering and clearing.
   * Perspective-agnostic — same surface in PvP normal and SOLO multiplex.
   */
  private _lastError = signal<ErrorMsg | null>(null);

  /**
   * γ Option C (PR2 c4.1, 2026-05-28) — per-perspective transport state.
   * See `PerspectiveSlot` jsdoc above for which fields and why.
   * Indexed by ABSOLUTE player (matches `message.player` from the server,
   * which is absolute per CLAUDE.md "Perspective Convention" §3 — message-filter
   * swaps `players[]` + `turnPlayer` but NOT `.player` / `.controller` internals).
   *
   * Read-side access via `getXxxFor(p)` getters (added below). PvP normal
   * lit `_slots[ownPlayerIndex]` via the `wsService` computeds (c5).
   */
  private readonly _slots: [PerspectiveSlot, PerspectiveSlot] = [makeEmptySlot(), makeEmptySlot()];

  /**
   * γ Option C (PR2 c4.1, A21) — gates SOLO-only behavior (BOARD_STATE
   * swap A17, `forPlayer` tag on outbound sendXxx). Default `false` so
   * PvP normal + replay paths are unaffected.
   *
   * γ-c cleanup F-2.3 (audit) — turned into a getter derived from
   * `_soloModeSource` (typically `wsService.soloModeSource`) so the
   * c8-era "A21 pair flip" pattern (`conn.soloMode = true` +
   * `wsService.setSoloMode(true)` both required, in lock-step) becomes
   * **structurally impossible to break** : there is now ONE source of
   * truth, the signal. Adding a 3rd point of init SOLO (rematch, fork,
   * demo) now only needs to ensure the SAME signal is passed through.
   *
   * Pre-cleanup, this was a public boolean field that the SOLO
   * orchestrator flipped manually before `conn.connect(token)`.
   */
  get soloMode(): boolean {
    return this._soloModeSource?.() ?? false;
  }

  /**
   * γ Option C (PR2 c4.1) — optional injection of `DuelContext` for SOLO
   * multiplex paths that need the current visual perspective (A17 BOARD_STATE
   * swap). PvP normal does not need it and passes `undefined`. Narrow type
   * (only `perspective()`) keeps the contract minimal.
   */
  private readonly _duelCtx?: { perspective(): Signal<0 | 1> };

  /**
   * γ-c cleanup F-2.3 (audit) — optional `soloModeSource` signal that
   * drives the `soloMode` getter. Typically `wsService.soloModeSource`
   * — by sharing the SAME signal, the conn and the wsService can no
   * longer disagree on whether SOLO mode is on.
   *
   * Default `undefined` (PvP normal + replay + legacy tests that bypass
   * the SOLO bootstrap) → `soloMode` returns `false`. The SOLO bootstrap
   * passes the signal via `options.soloModeSource` and the conn projects
   * its value through the getter.
   */
  private readonly _soloModeSource?: Signal<boolean>;

  /**
   * γ Option C (PR2 c7a, A15) — optional `WebSocket` factory indirection
   * used by `openConnection()`. Production callers (`DuelWebSocketService`,
   * `SoloDuelOrchestratorService`) inject `WebSocketFactoryService` and
   * forward it via `options.wsFactory`.
   *
   * Tests EITHER override the Angular token via
   * `TestBed.overrideProvider(WebSocketFactoryService, { useValue: stub })`
   * when exercising the 2 services above (whose `inject()` resolves through
   * TestBed), OR pass `{ wsFactory: stub }` directly when constructing
   * `DuelConnection` by hand (cf. `websocket-factory.service.spec.ts`) —
   * `DuelConnection` is a plain class, NOT in the DI graph, so the TestBed
   * override alone wouldn't reach it.
   *
   * When `undefined`, `new WebSocket(url)` is used (back-compat — the 4
   * existing `duel-connection.spec.ts` sites that bypass `connect()` rely
   * on this default).
   */
  private readonly _wsFactory?: WebSocketFactory;

  // γ Option C (PR2 c4.2) — project slot 0 by default; c5 swaps the read
  // index to `slotIndex(soloMode, perspective, ownPlayerIndex)` (A39).
  readonly pendingPrompt = computed(() => this._slots[0].pendingPrompt());
  readonly hintContext = computed(() => this._slots[0].hintContext());
  // γ commit 2 — these 5 signal aliases (animationQueue, activeChainLinks,
  // chainPhase, hasPendingChainEntry, pendingChainEntry) used to be field
  // initialisers reading `this.processor.X` at class-init time. Now that
  // `processor` is assigned in the constructor (history: was needed to
  // resolve a shared instance via `options.sharedProcessor`, dropped in
  // c8 ; the local-only constructor assignment stays for symmetry with
  // `_duelCtx` and `logger`), TS would flag a use-before-init. Getters
  // defer resolution to first read — by then the constructor has run
  // and `this.processor` points at the final instance.
  get animationQueue() { return this.processor.animationQueue; }
  readonly timerState = this._timerState.asReadonly();
  readonly timerStatePerPlayer = this._timerStatePerPlayer.asReadonly();
  readonly connectionStatus = this._connectionStatus.asReadonly();
  readonly protocolMismatch = this._protocolMismatch.asReadonly();
  readonly opponentDisconnected = this._opponentDisconnected.asReadonly();
  readonly disconnectGraceSec = this._disconnectGraceSec.asReadonly();
  get activeChainLinks() { return this.processor.activeChainLinks; }
  get chainPhase() { return this.processor.chainPhase; }
  readonly duelResult = this._duelResult.asReadonly();
  readonly diceResult = this._diceResult.asReadonly();
  readonly diceInProgress = this._diceInProgress.asReadonly();
  readonly ocgPlayerIndex = this._ocgPlayerIndex.asReadonly();
  readonly cardCodes = this._cardCodes.asReadonly();
  readonly rematchState = this._rematchState.asReadonly();
  readonly rematchStarting = this._rematchStarting.asReadonly();
  // γ Option C (PR2 c4.2) — same projection pattern as pendingPrompt/hintContext.
  readonly inactivityWarning = computed(() => this._slots[0].inactivityWarning());
  readonly waitingForOpponent = computed(() => this._slots[0].waitingForOpponent());
  readonly firstPlayerResult = this._firstPlayerResult.asReadonly();
  readonly firstPlayerResponseSent = this._firstPlayerResponseSent.asReadonly();
  readonly sessionPhase = this._sessionPhase.asReadonly();
  /** γ Option C (PR2 c4.4, A32) — read-only surface for the last server
   *  `ERROR`. Consumer calls `clearLastError()` after rendering the toast. */
  readonly lastError = this._lastError.asReadonly();

  // --- Reconnect state ---
  private _retryCount = signal(0);
  private _totalAutoRetries = signal(0);
  private _hasToken = signal(false);
  private readonly _maxRetries = 6;
  private readonly _autoReconnect: boolean;
  readonly canRetry = computed(() => this._retryCount() < this._maxRetries && this._autoReconnect && this._hasToken());
  readonly totalAutoRetries = this._totalAutoRetries.asReadonly();

  // --- WS internals ---
  private ws: WebSocket | null = null;
  private wsToken: string | null = null;
  private reconnectToken: string | null = null;
  /** Four named timer slots. Use armTimeout/clearTimeoutSlot to manage them —
   *  arming a slot already holding a timer would otherwise leak two concurrent
   *  setTimeouts (handshake retry race, see audit finding H11). F14 adds
   *  `stateSyncFlush` for the STATE_SYNC + CHAIN_STATE atomic buffer fallback. */
  private readonly _timers: {
    connection: ReturnType<typeof setTimeout> | null;
    sessionToken: ReturnType<typeof setTimeout> | null;
    retry: ReturnType<typeof setTimeout> | null;
    stateSyncFlush: ReturnType<typeof setTimeout> | null;
  } = { connection: null, sessionToken: null, retry: null, stateSyncFlush: null };
  private readonly wsUrlBase: string;

  // --- Last selected cards (for excluding from next card-selection prompt) ---
  // Only accumulated within a streak of the same prompt type; resets on type change.
  // γ Option C (PR2 c4.2) — state lives on `_slots[player].lastSelectedCards`;
  // public getter projects slot 0 (c5 swaps to perspective-aware slotIndex).
  get lastSelectedCards(): CardInfo[] { return this._slots[0].lastSelectedCards; }

  // --- Last confirmed/revealed cards (from MSG_CONFIRM_CARDS — excavation/reveal effects) ---
  // Flat buffer = last batch received. Used by SELECT_OPTION lastConfirmedName fallback
  // (pvp-prompt-dialog reads the last reveal regardless of which chain link it came from).
  // γ Option C (PR2 c4.2) — see comment above; slot 0 projection by default.
  get lastConfirmedCards(): CardInfo[] { return this._slots[0].lastConfirmedCards; }

  // M22 — Per-chain-link buffer. MSG_CONFIRM_CARDS arriving while the server is
  // resolving a chain link is tagged with that link's chainIndex; we accumulate
  // them here so the prompt dialog can show ONLY the reveals belonging to the
  // currently-prompting link. Without this, a mid-chain reload (F5) replays the
  // CONFIRMs of an already-resolved link into a later link's prompt header.
  // Cleared on MSG_CHAIN_END (mirrors server-side activeChainLinks reset),
  // STATE_SYNC, DUEL_END, REMATCH_STARTING, sendResponse.
  private _confirmedCardsByChain = new Map<number, CardInfo[]>();
  /** Returns the reveals tagged with the given chainIndex, or the flat buffer
   *  (legacy behavior) when idx is null. Empty array if no entry.
   *  γ Option C (PR2 c4.2) — null branch reads `_slots[0].lastConfirmedCards`
   *  (slot-0 projection by default, c5 will swap to perspective-aware slotIndex). */
  confirmedCardsForChainIndex(idx: number | null): CardInfo[] {
    if (idx === null) return this._slots[0].lastConfirmedCards;
    return this._confirmedCardsByChain.get(idx) ?? [];
  }

  // γ commit 2 — getters (same reason as animationQueue / activeChainLinks /
  // chainPhase above): the processor is now assigned in the constructor.
  get hasPendingChainEntry() { return this.processor.hasPendingChainEntry; }
  get pendingChainEntry() { return this.processor.pendingChainEntry; }

  // --- Hint consumed flag ---
  // Set after a prompt response is sent. Prevents stale cardName from a previous
  // effect from bleeding into unrelated prompts via HINT_SELECTMSG merge.
  // Cleared when a fresh HINT type 10/13/15 (card-identifying hint) arrives.
  // γ Option C (PR2 c4.2) — state lives on `_slots[player].hintCardConsumed`.

  // F14 (2026-05-31) — STATE_SYNC + CHAIN_STATE form a SINGLE semantic
  // operation (atomic resync). The server emits them in the same Node.js
  // tick (reconnect snapshot + cancel rollback), TCP guarantees order, but
  // the client used to apply them one-at-a-time with a wall-clock assert
  // (`sinceSync < 1000ms`) as the only invariant guard. M18's original
  // worry was a "delayed STATE_SYNC reset wiping the restored chain" —
  // structurally impossible because the order is fixed, but the asymmetry
  // (STATE_SYNC resets, CHAIN_STATE restores) left a transient window
  // where the chain state was empty even though it was about to be
  // restored. Any future reader / handler running between the two would
  // observe a corrupted view.
  //
  // The fix: STATE_SYNC stores its payload in `_pendingStateSync` and
  // schedules a fallback timer. CHAIN_STATE consumes the pending payload
  // and applies STATE_SYNC + restoreChainState atomically (same tick).
  // If CHAIN_STATE never arrives (server contract: only sent when there's
  // an active chain to restore — the empty-chain case skips it), the
  // fallback timer applies STATE_SYNC alone.
  private _pendingStateSync: StateSyncMsg | null = null;

  // --- Just-reconnected flag ---
  // Set to true on STATE_SYNC (reconnect), cleared on the first BOARD_STATE after
  // the game resumes. While true, the activation-toggle auto-respond is suppressed
  // so that prompts re-sent by the server after reconnect are shown to the user.
  private _justReconnected = signal(false);
  readonly justReconnected = this._justReconnected.asReadonly();

  // β.3 cas #13 — track the last BOARD_STATE turn coordinates so a MSG_DRAW
  // can detect a turn delta without waiting for the next BOARD_STATE. Boot
  // default `0:0` matches EMPTY_DUEL_STATE — the 5 initial MSG_DRAW will
  // all hash to `0:0` and share a single DRAW announce.
  private _lastTurnPlayer = 0;
  private _lastTurnCount = 0;
  private _lastDrawAnnouncedHash: string | null = null;
  /** SOLO board re-projection cache (2026-06-02) — last BOARD_STATE payload
   *  stored in ABSOLUTE (pre-swap) shape so `onPerspectiveSwitched` can
   *  re-feed it with the new perspective. Null until the first BOARD_STATE
   *  arrives. PvP normal / replay never read this. */
  private _lastAbsoluteBoardState: BoardStatePayload | null = null;

  // --- Callbacks (set by wrapper services) ---
  onMessage?: (msg: ServerMessage) => void;
  onResponse?: (promptType: string, data: ResponseData) => void;
  /**
   * β.3 cas #13 (2026-05-26) — fired when the first `MSG_DRAW` of a new
   * turn arrives. Wired by the UI bridge to `PhaseAnnouncementService.show`
   * so the DRAW banner is enqueued onto the animation queue BEFORE the
   * `MSG_DRAW` itself (the only way to make the announce visually precede
   * the draw animation : the server emits MSG_DRAW first and only later
   * BOARD_STATE delta carries phase=DRAW).
   *
   * Detection : we hash `${turnPlayer}:${turnCount}` from the last
   * observed BOARD_STATE and compare with `_lastDrawAnnouncedHash`.
   * Boot's 5 initial MSG_DRAW share hash `0:0` → one announce. A new
   * turn flips the hash → re-announce.
   */
  onDrawNewTurn?: (turnPlayer: number, turnCount: number) => void;
  /** Fired after the connection-level STATE_SYNC bookkeeping completes.
   *  Carries the raw message so consumers can read `gameLogEntries`
   *  (journal persistence across F5 / reconnect). */
  onStateSync?: (msg: import('../duel-ws-system.types').StateSyncMsg) => void;

  /**
   * Palier 0 — attach the EventStream sink (orchestrator's
   * `pushToStream`). Wires the processor's `onEvent` callback so
   * `MSG_CHAIN_NEGATED` surfaces in the stream too. Idempotent — calling
   * again replaces the previous sink (re-applied by `bindSoloConnection`
   * on a SOLO init or rematch). γ commit 4 dropped `setActiveConnection`,
   * γ Option C c8 collapsed `bindSharedProcessor + bindTransports` into
   * a single `bindSoloConnection`.
   */
  attachOutOfBandSink(sink: (event: StreamEvent) => void): void {
    this._outOfBandSink = sink;
    this.processor.onEvent = sink;
  }

  private readonly storageKey: string;

  constructor(
    wsUrlBase: string,
    autoReconnect: boolean,
    storageKey = 'duel-reconnect-token',
    logger?: DuelLogger,
    options?: {
      /** γ Option C (PR2 c4.1) — passed by `SoloDuelOrchestratorService.init`
       *  in SOLO multiplex so handleMessage can read the current visual
       *  perspective (A17 BOARD_STATE swap). Omitted in PvP normal. */
      duelCtx?: { perspective(): Signal<0 | 1> };
      /** γ Option C (PR2 c7a, A15) — see `_wsFactory` field doc. */
      wsFactory?: WebSocketFactory;
      /** γ-c cleanup F-2.3 (audit) — see `_soloModeSource` field doc.
       *  Typically `wsService.soloModeSource`. Omitted in PvP normal
       *  and legacy tests that bypass the SOLO bootstrap. */
      soloModeSource?: Signal<boolean>;
    },
  ) {
    if (wsUrlBase.startsWith('/')) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.wsUrlBase = `${proto}//${location.host}${wsUrlBase}`;
    } else {
      this.wsUrlBase = wsUrlBase;
    }
    this._autoReconnect = autoReconnect;
    this.storageKey = storageKey;
    this.logger = logger;
    // γ Option C c8 (2026-05-29) — `sharedProcessor` ctor option dropped.
    // SOLO multiplex is single-conn post-c6a so every `DuelConnection`
    // owns its processor outright. The old "2 conns sharing a processor"
    // model died with c6a.
    this.processor = new DuelEventProcessor();
    this.processor.logger = logger;
    this.rbs.logger = logger;
    this._duelCtx = options?.duelCtx;
    this._wsFactory = options?.wsFactory;
    this._soloModeSource = options?.soloModeSource;
    // U20 E3 review-fix : build the routing table here, AFTER `this.processor`
    // is assigned. As a class field initializer this would run BEFORE the ctor
    // body — a future memoization (e.g. `const proc = this.processor; table[t]
    // = (m) => proc.processMessage(m);`) would then read `undefined`. Lazy
    // closures over `this.processor` work either way today, but moving the
    // assignment makes the init-order dependency explicit.
    this._messageHandlers = this._buildHandlerTable();
  }

  clearStorageToken(): void {
    try { localStorage.removeItem(this.storageKey); } catch {}
  }

  // --- Per-perspective slot accessors (γ Option C PR2 c4.1 + c4.2) ---
  // Read-side API used by `DuelWebSocketService` computeds (c5) to project the
  // user's current perspective via `_connection.getXxxFor(slotIndex())()`.
  // PvP normal/replay: callers pass `ownPlayerIndex` → reads `_slots[ownPlayerIndex]`.
  // SOLO multiplex: callers pass `duelCtx.perspective()` (which flips). A39 resolution.
  //
  // c4.2 (this commit): the slots are now the ONLY source of truth. The legacy
  // signals (`_pendingPrompt`, `_hintContext`, `_inactivityWarning`,
  // `_waitingForOpponent`) and legacy fields (`_lastSelectedCards`,
  // `_lastSelectedPromptType`, `_lastConfirmedCards`, `_hintCardConsumed`) are
  // removed. Public aliases project `_slots[0]` (PvP normal equivalence);
  // c5 swaps the projection index to `slotIndex` via wsService computeds.

  getPendingPromptFor(p: 0 | 1): Signal<Prompt | null> { return this._slots[p].pendingPrompt.asReadonly(); }
  getHintContextFor(p: 0 | 1): Signal<HintContext> { return this._slots[p].hintContext.asReadonly(); }
  getInactivityWarningFor(p: 0 | 1): Signal<InactivityWarningMsg | null> { return this._slots[p].inactivityWarning.asReadonly(); }
  getWaitingForOpponentFor(p: 0 | 1): Signal<boolean> { return this._slots[p].waitingForOpponent.asReadonly(); }
  getLastConfirmedCardsFor(p: 0 | 1): CardInfo[] { return this._slots[p].lastConfirmedCards; }
  getLastSelectedCardsFor(p: 0 | 1): CardInfo[] { return this._slots[p].lastSelectedCards; }
  getLastSelectedPromptTypeFor(p: 0 | 1): string | null { return this._slots[p].lastSelectedPromptType; }
  getHintCardConsumedFor(p: 0 | 1): boolean { return this._slots[p].hintCardConsumed; }

  /**
   * γ Option C (PR2 c4.1) — defensive narrowing of `Player` runtime value
   * before indexing `_slots`. Without this guard, a WS payload with `player`
   * set to a value other than 0|1 (smuggled past the TS type) would yield
   * `_slots[undefined]`/`_slots[2]` = `undefined` and crash the message
   * dispatch on the next `.set(...)`. Mirrors the PR1 c1 validator strictness
   * that PR2 c1b deferred to a SOLO read-site assert; promoted forward to
   * c4.1 to chain end-to-end defense as soon as `_slots` exists.
   *
   * `site` is the dispatch case label (for the assertion log).
   */
  private _slotFor(player: number, site: string): PerspectiveSlot {
    duelAssert(player === 0 || player === 1, site, `expected message.player ∈ {0,1}, got ${player}`);
    return this._slots[player as 0 | 1];
  }

  // --- Public API ---

  connect(wsToken: string): void {
    if (this._autoReconnect) {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) this.reconnectToken = stored;
    }
    this.wsToken = wsToken;
    this._retryCount.set(0);
    this._totalAutoRetries.set(0);
    this._hasToken.set(true);

    this.openConnection();
  }

  // Prompt types that form multi-step card selection sequences — accumulate across steps
  private static readonly ACCUMULATE_SELECTION_TYPES = new Set([
    'SELECT_CARD', 'SELECT_TRIBUTE', 'SELECT_SUM', 'SELECT_UNSELECT_CARD',
  ]);

  /**
   * γ Option C (PR2 c4.3, A21) — attach the optional `forPlayer` tag to an
   * outbound ClientMessage payload. PvP normal callers pass `undefined`
   * (the spread produces no field — A2 server validator rejects otherwise).
   * SOLO multiplex callers pass `0|1` (the user's current absolute slot —
   * see `DuelWebSocketService.sendForPlayer` A39 helper at c5).
   */
  private _tagForPlayer<T extends { type: string }>(msg: T, forPlayer: 0 | 1 | undefined): T {
    return forPlayer === undefined ? msg : { ...msg, forPlayer };
  }

  /**
   * γ Option C (PR2 c4.4, A17) — SOLO multiplex BOARD_STATE swap.
   *
   * Returns true when this connection is in SOLO mode AND the user's current
   * visual perspective is 1 (the absolute server P1 — flipped via the SOLO
   * orchestrator's `switchPerspective`). In that case the server's omniscient
   * payloads arrive in absolute P0 order, and `BoardStatePayload.players[]` +
   * `.turnPlayer` must be relativized before any downstream consumer reads them
   * (cf. CLAUDE.md "Perspective Convention" §2 + "Replay Board State Parity").
   *
   * PvP normal and replay both yield false (PvP: `soloMode=false`; replay:
   * uses `ReplayDuelAdapter` directly and never reaches this class). The
   * `_duelCtx` field is injected at construction by the SOLO orchestrator
   * (c6) and absent otherwise.
   */
  private _shouldSwapForSolo(): boolean {
    if (!this.soloMode) return false;
    // BH-3 from c4.4 code review — SOLO mode without `_duelCtx` is a
    // construction-time invariant violation (the orchestrator MUST pass
    // `duelCtx` whenever it flips `soloMode = true`). Asserting here surfaces
    // a wiring bug instead of silently disabling the perspective swap.
    const ctx = this._duelCtx;
    duelAssert(ctx !== undefined, 'shouldSwapForSolo', 'soloMode=true requires duelCtx injection');
    return ctx!.perspective()() === 1;
  }

  private _maybeSwapBoardState(bs: BoardStatePayload): BoardStatePayload {
    return this._shouldSwapForSolo() ? swapBoardState(bs, 1) : bs;
  }

  /**
   * γ Option C (PR2 c4.4, A17) — swap the per-event `boardStateAfter`
   * snapshot in place (shallow-clone the event when a swap is needed).
   * BOARD_CHANGING events emitted during chain resolution carry this
   * snapshot (cf. CLAUDE.md "Per-event boardStateAfter snapshot"). The
   * snapshot is consumed by `AnimationOrchestratorService.processEvent`
   * via `rbs.updateLogical(event.boardStateAfter)`; without swap the SOLO
   * perspective-1 view would briefly flip mid-chain.
   *
   * Mutates `message` in place when a swap is needed (replacing the
   * `boardStateAfter` field). Safe: the message is freshly parsed from
   * the WS frame, nothing else holds a reference.
   */
  private _maybeSwapBoardStateAfter(message: ServerMessage): void {
    if (!this._shouldSwapForSolo()) return;
    const m = message as { boardStateAfter?: BoardStatePayload };
    if (!m.boardStateAfter) return;
    m.boardStateAfter = swapBoardState(m.boardStateAfter, 1);
  }

  sendResponse(promptType: string, data: ResponseData, forPlayer?: 0 | 1): void {
    // F-bugB (2026-05-31) — send-side visibility. `safeSend` only warns on a
    // DROP; a successful PLAYER_RESPONSE left no trace, so a console export
    // could not show whether a decline actually left the socket nor with which
    // `forPlayer` tag (load-bearing in SOLO multiplex). Log before the send so
    // the SELECT_CHAIN re-offer / "Sending…" investigations have outbound data.
    this.logger?.log(DuelLogCategory.PIPELINE,
      'ws.send PLAYER_RESPONSE type=%s forPlayer=%s data=%o', promptType, forPlayer ?? 'none', data);
    if (this.safeSend(this._tagForPlayer({ type: 'PLAYER_RESPONSE', promptType, data }, forPlayer))) {
      // γ Option C (PR2 c4.3, A22) — clear the slot of the responding player.
      // F-bugB3 root-cause fix (2026-05-31) — locate the slot from the
      // pending prompt's own `player` field. The previous fallback `_slots[
      // forPlayer ?? 0]` was wrong in PvP normal for the P1 viewer
      // (`forPlayer === undefined` → cleared slot 0, but P1's prompt lives
      // in `_slots[1]`). The stale slot[1] was then re-read by the dialog
      // after a transient gating closeDialog (visiblePrompt gates behind
      // the animation queue while a phase announcement plays), letting the
      // user submit a duplicate decline that the server dropped as
      // `Unexpected PLAYER_RESPONSE` → modal stuck on "Sending…".
      //
      // The slot per prompt is keyed by `message.player` in the SELECT_*
      // branches of `handleMessage`, so `pendingPrompt.player` is the
      // ground truth. In SOLO multiplex `forPlayer` is always passed (=
      // `perspectiveSlot()`) and wins; this branch only matters for PvP
      // normal where the prompt's player is the unambiguous slot index.
      const slotIdx: 0 | 1 = forPlayer !== undefined
        ? forPlayer
        : ((this._slots[1].pendingPrompt()?.player === 1) ? 1 : 0);
      const slot = this._slots[slotIdx];
      // Capture selected cards before clearing prompt (for excluding from next prompt)
      const prompt = slot.pendingPrompt();
      const accumulate = DuelConnection.ACCUMULATE_SELECTION_TYPES.has(promptType);
      if (prompt && 'cards' in prompt && accumulate) {
        const cards = (prompt as { cards: CardInfo[] }).cards;
        // Reset accumulator when the prompt type changes (e.g. SELECT_UNSELECT_CARD → SELECT_CARD)
        const base = slot.lastSelectedPromptType === promptType ? slot.lastSelectedCards : [];
        slot.lastSelectedPromptType = promptType;
        if ('indices' in data) {
          const indices = data['indices'] as number[];
          slot.lastSelectedCards = [...base, ...indices.map(i => cards[i]).filter(Boolean)];
        } else if ('index' in data && data['index'] != null) {
          const card = cards[data['index'] as number];
          slot.lastSelectedCards = card ? [...base, card] : base;
        }
        // else: no selection change — keep accumulated list
      } else {
        slot.lastSelectedCards = [];
        slot.lastSelectedPromptType = null;
      }
      slot.lastConfirmedCards = [];
      this._confirmedCardsByChain.clear();
      slot.hintCardConsumed = true;
      if (promptType === 'SELECT_FIRST_PLAYER') this._firstPlayerResponseSent.set(true);
      // DICE_ROLL response just left the client; we are now waiting on the
      // server to broadcast DICE_RESULT. Drive `diceInProgress=true` here so
      // the dice arena transitions `'ready'` → `'rolling'`.
      if (promptType === 'DICE_ROLL') this._diceInProgress.set(true);
      this.onResponse?.(promptType, data);
      slot.pendingPrompt.set(null);
      slot.inactivityWarning.set(null);
    }
  }

  sendActivityPing(forPlayer?: 0 | 1): void {
    this.safeSend(this._tagForPlayer({ type: 'ACTIVITY_PING' }, forPlayer));
    // γ Option C (PR2 c4.3) — clear the slot the ping was tagged for (slot 0
    // when `forPlayer === undefined`, mirroring legacy PvP normal).
    this._slots[forPlayer ?? 0].inactivityWarning.set(null);
  }

  sendAnimationsDone(forPlayer?: 0 | 1): void {
    this.safeSend(this._tagForPlayer({ type: 'ANIMATIONS_DONE' }, forPlayer));
  }

  /**
   * animations-ready-protocol-2026-06-05 — signal the server that the
   * client has finished its visual setup (thumbnail prefetch done) and
   * is ready to receive animatable duel events. Gates the worker spawn
   * server-side. Idempotent: re-emits are logged-and-ignored by the
   * server. The PvP-normal vs SOLO/fork-solo discrimination lives in
   * `DuelLoadingEffectsService` (the only caller) — `forPlayer` is
   * tagged when relevant. PvP normal MUST omit the tag (A2 strict
   * server-side validation).
   */
  sendAnimationsReady(forPlayer?: 0 | 1): void {
    this.safeSend(this._tagForPlayer({ type: 'ANIMATIONS_READY' }, forPlayer));
  }

  clearDiceResult(): void {
    this._diceResult.set(null);
  }

  /** γ Option C (PR2 c4.4, A32) — consumer-driven clear after toast render. */
  clearLastError(): void {
    this._lastError.set(null);
  }

  sendSurrender(forPlayer?: 0 | 1): void {
    this.safeSend(this._tagForPlayer({ type: 'SURRENDER' }, forPlayer));
  }

  /**
   * P0-3bis.3 — Roll the duel back to the most recent
   * SELECT_IDLECMD/SELECT_BATTLECMD prompt. The server will re-emit a
   * BOARD_STATE followed by the original prompt; the client stays in a
   * waiting state until the prompt arrives.
   *
   * Triggered by right-click on continuation prompts (SELECT_PLACE,
   * SELECT_DISFIELD, SELECT_POSITION). No-op if no rollback target
   * exists server-side — the server will WARN and ignore.
   */
  sendCancelPromptSequence(forPlayer?: 0 | 1): void {
    this.safeSend(this._tagForPlayer({ type: 'CANCEL_PROMPT_SEQUENCE' }, forPlayer));
  }

  sendRequestStateSync(forPlayer?: 0 | 1): void {
    this.safeSend(this._tagForPlayer({ type: 'REQUEST_STATE_SYNC' }, forPlayer));
  }

  sendRematchRequest(forPlayer?: 0 | 1): void {
    if (this.safeSend(this._tagForPlayer({ type: 'REMATCH_REQUEST' }, forPlayer))) {
      this._rematchState.set('requested');
    }
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

  skipPendingAnimations(): void {
    this.processor.reset();
    this.rbs.commitAll();
  }

  /**
   * γ-c cleanup F-2.2 (audit) — clear perspective-relative dedup state that
   * a SOLO `switchPerspective` invalidates. The `_lastDrawAnnouncedHash`
   * built from `${turnPlayer}:${turnCount}` is post-swap (SOLO BOARD_STATE
   * is swapped via `_maybeSwapBoardState` for perspective=1 — so
   * `_lastTurnPlayer` is the RELATIVE turn-player, not absolute). A switch
   * mid-tour flips the relative turn-player, so the hash no longer matches
   * the new perspective's view of "current turn" and a stale dedup would
   * either re-fire the DRAW announce on the same logical tour (no harm,
   * just visual noise) or silently swallow a fresh tour announce if the
   * old + new perspective coincidentally land on the same hash.
   *
   * Named distinct from `AnimationOrchestratorService.notifyPerspectiveSwitch`
   * (which emits a PerspectiveSwitched stream event + dispatches reset) to
   * keep the two callsites unambiguous in `SoloDuelOrchestratorService`.
   *
   * Called by `SoloDuelOrchestratorService.switchPerspective` AFTER it
   * has flipped `DuelContext.perspectiveSource`. PvP normal + replay
   * never call this. Idempotent — calling again on the same perspective
   * just re-clears a state already cleared.
   */
  onPerspectiveSwitched(): void {
    this._lastDrawAnnouncedHash = null;
    // SOLO board re-projection (2026-06-02). `_maybeSwapBoardState` only
    // fires when a fresh BOARD_STATE arrives over the wire ; if the server
    // is waiting for a response (no new BOARD_STATE coming), the rendered
    // board stays frozen on the pre-switch orientation. Re-feed the cached
    // absolute payload through the swap helper with the now-flipped
    // perspective so the user sees their cards on their side.
    //
    // v3 Phase 5 (2026-06-05) — `isBoardStableForSwitch` gate retired
    // upstream. Safety now comes from the new call ordering in
    // `SoloDuelOrchestratorService.switchPerspective` :
    //   1. The orchestrator's perspective-switch notification runs FIRST.
    //      Its head call is `clearTimersAndPolling()` → `runner.requestStop()`
    //      → `dropOrphanedLocks('runner-requestStop')` (v3 Phase 3). Any lock
    //      held by an in-flight handler at switch-click time is vacated
    //      synchronously inside that call.
    //   2. `conn.onPerspectiveSwitched()` runs AFTER. The `_locks` Map is
    //      provably empty at this point, so `syncRendered()` reads the
    //      empty-locks fast path and lands `_logical` straight to `_rendered`
    //      with no mergeUnlockedZones masking. Mirror of the equivalent replay
    //      seek path (`adapter.jumpToState(currentState)` → `commitAll`).
    if (this._lastAbsoluteBoardState !== null) {
      const reprojected = this._maybeSwapBoardState(this._lastAbsoluteBoardState);
      this.rbs.updateLogical(reprojected);
      this.rbs.syncRendered();
      this._lastTurnPlayer = reprojected.turnPlayer;
    }
  }

  setBoardActive(active: boolean): void {
    this._boardActive = active;
  }

  setAnimating(animating: boolean): void {
    this.logger?.log(DuelLogCategory.DRAW, 'setAnimating(%s)', animating);
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

  resetRematchStarting(): void {
    this._rematchStarting.set(false);
  }

  retryConnection(): void {
    this._retryCount.set(0);
    this._totalAutoRetries.set(0);

    this._connectionStatus.set('reconnecting');
    this.openConnection();
  }

  /**
   * Idempotent teardown. SOLO multiplex tears down a connection from two
   * sites (`SoloDuelOrchestratorService.cleanup` + `wsService.ngOnDestroy`),
   * and the wsService's ctor allocates a default connection that is
   * orphaned + cleaned immediately by `bindSoloConnection` — every call
   * site must tolerate a second invocation without throwing.
   *
   * Today every line below is structurally idempotent (assertNoLocks no-ops
   * on cleared locks, rbs.destroy is null-safe, clearTimeoutSlot is null-safe,
   * the WS close + null-out is gated). The `_destroyed` flag (U29,
   * 2026-06-01) lifts that property from "by inspection" to "by
   * construction" — a future non-null-safe addition (a Datadog counter, a
   * listener removal that throws on missing listener) cannot break the
   * double-cleanup contract without ALSO removing the early-return.
   *
   * See CLAUDE.md "Transport Lifecycle Invariants → Invariant 1".
   */
  private _destroyed = false;

  cleanup(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.rbs.assertNoLocks('cleanup');
    this.rbs.destroy();
    this.clearTimeoutSlot('connection');
    this.clearTimeoutSlot('sessionToken');
    this.clearTimeoutSlot('retry');
    this.clearTimeoutSlot('stateSyncFlush');
    this._pendingStateSync = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  // --- Auto-select methods ---

  private tryAutoRespondEmptyCards(message: SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg | SelectCounterMsg): boolean {
    if (message.cards.length > 0) return false;

    // SELECT_SUM: mustSelect is the primary selection pool, not auto-included.
    // Don't auto-respond if mustSelect has candidates the player must choose from.
    if (message.type === 'SELECT_SUM' && ((message as SelectSumMsg).mustSelect?.length ?? 0) > 0) return false;

    // SOLO multiplex: the conn carries both identities on a single socket — the
    // server routes PLAYER_RESPONSE by the `forPlayer` tag. Pass `message.player`
    // so the auto-respond is attributed to the right slot. Without it, an
    // auto-respond to a `player=1` prompt arrives untagged and the server treats
    // it as `player=0`, logs `Unexpected PLAYER_RESPONSE` and stays blocked on
    // `awaiting=[false, true]` — every downstream prompt (incl. the optional
    // trigger effect window that should follow the interrupt-summon timing) is
    // never emitted. PvP normal MUST pass `undefined` (server's A2 validator
    // rejects a `forPlayer` field present in non-SOLO mode — see `_tagForPlayer`).
    const forPlayer = this.soloMode ? message.player : undefined;
    if (message.type === 'SELECT_CHAIN' || message.type === 'SELECT_UNSELECT_CARD') {
      this.sendResponse(message.type, { index: null }, forPlayer);
    } else if (message.type === 'SELECT_COUNTER') {
      this.sendResponse(message.type, { counters: [] }, forPlayer);
    } else {
      this.sendResponse(message.type, { indices: [] }, forPlayer);
    }
    return true;
  }

  // --- WS lifecycle ---

  private openConnection(): void {
    let url: string;
    if (this.reconnectToken) {
      url = `${this.wsUrlBase}?reconnect=${this.reconnectToken}&pv=${PROTOCOL_VERSION}`;
    } else if (this.wsToken) {
      url = `${this.wsUrlBase}?token=${this.wsToken}&pv=${PROTOCOL_VERSION}`;
    } else {
      this._connectionStatus.set('lost');
      return;
    }

    // γ Option C PR2 c7a (A15) — factory indirection. Default = `new WebSocket(url)`
    // when no factory was injected (PvP normal default conn ; existing tests
    // that bypass `connect()` via `(conn as any).ws = mockWs`).
    this.ws = this._wsFactory ? this._wsFactory.create(url) : new WebSocket(url);

    this.armTimeout('connection', () => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.ws?.close();
        this.handleReconnect();
      }
    }, 5000);

    this.ws.onopen = () => {
      this.clearTimeoutSlot('connection');
      // retryCount and connectionStatus are NOT updated here — only on SESSION_TOKEN.
      // Updating on open would flash 'connected' then snap to 'reconnecting'/'lost'
      // if the server accepts the handshake but immediately closes.
      this._opponentDisconnected.set(false);
      this._rematchStarting.set(false);
      if (!this.reconnectToken) {
        this._rematchState.set('idle');
      }
      // Expect SESSION_TOKEN within 5s after handshake; otherwise force-close and retry.
      this.armTimeout('sessionToken', () => {
        if (this._connectionStatus() !== 'connected') {
          this.ws?.close();
        }
      }, 5000);
    };

    this.ws.onmessage = event => {
      let message: ServerMessage;
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (!isServerMessage(parsed)) {
          this.logger?.log(DuelLogCategory.PROC, 'Dropped malformed WS message: %o', parsed);
          return;
        }
        message = parsed;
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
        return;
      }
      try {
        this.handleMessage(message);
      } catch (e) {
        console.error('handleMessage threw — dropping message:', message.type, e);
      }
    };

    this.ws.onclose = (event) => {
      this.clearTimeoutSlot('connection');
      this.clearTimeoutSlot('sessionToken');
      // 4426 = protocol version mismatch — client bundle is outdated relative
      // to the server. Retrying is pointless (the same `pv` will be rejected
      // again). Wipe tokens, surface via `protocolMismatch` signal so the
      // component renders an actionable "please refresh" banner.
      if (event.code === 4426) {
        this.reconnectToken = null;
        this.wsToken = null;
        try { localStorage.removeItem(this.storageKey); } catch {}
        this._hasToken.set(false);
        this._connectionStatus.set('lost');
        this._protocolMismatch.set(true);
        this.logger?.warn('ws closed — protocol version mismatch (server bundle ahead of client)');
        return;
      }
      // 4029 = rate limited — no point retrying immediately
      if (event.code === 4029) {
        this.reconnectToken = null;
        try { localStorage.removeItem(this.storageKey); } catch {}
        this._hasToken.set(this.wsToken !== null);
        this._connectionStatus.set('lost');
        return;
      }
      // 4001 = invalid/expired token — discard it but let handleReconnect try fallback
      if (event.code === 4001) {
        if (this.reconnectToken) {
          this.reconnectToken = null;
          try { localStorage.removeItem(this.storageKey); } catch {}
        } else {
          this.wsToken = null;
        }
        this._hasToken.set(this.reconnectToken !== null || this.wsToken !== null);
      }
      if (this._connectionStatus() !== 'lost') {
        this.handleReconnect();
      }
    };

    this.ws.onerror = () => {
      // The browser fires `onerror` with an opaque Event (no `.message` /
      // `.code` per WebSocket spec). All we can record is the readyState
      // at the moment of the error — onclose will follow with the close
      // code, which carries the actionable signal. M19: surface the
      // readyState so a connect-vs-disconnect failure isn't silent.
      this.logger?.warn('ws onerror — readyState=%d url=%s', this.ws?.readyState ?? -1, this.wsUrlBase);
    };
  }

  // ===========================================================================
  // U20 (audit-4-modes-2026-06-01) — handleMessage routing table
  //
  // The switch was ~580 LOC with ~30 distinct cases mixing slot routing,
  // processor delegation, signal mutations, and per-case context comments
  // (F-bugB / F10 / F12 / F14 / F19 / U6-D3 / γ-c regression fixes). Each
  // case is now its own private method, owning its context comments. The
  // dispatch is a `Record<string, (msg) => void>` built once in the ctor.
  //
  // The 4 fall-through groups (SELECT modal / SELECT idle / CHAIN pipeline /
  // game-event MSG_*) are preserved by pointing multiple Record entries at
  // the same method — see `_SELECT_MODAL_TYPES`, `_SELECT_SIMPLE_TYPES`,
  // `_CHAIN_PIPELINE_TYPES`, `_GAME_EVENT_TYPES` below.
  //
  // Doctrine : ne PAS DRY-er les méthodes partageant ~80 % de teardown
  // (e.g. DUEL_END + REMATCH_STARTING). Chacune a ses comments load-bearing
  // (spec §4.3, F10/F12, U6-D3) qui doivent rester attached à l'événement
  // sémantique correspondant.
  // ===========================================================================

  /** SELECT prompt types that share the modal-prompt branch (processor +
   *  per-slot pendingPrompt + auto-respond empty-cards + lastSelectedPromptType
   *  reset). */
  private static readonly _SELECT_MODAL_TYPES = [
    'SELECT_CARD', 'SELECT_CHAIN', 'SELECT_TRIBUTE', 'SELECT_SUM',
    'SELECT_UNSELECT_CARD', 'SELECT_COUNTER',
  ] as const;

  /** SELECT / ANNOUNCE / SORT prompt types that share the simple branch
   *  (processor + per-slot pendingPrompt, no auto-respond, no accumulator
   *  reset). These are the "idle phase" prompts (IDLECMD/BATTLECMD) and the
   *  one-shot announces/sorts. */
  private static readonly _SELECT_SIMPLE_TYPES = [
    'SELECT_IDLECMD', 'SELECT_BATTLECMD', 'SELECT_EFFECTYN', 'SELECT_YESNO',
    'SELECT_PLACE', 'SELECT_DISFIELD', 'SELECT_POSITION', 'SELECT_OPTION',
    'ANNOUNCE_RACE', 'ANNOUNCE_ATTRIB', 'ANNOUNCE_NUMBER',
    'SORT_CARD', 'SORT_CHAIN', 'ANNOUNCE_CARD',
  ] as const;

  /** Chain-pipeline MSG_* types that are silently forwarded to the processor
   *  with no extra side-effect (chain state machine drives them). MSG_CHAINING
   *  and MSG_CHAIN_END have their own methods (extra logic). */
  private static readonly _CHAIN_PIPELINE_TYPES = [
    'MSG_CHAIN_SOLVING', 'MSG_CHAIN_SOLVED', 'MSG_CHAIN_NEGATED',
  ] as const;

  /** Game-event MSG_* types forwarded to the processor with no extra
   *  side-effect on the connection. MSG_DRAW, MSG_CONFIRM_CARDS, MSG_CHAINING
   *  have their own methods.
   *
   *  U20 E2 review-fix : MSG_SET added. It was missing from the prior switch
   *  (pre-U20 bug), so face-down Sets were silently dropped — the processor
   *  never saw them and chain-resolution buffering missed them. The animation
   *  orchestrator returns 0 for MSG_SET (no anim — position change handled by
   *  the next BOARD_STATE), but the processor still needs to see it for
   *  buffer-replay semantics during chain resolution. Pre-existing latent
   *  bug, fixed in passing since the routing-table refacto surfaced it via
   *  the new `unhandled-type` warn (the warn would have flooded on every
   *  Set otherwise). */
  private static readonly _GAME_EVENT_TYPES = [
    'MSG_MOVE', 'MSG_SET', 'MSG_SHUFFLE_HAND', 'MSG_SHUFFLE_DECK',
    'MSG_DAMAGE', 'MSG_RECOVER', 'MSG_PAY_LPCOST',
    'MSG_FLIP_SUMMONING', 'MSG_CHANGE_POS', 'MSG_BECOME_TARGET',
    'MSG_SWAP', 'MSG_ATTACK', 'MSG_BATTLE',
    'MSG_TOSS_COIN', 'MSG_TOSS_DICE', 'MSG_EQUIP',
    'MSG_ADD_COUNTER', 'MSG_REMOVE_COUNTER',
    'MSG_SHUFFLE_SET_CARD', 'MSG_SWAP_GRAVE_DECK',
  ] as const;

  /** Routing table built once during construction. Lookup is O(1) by message type.
   *  Unknown types log a `warn` (see `handleMessage` default branch).
   *
   *  U20 E1+E3 review-fix : assigned inside the ctor body (NOT a field
   *  initializer) AFTER `this.processor` is constructed. The closures in
   *  the table reference `this.processor` lazily at dispatch time, which
   *  works today because `connect()` is called from outside the ctor — but
   *  a future memoization refactor (`const proc = this.processor;` inside
   *  `_buildHandlerTable`) would crash with TDZ if the table were a field
   *  initializer. Moving the assignment makes the dependency explicit. */
  private readonly _messageHandlers: Record<string, (msg: ServerMessage) => void>;

  private _buildHandlerTable(): Record<string, (msg: ServerMessage) => void> {
    // U20 E1 review-fix : null-prototype table so a forged message with
    // `type: "constructor"` / `"toString"` / `"hasOwnProperty"` etc. doesn't
    // resolve to `Object.prototype.<name>` and silently invoke an inherited
    // method as if it were a registered handler. `Object.create(null)` strips
    // the prototype chain entirely ; the bracket access `table[message.type]`
    // returns `undefined` for any non-own key, falling through to the warn
    // branch in `handleMessage`.
    const table: Record<string, (msg: ServerMessage) => void> = Object.create(null);
    const entries: Record<string, (msg: ServerMessage) => void> = {
      'BOARD_STATE':           (m) => this._handleBoardState(m as BoardStateMsg),
      'STATE_SYNC':            (m) => this._handleStateSyncBuffer(m as StateSyncMsg),
      'CHAIN_STATE':           (m) => this._handleChainState(m as ChainStateMsg),
      'DICE_ROLL':             (m) => this._handleDiceRoll(m as DiceRollPromptMsg),
      'DICE_RESULT':           (m) => this._handleDiceResult(m as DiceResultMsg),
      'SELECT_FIRST_PLAYER':   (m) => this._handleSelectFirstPlayer(m as SelectFirstPlayerMsg),
      'FIRST_PLAYER_RESULT':   (m) => this._handleFirstPlayerResult(m as FirstPlayerResultMsg),
      'DECK_PREFETCH':         (m) => this._handleDeckPrefetch(m as DeckPrefetchMsg),
      'EARLY_DECK_PREFETCH':   (m) => this._handleEarlyDeckPrefetch(m as EarlyDeckPrefetchMsg),
      'DUEL_STARTING':         (m) => this._handleDuelStarting(m as DuelStartingMsg),
      'MSG_HINT':              (m) => this._handleMsgHint(m as HintMsg),
      'TIMER_STATE':           (m) => this._handleTimerState(m as TimerStateMsg),
      'INACTIVITY_WARNING':    (m) => this._handleInactivityWarning(m as InactivityWarningMsg),
      'DUEL_END':              (m) => this._handleDuelEnd(m as DuelEndMsg),
      'ERROR':                 (m) => this._handleError(m as ErrorMsg),
      'REMATCH_INVITATION':    () => this._handleRematchInvitation(),
      'REMATCH_CANCELLED':     (m) => this._handleRematchCancelled(m as RematchCancelledMsg),
      'REMATCH_STARTING':      () => this._handleRematchStarting(),
      'OPPONENT_DISCONNECTED': (m) => this._handleOpponentDisconnected(m as OpponentDisconnectedMsg),
      'OPPONENT_RECONNECTED':  () => this._handleOpponentReconnected(),
      'WAITING_RESPONSE':      (m) => this._handleWaitingResponse(m as WaitingResponseMsg),
      'SESSION_TOKEN':         (m) => this._handleSessionToken(m as SessionTokenMsg),
      'SESSION_PHASE':         (m) => this._handleSessionPhase(m as SessionPhaseMsg),
      'MSG_CHAINING':          (m) => this._handleMsgChaining(m),
      'MSG_CHAIN_END':         (m) => this._handleMsgChainEnd(m),
      'MSG_CONFIRM_CARDS':     (m) => this._handleMsgConfirmCards(m as ConfirmCardsMsg),
      'MSG_DRAW':              (m) => this._handleMsgDraw(m as DrawMsg),
    };
    Object.assign(table, entries);
    for (const t of DuelConnection._SELECT_MODAL_TYPES) {
      table[t] = (m) => this._handleSelectModal(m as SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg | SelectCounterMsg);
    }
    for (const t of DuelConnection._SELECT_SIMPLE_TYPES) {
      table[t] = (m) => this._handleSelectSimple(m as Extract<ServerMessage, { type: typeof t }>);
    }
    for (const t of DuelConnection._CHAIN_PIPELINE_TYPES) {
      table[t] = (m) => this.processor.processMessage(m);
    }
    for (const t of DuelConnection._GAME_EVENT_TYPES) {
      table[t] = (m) => this.processor.processMessage(m);
    }
    return table;
  }

  private handleMessage(message: ServerMessage): void {
    this.logger?.log(DuelLogCategory.PIPELINE, 'ws.recv type=%s', message.type);
    // γ Option C (PR2 c4.4, A17) — SOLO multiplex receives omniscient (absolute)
    // board states; swap `boardStateAfter` per-event snapshots before any
    // downstream consumer reads them (BH-1 from c4.4 code review: also before
    // `onMessage` debug-log sink, to keep the wire-shape consistent across
    // the whole consumer chain). PvP normal / replay: `soloMode=false` →
    // no-op fast path inside helper. Mirrors `ReplayDuelAdapter.swapEvents`
    // for parity with the replay path.
    this._maybeSwapBoardStateAfter(message);
    this.onMessage?.(message);
    this.prefetchRevealedCards(message);
    const handler = this._messageHandlers[message.type];
    if (handler) {
      handler(message);
    } else {
      // U20 — unknown message type is a true bug (server emitted something
      // the client doesn't model). Warn so the debug harness captures it ;
      // no throw because the old `default: break;` silently swallowed it
      // and we keep that fail-soft behavior in prod.
      this.logger?.warn('handleMessage — unhandled message type: %s', message.type);
    }
  }

  private _handleBoardState(message: BoardStateMsg): void {
    // γ Option C (PR2 c4.4, A17) — same swap as in handleMessage's prelude
    // but on the top-level payload. Swap once and pass the relativized
    // `data` to every consumer below (syncAfterBoardState, observeBoardState,
    // the turn-coord cache), so the BoundaryProcessor sees the relativized
    // `turnPlayer` and the RBS `updateLogical` sees relativized `players[]`.
    //
    // SOLO board re-projection (2026-06-02) — cache the ABSOLUTE (pre-swap)
    // payload so `onPerspectiveSwitched` can re-feed it with the new
    // perspective. Without this cache the board stays frozen on the last
    // received orientation when the server is waiting for a response (no
    // new BOARD_STATE arrives → `_maybeSwapBoardState` never re-fires →
    // Lukias stays at its pre-switch position).
    this._lastAbsoluteBoardState = message.data;
    const data = this._maybeSwapBoardState(message.data);
    this._rematchStarting.set(false);
    this._justReconnected.set(false);
    syncAfterBoardState(this.rbs, this.processor.chainPhase(),
      this.processor.animationQueue().length, data, this._boardActive);
    // β.1 — feed the BoundaryProcessor for Turn/Phase delta detection.
    // Runs after the sync tier decision so the BP's emit fires AFTER
    // the board state is reflected in the rendered/logical layers.
    this.processor.observeBoardState(data);
    // β.3 cas #13 — cache the turn coordinates for the next MSG_DRAW
    // turn-delta detection. We do NOT fire `onDrawNewTurn` here: the
    // MSG_DRAW handler does, so the announce always enqueues right
    // before its triggering MSG_DRAW in the queue (correct order).
    this._lastTurnPlayer = data.turnPlayer;
    this._lastTurnCount = data.turnCount;
  }

  /** STATE_SYNC entry point — buffers the payload then schedules a flush.
   *  The companion CHAIN_STATE (when present) consumes the buffer and applies
   *  STATE_SYNC + restoreChainState atomically (see `_handleChainState`).
   *  Falls back to the timer flush if CHAIN_STATE never arrives.
   *
   *  Background — STATE_SYNC fires on TWO paths: reconnection re-sync, AND
   *  the server-side cancel rollback (CANCEL_PROMPT_SEQUENCE). Both require
   *  a clean slate. For the FULL inventory of state slots reset on cancel
   *  (worker + server + client), see
   *  `_bmad-output/planning-artifacts/cancel-rollback-contract.md`.
   *  READ IT BEFORE ADDING A NEW PRIVATE FIELD TO DuelConnection that holds
   *  prompt-flow state.
   *
   *  F14 (2026-05-31) — STATE_SYNC is BUFFERED rather than applied
   *  immediately. The companion CHAIN_STATE (when there's an active chain
   *  to restore) arrives in the same Node.js tick server-side and consumes
   *  the buffer ; STATE_SYNC + restoreChainState happen atomically in the
   *  same client tick, no transient window. If CHAIN_STATE never arrives
   *  (server-contract: only sent when session.activeChainLinks.length > 0),
   *  the `stateSyncFlush` timer applies STATE_SYNC alone after a short delay. */
  private _handleStateSyncBuffer(message: StateSyncMsg): void {
    if (this._pendingStateSync !== null) {
      // Two STATE_SYNCs back-to-back without a CHAIN_STATE between them —
      // flush the prior one before parking the new payload so no resync
      // silently shadows another.
      this._applyStateSync(this._pendingStateSync);
    }
    this._pendingStateSync = message;
    this.armTimeout('stateSyncFlush', () => {
      const pending = this._pendingStateSync;
      if (pending !== null) {
        this._pendingStateSync = null;
        this._applyStateSync(pending);
      }
    }, STATE_SYNC_FLUSH_MS);
  }

  private _handleChainState(message: ChainStateMsg): void {
    // F14 (2026-05-31) — consume the buffered STATE_SYNC and apply
    // STATE_SYNC + restoreChainState atomically (same tick, no transient
    // empty-chain window observable to any reader).
    const pending = this._pendingStateSync;
    if (pending === null) {
      // CHAIN_STATE without preceding STATE_SYNC is a true protocol
      // violation (the server-contract pairs them). Log loud but
      // best-effort restore so the user isn't stuck.
      this.logger?.warn(
        'CHAIN_STATE received without buffered STATE_SYNC — applying chain restore on current state'
      );
    } else {
      this.clearTimeoutSlot('stateSyncFlush');
      this._pendingStateSync = null;
      this._applyStateSync(pending);
    }
    const negatedSet = new Set(message.negatedIndices);
    // F9-bis (2026-06-04) — extracted to `chainingMsgsToLinkStates` so the
    // replay viewer's mid-chain seek path reuses the same conversion.
    // Drive-by fix in passing: `descriptionText` is now propagated (the
    // prior inline mapping omitted it, so PvP reconnect mid-chain lost the
    // resolved effect text — silent regression vs `buildChainLinkState`
    // which has always included it). The omission was harmless because the
    // text is only rendered in the chain overlay tooltips which the user
    // rarely reads during a reconnect, but it's still a divergence.
    const links = chainingMsgsToLinkStates(message.links, negatedSet);
    // Queue already cleared by processor.reset() inside _applyStateSync.
    this.processor.restoreChainState(links, message.phase);
  }

  private _handleSelectModal(
    message: SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg | SelectCounterMsg,
  ): void {
    this.processor.processMessage(message);
    // Palier 0 — only `SELECT_CARD` belongs to the EventStream (the
    // game-log builder uses it as the secondary `MSG_BECOME_TARGET`
    // resolver). The other prompts in this branch do not feed the log.
    if (message.type === 'SELECT_CARD') this._outOfBandSink?.(message);
    // γ Option C (PR2 c4.2) — single-source slot write per `message.player`.
    // F-bugB3 verbose — visibility on every card-selection prompt arrival.
    // The slot route (`message.player` → `_slotFor` → slot identity) is
    // load-bearing in SOLO multiplex; in PvP normal both should resolve
    // to slot 0 for the receiver. `cardsLen` distinguishes a real
    // re-offer (cards present) from the auto-respond empty-cards path.
    this.logger?.log(DuelLogCategory.PIPELINE,
      'ws.recv %s player=%s cardsLen=%s forced=%s prevPending=%s',
      message.type, message.player,
      'cards' in message ? (message as { cards: unknown[] }).cards.length : 'n/a',
      message.type === 'SELECT_CHAIN' ? (message as SelectChainMsg).forced : 'n/a',
      this._slots[message.player].pendingPrompt()?.type ?? null);
    const slot = this._slotFor(message.player, message.type);
    // Reset exclusion accumulator when the prompt type changes mid-sequence
    // (must happen before pendingPrompt.set so attachComponent reads the correct value)
    if (slot.lastSelectedPromptType !== null && slot.lastSelectedPromptType !== message.type) {
      slot.lastSelectedCards = [];
      slot.lastSelectedPromptType = null;
    }
    if (this.tryAutoRespondEmptyCards(message)) {
      this.logger?.log(DuelLogCategory.PIPELINE,
        'ws.recv %s player=%s → auto-respond empty (cards=0)', message.type, message.player);
      return;
    }
    slot.waitingForOpponent.set(false);
    slot.pendingPrompt.set(message);
  }

  /** Common branch for SELECT_IDLECMD / SELECT_BATTLECMD / SELECT_EFFECTYN /
   *  SELECT_YESNO / SELECT_PLACE / SELECT_DISFIELD / SELECT_POSITION /
   *  SELECT_OPTION / ANNOUNCE_* / SORT_*. The message type narrowing happens
   *  upstream in the routing table; here we treat them uniformly. */
  private _handleSelectSimple(message: Extract<Prompt, { player: 0 | 1 }>): void {
    this.processor.processMessage(message);
    // γ Option C (PR2 c4.2) — single-source slot write per `message.player`.
    const slot = this._slotFor(message.player, message.type);
    slot.waitingForOpponent.set(false);
    slot.pendingPrompt.set(message);
  }

  private _handleDiceRoll(message: DiceRollPromptMsg): void {
    // DICE_ROLL is a *prompt* (server asking the client to roll). It is NOT
    // "in progress" yet — `inProgress` flips to true only when the client
    // sends its response (see sendResponse). Receiving DICE_ROLL is the
    // signal to enter the `'ready'` stage of the dice arena (intro text +
    // auto-roll countdown).
    // A rematch re-runs the pre-duel dice flow: the first DICE_ROLL means
    // the dice arena now owns the screen, so clear `rematchStarting` here
    // (it would otherwise stay true until the new duel's BOARD_STATE, ~6s
    // later, leaving the "Starting new duel…" modal on top of — and
    // blocking — the dice arena).
    this._rematchStarting.set(false);
    this._diceResult.set(null);
    this._diceInProgress.set(false);
    // γ-c regression fix (2026-05-29) — pre-duel prompts route to BOTH
    // slots, NOT `_slots[message.player]`. DICE_ROLL is a single-recipient
    // prompt always addressed to the receiver (server sends `player:0` to
    // P0, `player:1` to P1). The dice-arena reads it via `perspectiveSlot()`
    // = `ownPlayerIndex()` in PvP-normal. That index is UNRESOLVED
    // (`ocgPlayerIndex() ?? 0` = 0) on the first duel (→ reads `_slots[0]`),
    // but ALREADY RESOLVED on a rematch (`_ocgPlayerIndex` is not cleared at
    // REMATCH_STARTING → joiner reads `_slots[1]`). Routing to a single
    // slot is correct for exactly one of the two cases, never both — so the
    // joiner missed the dice on either the first duel (slot-1 route) or the
    // rematch (slot-0 route). Writing both slots is unconditionally visible.
    // Safe: the receiver is the sole reader, and DICE_ROLL is dead in SOLO
    // (startFirstPlayerPhase throws), so the unread slot is inert.
    for (const s of this._slots) s.pendingPrompt.set(message);
  }

  private _handleDiceResult(message: DiceResultMsg): void {
    this._diceInProgress.set(false);
    this._diceResult.set(message);
  }

  private _handleSelectFirstPlayer(message: SelectFirstPlayerMsg): void {
    // γ-c regression fix (2026-05-29) — same as DICE_ROLL: write BOTH slots.
    // Single-recipient pre-duel prompt (sent only to the dice winner), read
    // via `perspectiveSlot()` which is `0` on the first duel but the resolved
    // `ownPlayerIndex` on a rematch (`_ocgPlayerIndex` survives
    // REMATCH_STARTING). Dead in SOLO. See the DICE_ROLL comment for the
    // full rationale.
    for (const s of this._slots) {
      s.waitingForOpponent.set(false);
      s.pendingPrompt.set(message);
    }
  }

  private _handleFirstPlayerResult(message: FirstPlayerResultMsg): void {
    this._firstPlayerResponseSent.set(false);
    this._firstPlayerResult.set({ goFirst: message.goFirst });
    // γ Option C (PR2 c4.1+c4.2, F3 from code review) — FIRST_PLAYER_RESULT
    // has no `.player` field (broadcast to both with perspective-flipped
    // `goFirst`). Dead in SOLO. Clear BOTH slots so PvP-normal P1's slot
    // gets `waitingForOpponent` cleared too (the c5 reader projects via
    // `slotIndex` — clearing both is the safe equivalent of the prior global).
    //
    // γ-c regression fix (2026-05-30) — ALSO clear `pendingPrompt` on both
    // slots. The pre-duel prompts (DICE_ROLL / SELECT_FIRST_PLAYER) are
    // written to BOTH slots (see those cases). The dice loser never sends a
    // response, so its residual prompt is never cleared by `sendResponse`.
    // When DUEL_STARTING flips `ocgPlayerIndex` 0→1 for the joiner,
    // `perspectiveSlot()` switches the read from `_slots[0]` to `_slots[1]`,
    // resurfacing the stale DICE_ROLL still parked there. The dice-arena's
    // "fresh DICE_ROLL" effect then resets `_finalSeen=false`, dropping the
    // stage `final → result` → the loser is stuck on "opponent choosing"
    // forever. FIRST_PLAYER_RESULT is the end of the pre-duel prompt phase,
    // so wiping pendingPrompt on both slots here is the correct closure.
    for (const s of this._slots) {
      s.waitingForOpponent.set(false);
      s.pendingPrompt.set(null);
    }
  }

  private _handleDeckPrefetch(message: DeckPrefetchMsg): void {
    // Phase 3.16: warmup hint sent right before FIRST_PLAYER_RESULT.
    // Populate _cardCodes early so the dice-arena's `final` stage can
    // prime the browser image cache during the 2.5s announce window.
    // DUEL_STARTING will overwrite this with the same data (post-swap)
    // a moment later — idempotent.
    if (message.cardCodes?.length) this._cardCodes.set(message.cardCodes);
  }

  private _handleEarlyDeckPrefetch(message: EarlyDeckPrefetchMsg): void {
    // animations-ready-protocol-2026-06-05 (Direction B) — emitted by the
    // server immediately after SESSION_PHASE, BEFORE the worker spawns.
    // Populates `_cardCodes` early so `preFetchCardImages` can start
    // (driven by the loading service's mount-time effect on `cardCodes`)
    // before the worker is allowed to spawn. The deadlock that would
    // otherwise force ANIMATIONS_READY emission at SESSION_TOKEN time
    // (Direction A pivot) is broken by this message: cardCodes arrive
    // here regardless of worker state.
    //
    // Idempotent : DECK_PREFETCH (post-dice) and DUEL_STARTING (post-
    // worker-spawn) re-set `_cardCodes` with the same payload later. In
    // SOLO multiplex `bothCardCodes` mirrors `DuelStartingMsg`; PvP
    // normal omits it (server-side info-leak prevention).
    if (message.cardCodes?.length) this._cardCodes.set(message.cardCodes);
  }

  private _handleDuelStarting(message: DuelStartingMsg): void {
    this._firstPlayerResult.set(null);
    this._ocgPlayerIndex.set(message.playerIndex as 0 | 1);
    if (message.cardCodes?.length) this._cardCodes.set(message.cardCodes);
    this.logger?.setTraceId(message.traceId);
  }

  private _handleMsgHint(message: HintMsg): void {
    const isSelectMsg = message.hintType === 3;
    const isCardHint = !isSelectMsg; // type 10/13/15 identify a new card
    // γ Option C (PR2 c4.1+c4.2, A34) — write the SAME slot the message
    // targets, with `prev` read from THAT slot (intra-slot inheritance).
    // A naive `prev = currentPerspective.hintContext()` would break
    // inheritance across a `switchPerspective` between 2 MSG_HINT of the
    // same slot: the cardName would be inherited from the wrong slot's
    // history. Spec §4.3 A34.
    //
    // γ c5d A39-bis — when the hint is broadcast public (server filter
    // SAFE_PUBLIC_HINT_TYPES), every viewer sees the same payload regardless
    // of forPlayer. Writing only `_slots[message.player]` makes the hint
    // invisible to a reader whose `slotIndex !== message.player` (PvP
    // normal P0 receiving an opponent-originated public hint, or SOLO
    // after a perspective switch). Detect the broadcast case and write
    // BOTH slots with the same `merged`. The `prev` for inheritance is
    // read from the ORIGIN slot (`_slots[message.player]`) in both
    // branches — A34 inheritance is attached to the origin, not the
    // destinataire.
    const slot = this._slotFor(message.player, 'MSG_HINT');
    if (isCardHint) slot.hintCardConsumed = false;
    const prev = slot.hintContext();
    // Only preserve prev cardName if it hasn't been consumed by a prior prompt response
    const canInherit = isSelectMsg && !slot.hintCardConsumed;
    const merged = {
      hintType: message.hintType,
      player: message.player,
      value: message.value,
      cardName: message.cardName || (canInherit ? prev.cardName : ''),
    };
    const isBroadcast = SAFE_PUBLIC_HINT_TYPES.has(message.hintType);
    this.logger?.log(DuelLogCategory.PROC, 'MSG_HINT raw: %o => merged: %o (broadcast=%s)', { hintType: message.hintType, cardName: message.cardName, value: message.value, isSelectMsg, canInherit }, merged, isBroadcast);
    if (isBroadcast) {
      // A39-bis broadcast — write both slots so any reader surfaces it.
      for (const s of this._slots) s.hintContext.set(merged);
    } else {
      slot.hintContext.set(merged);
    }
  }

  private _handleTimerState(message: TimerStateMsg): void {
    this._timerState.set(message);
    this._timerStatePerPlayer.update(states => {
      const updated: [TimerStateMsg | null, TimerStateMsg | null] = [...states] as [TimerStateMsg | null, TimerStateMsg | null];
      updated[message.player] = message;
      return updated;
    });
  }

  private _handleInactivityWarning(message: InactivityWarningMsg): void {
    // γ Option C (PR2 c4.1+c4.2, A8.1) — `message.player` is optional on
    // the protocol type (back-compat). Default to slot 0 when absent: PvP
    // normal emits without player and the legacy reader was slot-agnostic,
    // so slot 0 is the equivalent slot. In SOLO multiplex the server
    // populates it.
    //
    // γ-c cleanup F-2.4 (audit) — assert presence in SOLO. A server
    // regression that omits `player` in SOLO would silently land the
    // warning in slot 0 = invisible to a viewer in perspective=1.
    // PvP normal keeps the fallback (legacy slot-agnostic behavior).
    duelAssert(!this.soloMode || message.player !== undefined,
      'INACTIVITY_WARNING',
      'SOLO multiplex requires server to populate `player` (got undefined)');
    this._slots[message.player ?? 0].inactivityWarning.set(message);
  }

  private _handleDuelEnd(message: DuelEndMsg): void {
    // Palier 0 — server converts MSG_WIN → DUEL_END at the WS boundary
    // (it drops the engine event and emits the lifecycle message). When
    // the duel ended naturally in the engine (winner+winReasonCode
    // present), reconstruct a synthetic MSG_WIN for the EventStream so
    // the Game Log renders its 🏆 row in PvP live — matching what the
    // Replay sees via the precompute's final state (which retains the
    // original MSG_WIN). Non-engine ends (surrender, timeout,
    // disconnect) leave `winReasonCode` undefined and do NOT synthesize
    // a MSG_WIN: replay's `ingestState` doesn't see one for those
    // cases either, so the journal stays consistent across modes.
    if (message.winner !== null && message.winReasonCode !== undefined) {
      const synthetic: WinMsg = {
        type: 'MSG_WIN',
        player: message.winner,
        reason: message.winReasonCode,
      };
      this._outOfBandSink?.(synthetic);
    }
    this._confirmedCardsByChain.clear();
    // β.1 — emit `*Ended` for every still-open boundary group BEFORE
    // wiping chain state so the journal sees the duel closure in
    // causality order (Chain → Phase → Turn). Runs AFTER the MSG_WIN
    // synthesis so the journal order is `…events… → MSG_WIN → *Ended`,
    // matching the natural reading.
    this.processor.forceBoundaryClosure('DuelEnded');
    this.processor.reset();
    this._firstPlayerResult.set(null);
    this._firstPlayerResponseSent.set(false);
    this._duelResult.set(message);
    this._opponentDisconnected.set(false);
    this._disconnectGraceSec.set(0);
    // γ Option C (PR2 c4.1+c4.2) — DUEL_END clears BOTH slots' prompt flow.
    // F12 (code review): `hintContext` clear mandated by spec §4.3 A8
    // row `_hintContext` ("clear LES DEUX au DUEL_END + REMATCH_STARTING
    // + STATE_SYNC"). Legacy did NOT clear it at DUEL_END, but the spec
    // table is authoritative for the per-slot semantics.
    // U6-D3 (audit-4-modes-2026-06-01 review): also clear the
    // selection-accumulator pair. Without this, a duel 2 SELECT_CARD
    // matching the duel 1 last promptType inherits stale `excludedCards`
    // into `pvp-prompt-dialog.attachComponent` → user sees ghost
    // exclusions on the very first prompt of the rematch.
    for (const s of this._slots) {
      s.lastConfirmedCards = [];
      s.lastSelectedCards = [];
      s.lastSelectedPromptType = null;
      s.pendingPrompt.set(null);
      s.inactivityWarning.set(null);
      s.waitingForOpponent.set(false);
      s.hintContext.set({ hintType: 0, player: 0, value: 0, cardName: '' });
    }
    try { localStorage.removeItem(this.storageKey); } catch {}
  }

  private _handleError(message: ErrorMsg): void {
    // γ Option C (PR2 c4.4, A32) — surface the server's error payload to
    // the wsService / duel-page consumer (toast). Perspective-agnostic:
    // the global signal `lastError` is read by a perspective-independent
    // consumer (a single user, no matter which slot they look at).
    // Consumer is responsible for `clearLastError()` after rendering.
    // BH-6 from c4.4 code review — warn-level log so the debug harness
    // captures the payload even when no consumer is mounted.
    this.logger?.warn('server ERROR received: %o', message);
    this._lastError.set(message);
  }

  private _handleRematchInvitation(): void {
    this._rematchState.set('invited');
  }

  private _handleRematchCancelled(message: RematchCancelledMsg): void {
    this._rematchState.set(message.reason === 'opponent_left' ? 'opponent-left' : 'expired');
  }

  private _handleRematchStarting(): void {
    this._confirmedCardsByChain.clear();
    // β.1 — close any still-open boundary groups before resetting.
    // The next duel's BOARD_STATE will open fresh ones.
    this.processor.forceBoundaryClosure('RematchStarted');
    this.processor.reset();
    this._rematchStarting.set(true);
    this._duelResult.set(null);
    this._cardCodes.set([]);
    // γ Option C (PR2 c4.4, A23) — reset the board-active gate so the
    // next BOARD_STATE re-enters `syncAfterBoardState` tier 1
    // (`!boardActive → syncPileCounts`) and `drainPreActivationBuffer`
    // fires for the new duel's initial 5 MSG_DRAW. Without this, the
    // flag stays `true` from the prior duel and the rematch's opening
    // hand never animates (the buffer never drains).
    // `DuelLoadingEffectsService` re-flips it to `true` once the new
    // BOARD_STATE lands via the `duel-loading → active` chain.
    this._boardActive = false;
    this.rbs.updateLogical(EMPTY_DUEL_STATE);
    // F19 (2026-05-31) — assert lock state at the reset boundary BEFORE
    // commitAll() wipes everything inconditionally. The previous duel's
    // animation pipeline MUST have settled all its locks (chain end,
    // queue drained) by the time REMATCH_STARTING fires. A leak here
    // is a regression: somewhere a `lockZone` never paired with a
    // commit/release. Throws in dev, console.errors in prod via duelAssert.
    this.rbs.assertNoLocks('REMATCH_STARTING');
    this.rbs.commitAll();
    this._firstPlayerResult.set(null);
    this._firstPlayerResponseSent.set(false);
    this._opponentDisconnected.set(false);
    this._disconnectGraceSec.set(0);
    this._rematchState.set('idle');
    // γ Option C (PR2 c4.1+c4.2) — REMATCH_STARTING clears BOTH slots.
    // The next duel re-populates them per `message.player`.
    // F10 (code review): `hintContext` + `inactivityWarning` clears
    // mandated by spec §4.3 A8 (rows _hintContext "clear LES DEUX au
    // DUEL_END + REMATCH_STARTING + STATE_SYNC" and _inactivityWarning
    // "clear LES DEUX au DUEL_END + REMATCH_STARTING"). Legacy did
    // not clear either at REMATCH_STARTING; spec table is authoritative.
    // U6-D3 (audit-4-modes-2026-06-01 review): same selection-accumulator
    // clear as DUEL_END — REMATCH_STARTING typically arrives without an
    // intervening STATE_SYNC, so without this clear the first SELECT_*
    // of the rematch inherits stale `lastSelectedCards` when the
    // promptType matches.
    for (const s of this._slots) {
      s.lastConfirmedCards = [];
      s.lastSelectedCards = [];
      s.lastSelectedPromptType = null;
      s.pendingPrompt.set(null);
      s.waitingForOpponent.set(false);
      s.inactivityWarning.set(null);
      s.hintContext.set({ hintType: 0, player: 0, value: 0, cardName: '' });
    }
  }

  private _handleOpponentDisconnected(message: OpponentDisconnectedMsg): void {
    this._opponentDisconnected.set(true);
    this._disconnectGraceSec.set(message.gracePeriodSec);
  }

  private _handleOpponentReconnected(): void {
    this._opponentDisconnected.set(false);
    this._disconnectGraceSec.set(0);
  }

  private _handleWaitingResponse(message: WaitingResponseMsg): void {
    this.processor.processMessage(message);
    // γ Option C (PR2 c4.1+c4.2, A8.2) — `targetPlayer` is optional on the
    // protocol type (back-compat). Server populates it in both modes
    // (PR1 c2c). Default slot 0 if absent (= legacy PvP normal behavior
    // where the message was sent to the opponent socket whose connection
    // implicitly represented slot 0 of its own perspective).
    //
    // γ-c cleanup F-2.4 (audit) — assert presence in SOLO. Same
    // rationale as `INACTIVITY_WARNING` above.
    duelAssert(!this.soloMode || message.targetPlayer !== undefined,
      'WAITING_RESPONSE',
      'SOLO multiplex requires server to populate `targetPlayer` (got undefined)');
    // SOLO multiplex single-waiter invariant (fix #5, 2026-06-02): at any
    // instant, AT MOST one slot is in `waitingForOpponent`. The server emits
    // `WAITING_RESPONSE{targetPlayer:X}` when it has just sent a SELECT_* to
    // the OPPOSITE of X — i.e. X is the side that waits, 1-X is the side
    // that must act. Setting slot[X] without clearing slot[1-X] lets a stale
    // "waiting" flag from a prior turn persist on both sides, which (a) glows
    // the SOLO switch button when no action is actually pending, (b) corrupts
    // `waitingForOpponentOnOtherSlot` reads after a switch. Bug reproduced
    // 2026-06-02: `slot0.waiting=true slot1.waiting=true` simultaneously
    // after an auto-respond sequence on a chain interrupt window.
    //
    // PvP normal LIMIT (F8 2026-06-04): in PvP normal each side lives on its
    // own conn so the cross-slot race cannot happen by construction, and
    // `message.targetPlayer` is typically undefined → the ?? 0 default
    // would wipe slot[1].waitingForOpponent unconditionally. Gated on
    // `soloMode` so PvP normal keeps the legacy single-slot semantic.
    const targetPlayer = (message.targetPlayer ?? 0) as 0 | 1;
    this._slots[targetPlayer].waitingForOpponent.set(true);
    if (this.soloMode) {
      this._slots[(1 - targetPlayer) as 0 | 1].waitingForOpponent.set(false);
    }
  }

  private _handleSessionToken(message: SessionTokenMsg): void {
    // Server confirmed the session — connection is genuinely alive.
    this.clearTimeoutSlot('sessionToken');
    this._connectionStatus.set('connected');
    this._retryCount.set(0);
    // wsToken is consumed once server-side at the first handshake (pendingTokens.delete);
    // clear our copy so future reconnects rely solely on the rotating reconnectToken.
    this.wsToken = null;
    this.reconnectToken = message.token;
    this._hasToken.set(true);
    // animations-ready-protocol-2026-06-05 (Direction B) — ANIMATIONS_READY
    // emission is owned by `DuelLoadingEffectsService`, NOT this handler.
    // The service emits once both `thumbnailsReady=true` AND the WS is
    // `connectionStatus === 'connected'`. The circular deadlock that
    // would otherwise force emission here (Direction A pivot) is broken
    // by the server emitting EARLY_DECK_PREFETCH right after SESSION_TOKEN,
    // which lets the client run `preFetchCardImages` before the worker
    // spawns.
    if (this._autoReconnect) {
      try { localStorage.setItem(this.storageKey, this.reconnectToken); } catch {}
    }
  }

  private _handleSessionPhase(message: SessionPhaseMsg): void {
    // Mount-discriminant from the server (PRE_DUEL | DUELING | ENDED).
    // Frozen after first set — the UI bases its initial mount on this
    // value once and does not re-react if the server were to re-emit.
    if (this._sessionPhase() === null) this._sessionPhase.set(message.phase);
  }

  private _handleMsgChaining(message: ServerMessage): void {
    this.processor.processMessage(message);
  }

  private _handleMsgChainEnd(message: ServerMessage): void {
    // M22 — Symmetric with server-side activeChainLinks reset.
    // Reveals tagged with this chain's link indices are no longer
    // relevant to any future prompt (next chain = different chainIndex
    // namespace, next prompt outside chain = chainIndex null).
    this._confirmedCardsByChain.clear();
    this.processor.processMessage(message);
  }

  private _handleMsgConfirmCards(message: ConfirmCardsMsg): void {
    // γ Option C (PR2 c4.1+c4.2) — write the slot of `message.player`.
    // `_confirmedCardsByChain` stays GLOBAL (keyed by chainIndex which is
    // already a global namespace per chain).
    this._slotFor(message.player, 'MSG_CONFIRM_CARDS').lastConfirmedCards = message.cards;
    // M22 — Tagged reveals accumulate per chain link. Untagged reveals
    // (CONFIRM outside chain resolution) only land in slot.lastConfirmedCards
    // (used by SELECT_OPTION lastConfirmedName fallback).
    if (message.chainIndex !== undefined) {
      const existing = this._confirmedCardsByChain.get(message.chainIndex) ?? [];
      this._confirmedCardsByChain.set(message.chainIndex, [...existing, ...message.cards]);
    }
    this.processor.processMessage(message);
  }

  private _handleMsgDraw(message: DrawMsg): void {
    // β.3 cas #13 — fire `onDrawNewTurn` BEFORE handing the message
    // off to the processor, so the bridge can enqueue the DRAW
    // announce directive in front of the MSG_DRAW that triggered it.
    // Hash composite `${player}:${count}` (cf. _lastTurnPlayer +
    // _lastTurnCount field doc) — only one announce per new turn.
    //
    // Gate on `_boardActive` : boot's 5 initial MSG_DRAW arrive before
    // the dice arena dismisses (`roomState !== 'active'`). Firing
    // the announce there would burn its 2s timer behind the arena
    // overlay, then MAIN1 would overwrite it before the user sees
    // anything. By skipping the gate at boot, we silently swallow
    // the initial draw (it's the opening hand, not a meaningful
    // "new turn" — the engine starts in MAIN1 directly). The first
    // real DRAW announce happens at the next turn start.
    if (this._boardActive) {
      const hash = `${this._lastTurnPlayer}:${this._lastTurnCount}`;
      if (hash !== this._lastDrawAnnouncedHash) {
        this._lastDrawAnnouncedHash = hash;
        this.onDrawNewTurn?.(this._lastTurnPlayer, this._lastTurnCount);
      }
    }
    this.processor.processMessage(message);
  }

  /** Walk a server message and request prefetch of every revealed cardCode.
   *  The artService dedups internally — safe to call on every dispatch. Called
   *  early in handleMessage so the browser can start the HTTP request in
   *  parallel with the animation that will display the image (~300-800ms travel
   *  duration is usually long enough on a normal connection). */
  private prefetchRevealedCards(message: ServerMessage): void {
    const svc = this.artService;
    if (!svc) return;
    switch (message.type) {
      case 'BOARD_STATE':
      case 'STATE_SYNC':
        for (const player of message.data.players) {
          for (const zone of player.zones) {
            for (const card of zone.cards) {
              svc.prefetchCard(card.cardCode);
              if (card.overlayMaterials) for (const code of card.overlayMaterials) svc.prefetchCard(code);
            }
          }
        }
        break;
      case 'MSG_MOVE':
      case 'MSG_FLIP_SUMMONING':
      case 'MSG_CHAINING':
      case 'MSG_BECOME_TARGET':
      case 'MSG_EQUIP':
        svc.prefetchCard((message as { cardCode?: number }).cardCode);
        break;
      case 'MSG_DRAW':
        for (const c of message.cards) svc.prefetchCard(c);
        break;
      case 'MSG_CONFIRM_CARDS':
        for (const c of message.cards) svc.prefetchCard(c.cardCode);
        break;
      default:
        break;
    }
  }

  private handleReconnect(): void {
    if (!this._autoReconnect) {
      this._connectionStatus.set('lost');
      return;
    }

    // Note: there is no wsToken fallback here. wsToken is consumed once by the
    // server (pendingTokens.delete on first handshake) and SESSION_TOKEN clears
    // our copy — so by the time a reconnectToken would fail, wsToken is also
    // useless. Reaching _maxRetries means the duel is truly lost.

    if (this._retryCount() >= this._maxRetries) {
      this.reconnectToken = null;
      try { localStorage.removeItem(this.storageKey); } catch {}
      this._hasToken.set(this.wsToken !== null);
      this._connectionStatus.set('lost');
      return;
    }

    this._connectionStatus.set('reconnecting');
    const delay = Math.min(Math.pow(2, this._retryCount()) * 1000, 30_000);
    this._retryCount.update(c => c + 1);
    this._totalAutoRetries.update(c => c + 1);

    this.armTimeout('retry', () => this.openConnection(), delay);
  }

  private safeSend(data: object): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    // L28 — silent send drop = duel-blocking on the server side. Prefer a
    // visible warn so a regression in caller code (e.g. sendResponse fired
    // before WS handshake completes) is debuggable instead of a frozen UI.
    this.logger?.warn('safeSend dropped — WS not open (readyState=%d, type=%s)',
      this.ws?.readyState ?? -1, (data as { type?: string }).type ?? '?');
    return false;
  }

  /**
   * F14 (2026-05-31) — apply a buffered STATE_SYNC payload. Extracted from
   * the inline `case 'STATE_SYNC'` body so both the CHAIN_STATE consume
   * path (atomic with restoreChainState) and the timer-fallback path
   * (no-chain resync) share the same logic. Side-effects:
   *   · clears per-chain confirmed-cards map + rematchStarting flag ;
   *   · asserts RBS lock cleanliness then `updateLogical + commitAll` ;
   *   · forces boundary closure + resets the processor (chain wiped) ;
   *   · clears BOTH slot prompt-flow states (cancel + reconnect parity) ;
   *   · raises `_justReconnected` to gate auto-respond until next
   *     BOARD_STATE ;
   *   · forwards the message to `onStateSync` for component-level wiring
   *     (game-log journal restore, etc.).
   *
   * Safe to call multiple times for distinct messages — each call is a
   * fresh resync against a clean slate.
   */
  private _applyStateSync(message: StateSyncMsg): void {
    this._confirmedCardsByChain.clear();
    this._rematchStarting.set(false);
    this.rbs.assertNoLocks('onStateSync');
    this.rbs.updateLogical(message.data);
    this.rbs.commitAll();
    // β.1 — emit `*Ended` for every still-open boundary group BEFORE
    // wiping chain state. The journal sees the closures in causality
    // order; the next BOARD_STATE (forwarded by the resync) re-opens
    // fresh turn/phase groups.
    this.processor.forceBoundaryClosure('STATE_SYNC');
    this.processor.reset();
    // γ Option C (PR2 c4.1+c4.2) — STATE_SYNC clears BOTH slots (cancel
    // rollback + reconnect both wipe the entire prompt flow; server
    // re-sends per slot via the `forPlayer`-tagged prompts).
    for (const s of this._slots) {
      s.lastConfirmedCards = [];
      s.lastSelectedCards = [];
      s.lastSelectedPromptType = null;
      s.hintCardConsumed = false;
      s.pendingPrompt.set(null);
      s.hintContext.set({ hintType: 0, player: 0, value: 0, cardName: '' });
    }
    // Suppress auto-respond until the game resumes (first BOARD_STATE after reconnect)
    this._justReconnected.set(true);
    this.onStateSync?.(message);
  }

  /** Atomically replace any existing timer in `slot` with a fresh one. The
   *  callback runs `fn` after `ms`, and the slot is auto-nulled before fn
   *  fires so callers don't need to clear themselves. Audit finding H11. */
  private armTimeout(slot: keyof typeof this._timers, fn: () => void, ms: number): void {
    this.clearTimeoutSlot(slot);
    this._timers[slot] = setTimeout(() => {
      this._timers[slot] = null;
      fn();
    }, ms);
  }

  private clearTimeoutSlot(slot: keyof typeof this._timers): void {
    const id = this._timers[slot];
    if (id !== null) {
      clearTimeout(id);
      this._timers[slot] = null;
    }
  }
}

function isServerMessage(x: unknown): x is ServerMessage {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string';
}
