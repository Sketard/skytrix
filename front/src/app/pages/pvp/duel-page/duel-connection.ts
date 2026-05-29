import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import { EMPTY_DUEL_STATE, Prompt, HintContext, GameEvent, ConnectionStatus, ChainLinkState, StreamEvent } from '../types';
import { syncAfterBoardState, type QueueDirective, type QueueEntry } from './animation-data-source';
import { DuelEventProcessor } from './duel-event-processor';
import { DuelLogCategory, type DuelLogger } from './duel-logger';
import { duelAssert } from '../../../core/utilities/duel-assert';
import { RenderedBoardStateService, type BoardStateView } from './rendered-board-state.service';
import { BoardStatePayload, CardInfo, ChainStateMsg, ConfirmCardsMsg, DiceResultMsg, DuelEndMsg, ErrorMsg, InactivityWarningMsg, MoveMsg, PROTOCOL_VERSION, SelectCardMsg, SelectChainMsg, SelectCounterMsg, SelectSumMsg, SelectTributeMsg, SelectUnselectCardMsg, ServerMessage, SessionTokenMsg, TimerStateMsg, WinMsg } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';
import { swapBoardState } from '../board-state-swap';
import type { WebSocketFactory } from './websocket-factory.service';

export type ResponseData = Record<string, unknown>;

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
   * `DuelWebSocketService` to `AnimationOrchestratorService.notifyOutOfBandEvent`.
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
   * γ Option C (PR2 c4.1, A21) — flipped by `SoloDuelOrchestratorService.init`
   * to gate SOLO-only behavior (BOARD_STATE swap A17, `forPlayer` tag on
   * outbound sendXxx). Default `false` so PvP normal + replay paths are
   * unaffected by this commit.
   */
  soloMode = false;

  /**
   * γ Option C (PR2 c4.3, A9) — memoize the `forPlayer` tag of the LAST
   * outbound `PLAYER_RESPONSE` sent through this connection. Read by
   * `DuelWebSocketService.sendAnimationsDone` (A37 fallback) when SOLO
   * needs to derive the destination slot at a moment where no current
   * prompt is active. `null` until the first tagged response is sent.
   * Stays `null` forever in PvP normal (caller never passes `forPlayer`).
   */
  lastSentForPlayer: 0 | 1 | null = null;

  /**
   * γ Option C (PR2 c4.1) — optional injection of `DuelContext` for SOLO
   * multiplex paths that need the current visual perspective (A17 BOARD_STATE
   * swap). PvP normal does not need it and passes `undefined`. Narrow type
   * (only `perspective()`) keeps the contract minimal.
   */
  private readonly _duelCtx?: { perspective(): Signal<0 | 1> };

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
  /** Three named timer slots. Use armTimeout/clearTimeoutSlot to manage them —
   *  arming a slot already holding a timer would otherwise leak two concurrent
   *  setTimeouts (handshake retry race, see audit finding H11). */
  private readonly _timers: {
    connection: ReturnType<typeof setTimeout> | null;
    sessionToken: ReturnType<typeof setTimeout> | null;
    retry: ReturnType<typeof setTimeout> | null;
  } = { connection: null, sessionToken: null, retry: null };
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

  // M18 — STATE_SYNC timestamp. Server contract: CHAIN_STATE is ALWAYS preceded
  // by STATE_SYNC in the same WS batch (cancel rollback + reconnect snapshot).
  // We assert that the gap is small (TCP segmentation should not split them by
  // more than a fraction of a second). If the gap is large, processor.reset()
  // from STATE_SYNC may arrive AFTER restoreChainState and silently wipe the
  // restored chain links — surfacing it via duelAssert is the cheap detection.
  private _lastStateSyncAt = 0;

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
   * `notifyOutOfBandEvent`). Wires the processor's `onEvent` callback so
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
   *
   * `_lastSentForPlayer` memoization (A9) is sibling state: the
   * `wsService.sendAnimationsDone` A37 fallback reads it when no current
   * prompt is active.
   */
  private _tagForPlayer<T extends { type: string }>(msg: T, forPlayer: 0 | 1 | undefined): T {
    this.lastSentForPlayer = forPlayer ?? null;
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
    if (this.safeSend(this._tagForPlayer({ type: 'PLAYER_RESPONSE', promptType, data }, forPlayer))) {
      // γ Option C (PR2 c4.3, A22) — clear the slot of the responding player.
      // PvP normal: `forPlayer === undefined` → slot 0 (legacy equivalent;
      // c5's wsService.sendResponse forwards `undefined` in PvP normal).
      // SOLO multiplex: the user's perspective slot is cleared.
      const slot = this._slots[forPlayer ?? 0];
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

  cleanup(): void {
    this.rbs.assertNoLocks('cleanup');
    this.rbs.destroy();
    this.clearTimeoutSlot('connection');
    this.clearTimeoutSlot('sessionToken');
    this.clearTimeoutSlot('retry');
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

    if (message.type === 'SELECT_CHAIN' || message.type === 'SELECT_UNSELECT_CARD') {
      this.sendResponse(message.type, { index: null });
    } else if (message.type === 'SELECT_COUNTER') {
      this.sendResponse(message.type, { counters: [] });
    } else {
      this.sendResponse(message.type, { indices: [] });
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

  private handleMessage(message: ServerMessage): void {
    this.logger?.log(DuelLogCategory.PIPELINE, 'ws.recv type=%s', message.type);
    // β.3 cas #12 — R8 PROBE TEMPORARY (2026-05-26) — surface the server-side
    // probe field as a console.warn so the Playwright debug harness captures
    // it. TO REMOVE before merging Commit 0bis.
    if (message.type === 'MSG_MOVE' && (message as { _r8Probe?: unknown })._r8Probe) {
      const probe = (message as unknown as { _r8Probe: { count: number; codes: number[]; fromLoc: number; fromSeq: number } })._r8Probe;
      const m = message as MoveMsg;
      console.warn('R8-PROBE MSG_MOVE post-process OVERLAY_CARD on source', JSON.stringify({
        card: m.cardName,
        cardCode: m.cardCode,
        player: m.player,
        toPlayer: m.toPlayer,
        fromLoc: m.fromLocation, fromSeq: m.fromSequence,
        toLoc: m.toLocation, toSeq: m.toSequence,
        reason: '0x' + m.reason.toString(16),
        probeOverlayCount: probe.count,
        probeOverlayCodes: probe.codes,
      }));
    }
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
    switch (message.type) {
      case 'BOARD_STATE': {
        // γ Option C (PR2 c4.4, A17) — same swap as above but on the top-level
        // payload. Swap once and pass the relativized `data` to every consumer
        // below (syncAfterBoardState, observeBoardState, the turn-coord cache),
        // so the BoundaryProcessor sees the relativized `turnPlayer` and the
        // RBS `updateLogical` sees relativized `players[]`.
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
        break;
      }

      case 'STATE_SYNC':
        // STATE_SYNC fires on TWO paths: reconnection re-sync, AND the
        // server-side cancel rollback (CANCEL_PROMPT_SEQUENCE). Both
        // require a clean slate.
        //
        // For the FULL inventory of state slots reset on cancel (worker
        // + server + client), see
        // `_bmad-output/planning-artifacts/cancel-rollback-contract.md`.
        // READ IT BEFORE ADDING A NEW PRIVATE FIELD TO DuelConnection
        // that holds prompt-flow state.
        this._confirmedCardsByChain.clear();
        this._rematchStarting.set(false);
        // M18 — record timestamp for the CHAIN_STATE gap assertion
        this._lastStateSyncAt = Date.now();
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
        break;

      case 'CHAIN_STATE': {
        const cs = message as ChainStateMsg;
        // M18 — STATE_SYNC + CHAIN_STATE arrive in the same WS batch by
        // server contract. If the gap exceeds 1s, segmentation/proxy
        // buffering has split them and processor.reset() from a delayed
        // STATE_SYNC might wipe the chain we're about to restore.
        const sinceSync = Date.now() - this._lastStateSyncAt;
        duelAssert(
          this._lastStateSyncAt > 0 && sinceSync < 1000,
          'CHAIN_STATE',
          `received without recent STATE_SYNC (gap=${sinceSync}ms, lastSyncAt=${this._lastStateSyncAt})`,
        );
        const negatedSet = new Set(cs.negatedIndices);
        const links: ChainLinkState[] = cs.links.map(msg => ({
          chainIndex: msg.chainIndex,
          cardCode: msg.cardCode,
          cardName: msg.cardName,
          player: msg.player,
          zoneId: locationToZoneId(msg.location, msg.sequence),
          location: msg.location,
          sequence: msg.sequence,
          resolving: false,
          negated: negatedSet.has(msg.chainIndex),
        }));
        // Queue already cleared by processor.reset() in STATE_SYNC
        this.processor.restoreChainState(links, cs.phase);
        break;
      }

      case 'SELECT_CARD':
      case 'SELECT_CHAIN':
      case 'SELECT_TRIBUTE':
      case 'SELECT_SUM':
      case 'SELECT_UNSELECT_CARD':
      case 'SELECT_COUNTER':
        this.processor.processMessage(message);
        // Palier 0 — only `SELECT_CARD` belongs to the EventStream (the
        // game-log builder uses it as the secondary `MSG_BECOME_TARGET`
        // resolver). The other prompts in this branch do not feed the log.
        if (message.type === 'SELECT_CARD') this._outOfBandSink?.(message);
        // γ Option C (PR2 c4.2) — single-source slot write per `message.player`.
        {
          const slot = this._slotFor(message.player, message.type);
          // Reset exclusion accumulator when the prompt type changes mid-sequence
          // (must happen before pendingPrompt.set so attachComponent reads the correct value)
          if (slot.lastSelectedPromptType !== null && slot.lastSelectedPromptType !== message.type) {
            slot.lastSelectedCards = [];
            slot.lastSelectedPromptType = null;
          }
          if (this.tryAutoRespondEmptyCards(message as SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg | SelectCounterMsg)) break;
          slot.waitingForOpponent.set(false);
          slot.pendingPrompt.set(message);
        }
        break;
      case 'SELECT_IDLECMD':
      case 'SELECT_BATTLECMD':
      case 'SELECT_EFFECTYN':
      case 'SELECT_YESNO':
      case 'SELECT_PLACE':
      case 'SELECT_DISFIELD':
      case 'SELECT_POSITION':
      case 'SELECT_OPTION':
      case 'ANNOUNCE_RACE':
      case 'ANNOUNCE_ATTRIB':
      case 'ANNOUNCE_NUMBER':
      case 'SORT_CARD':
      case 'SORT_CHAIN':
      case 'ANNOUNCE_CARD':
        this.processor.processMessage(message);
        // γ Option C (PR2 c4.2) — single-source slot write per `message.player`.
        {
          const slot = this._slotFor(message.player, message.type);
          slot.waitingForOpponent.set(false);
          slot.pendingPrompt.set(message);
        }
        break;

      case 'DICE_ROLL':
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
        // γ Option C (PR2 c4.2) — DICE_ROLL is dead in SOLO (RPS flow skipped
        // server-side), but route by `message.player` for PvP-normal correctness
        // and defensive future-proofing.
        this._slotFor(message.player, 'DICE_ROLL').pendingPrompt.set(message);
        break;

      case 'DICE_RESULT':
        this._diceInProgress.set(false);
        this._diceResult.set(message);
        break;

      case 'SELECT_FIRST_PLAYER':
        // γ Option C (PR2 c4.2) — same comment as DICE_ROLL.
        {
          const slot = this._slotFor(message.player, 'SELECT_FIRST_PLAYER');
          slot.waitingForOpponent.set(false);
          slot.pendingPrompt.set(message);
        }
        break;

      case 'FIRST_PLAYER_RESULT':
        this._firstPlayerResponseSent.set(false);
        this._firstPlayerResult.set({ goFirst: message.goFirst });
        // γ Option C (PR2 c4.1+c4.2, F3 from code review) — FIRST_PLAYER_RESULT
        // has no `.player` field (broadcast to both with perspective-flipped
        // `goFirst`). Dead in SOLO. Clear BOTH slots so PvP-normal P1's slot
        // gets `waitingForOpponent` cleared too (the c5 reader projects via
        // `slotIndex` — clearing both is the safe equivalent of the prior global).
        for (const s of this._slots) s.waitingForOpponent.set(false);
        break;

      case 'DECK_PREFETCH':
        // Phase 3.16: warmup hint sent right before FIRST_PLAYER_RESULT.
        // Populate _cardCodes early so the dice-arena's `final` stage can
        // prime the browser image cache during the 2.5s announce window.
        // DUEL_STARTING will overwrite this with the same data (post-swap)
        // a moment later — idempotent.
        if (message.cardCodes?.length) this._cardCodes.set(message.cardCodes);
        break;

      case 'DUEL_STARTING':
        this._firstPlayerResult.set(null);
        this._ocgPlayerIndex.set(message.playerIndex as 0 | 1);
        if (message.cardCodes?.length) this._cardCodes.set(message.cardCodes);
        this.logger?.setTraceId(message.traceId);
        break;

      case 'MSG_HINT': {
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
        break;
      }

      case 'TIMER_STATE': {
        const timerMsg = message as TimerStateMsg;
        this._timerState.set(timerMsg);
        this._timerStatePerPlayer.update(states => {
          const updated: [TimerStateMsg | null, TimerStateMsg | null] = [...states] as [TimerStateMsg | null, TimerStateMsg | null];
          updated[timerMsg.player] = timerMsg;
          return updated;
        });
        break;
      }

      case 'INACTIVITY_WARNING':
        // γ Option C (PR2 c4.1+c4.2, A8.1) — `message.player` is optional on
        // the protocol type (back-compat). Default to slot 0 when absent: PvP
        // normal emits without player and the legacy reader was slot-agnostic,
        // so slot 0 is the equivalent slot. In SOLO multiplex the server
        // populates it.
        this._slots[message.player ?? 0].inactivityWarning.set(message);
        break;

      case 'DUEL_END':
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
        for (const s of this._slots) {
          s.lastConfirmedCards = [];
          s.pendingPrompt.set(null);
          s.inactivityWarning.set(null);
          s.waitingForOpponent.set(false);
          s.hintContext.set({ hintType: 0, player: 0, value: 0, cardName: '' });
        }
        try { localStorage.removeItem(this.storageKey); } catch {}
        break;

      case 'ERROR':
        // γ Option C (PR2 c4.4, A32) — surface the server's error payload to
        // the wsService / duel-page consumer (toast). Perspective-agnostic:
        // the global signal `lastError` is read by a perspective-independent
        // consumer (a single user, no matter which slot they look at).
        // Consumer is responsible for `clearLastError()` after rendering.
        // BH-6 from c4.4 code review — warn-level log so the debug harness
        // captures the payload even when no consumer is mounted.
        this.logger?.warn('server ERROR received: %o', message);
        this._lastError.set(message);
        break;

      case 'REMATCH_INVITATION':
        this._rematchState.set('invited');
        break;

      case 'REMATCH_CANCELLED':
        this._rematchState.set(message.reason === 'opponent_left' ? 'opponent-left' : 'expired');
        break;

      case 'REMATCH_STARTING':
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
        for (const s of this._slots) {
          s.lastConfirmedCards = [];
          s.pendingPrompt.set(null);
          s.waitingForOpponent.set(false);
          s.inactivityWarning.set(null);
          s.hintContext.set({ hintType: 0, player: 0, value: 0, cardName: '' });
        }
        break;

      case 'OPPONENT_DISCONNECTED':
        this._opponentDisconnected.set(true);
        this._disconnectGraceSec.set(message.gracePeriodSec);
        break;

      case 'OPPONENT_RECONNECTED':
        this._opponentDisconnected.set(false);
        this._disconnectGraceSec.set(0);
        break;

      case 'WAITING_RESPONSE':
        this.processor.processMessage(message);
        // γ Option C (PR2 c4.1+c4.2, A8.2) — `targetPlayer` is optional on the
        // protocol type (back-compat). Server populates it in both modes
        // (PR1 c2c). Default slot 0 if absent (= legacy PvP normal behavior
        // where the message was sent to the opponent socket whose connection
        // implicitly represented slot 0 of its own perspective).
        this._slots[message.targetPlayer ?? 0].waitingForOpponent.set(true);
        break;

      case 'SESSION_TOKEN':
        // Server confirmed the session — connection is genuinely alive.
        this.clearTimeoutSlot('sessionToken');
        this._connectionStatus.set('connected');
        this._retryCount.set(0);
        // wsToken is consumed once server-side at the first handshake (pendingTokens.delete);
        // clear our copy so future reconnects rely solely on the rotating reconnectToken.
        this.wsToken = null;
        this.reconnectToken = (message as SessionTokenMsg).token;
        this._hasToken.set(true);
        if (this._autoReconnect) {
          try { localStorage.setItem(this.storageKey, this.reconnectToken); } catch {}
        }
        break;

      case 'SESSION_PHASE':
        // Mount-discriminant from the server (PRE_DUEL | DUELING | ENDED).
        // Frozen after first set — the UI bases its initial mount on this
        // value once and does not re-react if the server were to re-emit.
        if (this._sessionPhase() === null) this._sessionPhase.set(message.phase);
        break;

      case 'MSG_CHAINING':
        this.processor.processMessage(message);
        break;

      case 'MSG_CHAIN_SOLVING':
      case 'MSG_CHAIN_SOLVED':
      case 'MSG_CHAIN_NEGATED':
        this.processor.processMessage(message);
        break;

      case 'MSG_CHAIN_END':
        // M22 — Symmetric with server-side activeChainLinks reset.
        // Reveals tagged with this chain's link indices are no longer
        // relevant to any future prompt (next chain = different chainIndex
        // namespace, next prompt outside chain = chainIndex null).
        this._confirmedCardsByChain.clear();
        this.processor.processMessage(message);
        break;

      case 'MSG_CONFIRM_CARDS': {
        const confirm = message as ConfirmCardsMsg;
        // γ Option C (PR2 c4.1+c4.2) — write the slot of `confirm.player`.
        // `_confirmedCardsByChain` stays GLOBAL (keyed by chainIndex which is
        // already a global namespace per chain).
        this._slotFor(confirm.player, 'MSG_CONFIRM_CARDS').lastConfirmedCards = confirm.cards;
        // M22 — Tagged reveals accumulate per chain link. Untagged reveals
        // (CONFIRM outside chain resolution) only land in slot.lastConfirmedCards
        // (used by SELECT_OPTION lastConfirmedName fallback).
        if (confirm.chainIndex !== undefined) {
          const existing = this._confirmedCardsByChain.get(confirm.chainIndex) ?? [];
          this._confirmedCardsByChain.set(confirm.chainIndex, [...existing, ...confirm.cards]);
        }
        this.processor.processMessage(message);
        break;
      }
      case 'MSG_DRAW': {
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
        break;
      }
      case 'MSG_MOVE':
      case 'MSG_SHUFFLE_HAND':
      case 'MSG_SHUFFLE_DECK':
      case 'MSG_DAMAGE':
      case 'MSG_RECOVER':
      case 'MSG_PAY_LPCOST':
      case 'MSG_FLIP_SUMMONING':
      case 'MSG_CHANGE_POS':
      case 'MSG_BECOME_TARGET':
      case 'MSG_SWAP':
      case 'MSG_ATTACK':
      case 'MSG_BATTLE':
      case 'MSG_TOSS_COIN':
      case 'MSG_TOSS_DICE':
      case 'MSG_EQUIP':
      case 'MSG_ADD_COUNTER':
      case 'MSG_REMOVE_COUNTER':
      case 'MSG_SHUFFLE_SET_CARD':
      case 'MSG_SWAP_GRAVE_DECK':
        this.processor.processMessage(message);
        break;

      default:
        break;
    }
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
