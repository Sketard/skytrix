import { computed, signal } from '@angular/core';
import { EMPTY_DUEL_STATE, Prompt, HintContext, GameEvent, ConnectionStatus, ChainLinkState } from '../types';
import { syncAfterBoardState, type QueueEntry } from './animation-data-source';
import { DuelEventProcessor } from './duel-event-processor';
import { DuelLogCategory, type DuelLogger } from './duel-logger';
import { RenderedBoardStateService } from './rendered-board-state.service';
import { CardInfo, ChainStateMsg, ConfirmCardsMsg, DuelEndMsg, InactivityWarningMsg, RpsResultMsg, SelectCardMsg, SelectChainMsg, SelectCounterMsg, SelectSumMsg, SelectTributeMsg, SelectUnselectCardMsg, ServerMessage, SessionTokenMsg, TimerStateMsg } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';

export type ResponseData = Record<string, unknown>;

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
 * ## Solo mode dual connections
 *
 * In solo mode, two DuelConnection instances exist (one per player). The server broadcasts
 * all messages to both. Only the active connection's queue is processed by the orchestrator;
 * the inactive connection accumulates events and replays them on player switch.
 */
export class DuelConnection {
  // --- Signals (13 pairs) ---
  private _pendingPrompt = signal<Prompt | null>(null);
  private _hintContext = signal<HintContext>({ hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' });
  private logger?: DuelLogger;
  /** Optional art service for JIT prefetch of revealed card images. Wired from
   *  DuelWebSocketService / SoloDuelOrchestratorService at construction time so
   *  every revealed cardCode is requested once, before its animation lands.
   *  See P3 audit follow-up — opponent decklist no longer pre-fetched upfront. */
  artService?: { prefetchCard(code: number | null | undefined): void };
  private readonly processor = new DuelEventProcessor();
  private readonly rbs = new RenderedBoardStateService();
  readonly renderedBoardState = this.rbs;
  private _timerState = signal<TimerStateMsg | null>(null);
  private _timerStatePerPlayer = signal<[TimerStateMsg | null, TimerStateMsg | null]>([null, null]);
  private _connectionStatus = signal<ConnectionStatus>('connected');
  private _opponentDisconnected = signal(false);
  private _disconnectGraceSec = signal(0);
  private _duelResult = signal<DuelEndMsg | null>(null);
  private _rpsResult = signal<RpsResultMsg | null>(null);
  private _rpsInProgress = signal(false);
  private _ocgPlayerIndex = signal<0 | 1 | null>(null);
  private _cardCodes = signal<number[]>([]);
  private _rematchState = signal<'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired'>('idle');
  private _rematchStarting = signal(false);
  private _inactivityWarning = signal<InactivityWarningMsg | null>(null);
  private _waitingForOpponent = signal(false);
  private _tpResult = signal<{ goFirst: boolean } | null>(null);
  private _tpResponseSent = signal(false);
  private _boardActive = false;

  readonly pendingPrompt = this._pendingPrompt.asReadonly();
  readonly hintContext = this._hintContext.asReadonly();
  readonly animationQueue = this.processor.animationQueue;
  readonly timerState = this._timerState.asReadonly();
  readonly timerStatePerPlayer = this._timerStatePerPlayer.asReadonly();
  readonly connectionStatus = this._connectionStatus.asReadonly();
  readonly opponentDisconnected = this._opponentDisconnected.asReadonly();
  readonly disconnectGraceSec = this._disconnectGraceSec.asReadonly();
  readonly activeChainLinks = this.processor.activeChainLinks;
  readonly chainPhase = this.processor.chainPhase;
  readonly duelResult = this._duelResult.asReadonly();
  readonly rpsResult = this._rpsResult.asReadonly();
  readonly rpsInProgress = this._rpsInProgress.asReadonly();
  readonly ocgPlayerIndex = this._ocgPlayerIndex.asReadonly();
  readonly cardCodes = this._cardCodes.asReadonly();
  readonly rematchState = this._rematchState.asReadonly();
  readonly rematchStarting = this._rematchStarting.asReadonly();
  readonly inactivityWarning = this._inactivityWarning.asReadonly();
  readonly waitingForOpponent = this._waitingForOpponent.asReadonly();
  readonly tpResult = this._tpResult.asReadonly();
  readonly tpResponseSent = this._tpResponseSent.asReadonly();

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
  private _lastSelectedCards: CardInfo[] = [];
  private _lastSelectedPromptType: string | null = null;
  get lastSelectedCards(): CardInfo[] { return this._lastSelectedCards; }

  // --- Last confirmed/revealed cards (from MSG_CONFIRM_CARDS — excavation/reveal effects) ---
  private _lastConfirmedCards: CardInfo[] = [];
  get lastConfirmedCards(): CardInfo[] { return this._lastConfirmedCards; }

  readonly hasPendingChainEntry = this.processor.hasPendingChainEntry;

  // --- Hint consumed flag ---
  // Set after a prompt response is sent. Prevents stale cardName from a previous
  // effect from bleeding into unrelated prompts via HINT_SELECTMSG merge.
  // Cleared when a fresh HINT type 10/13/15 (card-identifying hint) arrives.
  private _hintCardConsumed = false;

  // --- Just-reconnected flag ---
  // Set to true on STATE_SYNC (reconnect), cleared on the first BOARD_STATE after
  // the game resumes. While true, the activation-toggle auto-respond is suppressed
  // so that prompts re-sent by the server after reconnect are shown to the user.
  private _justReconnected = signal(false);
  readonly justReconnected = this._justReconnected.asReadonly();

  // --- Callbacks (set by wrapper services) ---
  onMessage?: (msg: ServerMessage) => void;
  onResponse?: (promptType: string, data: ResponseData) => void;
  onStateSync?: () => void;

  private readonly storageKey: string;

  constructor(wsUrlBase: string, autoReconnect: boolean, storageKey = 'duel-reconnect-token', logger?: DuelLogger) {
    if (wsUrlBase.startsWith('/')) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.wsUrlBase = `${proto}//${location.host}${wsUrlBase}`;
    } else {
      this.wsUrlBase = wsUrlBase;
    }
    this._autoReconnect = autoReconnect;
    this.storageKey = storageKey;
    this.logger = logger;
    this.processor.logger = logger;
    this.rbs.logger = logger;
  }

  clearStorageToken(): void {
    try { sessionStorage.removeItem(this.storageKey); } catch {}
  }

  // --- Public API ---

  connect(wsToken: string): void {
    if (this._autoReconnect) {
      const stored = sessionStorage.getItem(this.storageKey);
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

  sendResponse(promptType: string, data: ResponseData): void {
    if (this.safeSend({ type: 'PLAYER_RESPONSE', promptType, data })) {
      // Capture selected cards before clearing prompt (for excluding from next prompt)
      const prompt = this._pendingPrompt();
      const accumulate = DuelConnection.ACCUMULATE_SELECTION_TYPES.has(promptType);
      if (prompt && 'cards' in prompt && accumulate) {
        const cards = (prompt as { cards: CardInfo[] }).cards;
        // Reset accumulator when the prompt type changes (e.g. SELECT_UNSELECT_CARD → SELECT_CARD)
        const base = this._lastSelectedPromptType === promptType ? this._lastSelectedCards : [];
        this._lastSelectedPromptType = promptType;
        if ('indices' in data) {
          const indices = data['indices'] as number[];
          this._lastSelectedCards = [...base, ...indices.map(i => cards[i]).filter(Boolean)];
        } else if ('index' in data && data['index'] != null) {
          const card = cards[data['index'] as number];
          this._lastSelectedCards = card ? [...base, card] : base;
        }
        // else: no selection change — keep accumulated list
      } else {
        this._lastSelectedCards = [];
        this._lastSelectedPromptType = null;
      }
      this._lastConfirmedCards = [];
      this._hintCardConsumed = true;
      if (promptType === 'SELECT_TP') this._tpResponseSent.set(true);
      this.onResponse?.(promptType, data);
      this._pendingPrompt.set(null);
      this._inactivityWarning.set(null);
    }
  }

  sendActivityPing(): void {
    this.safeSend({ type: 'ACTIVITY_PING' });
    this._inactivityWarning.set(null);
  }

  sendAnimationsDone(): void {
    this.safeSend({ type: 'ANIMATIONS_DONE' });
  }

  clearRpsResult(): void {
    this._rpsResult.set(null);
  }

  sendSurrender(): void {
    this.safeSend({ type: 'SURRENDER' });
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
  sendCancelPromptSequence(): void {
    this.safeSend({ type: 'CANCEL_PROMPT_SEQUENCE' });
  }

  sendRequestStateSync(): void {
    this.safeSend({ type: 'REQUEST_STATE_SYNC' });
  }

  sendRematchRequest(): void {
    if (this.safeSend({ type: 'REMATCH_REQUEST' })) {
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

  skipPendingAnimations(): void {
    this.processor.reset();
    this.rbs.commitAll();
  }

  /**
   * Drop the prompt-flow accumulators (lastConfirmedCards, lastSelectedCards,
   * promptType streak, hint-consumed flag). M16: solo swap must invoke this
   * on the outgoing connection so the next time it becomes active, its
   * stale CONFIRM/SELECT history doesn't bleed into the next prompt's
   * "revealed cards" panel or exclusion accumulator.
   *
   * NOT called by skipPendingAnimations — that helper is also used in PvP
   * reconnection paths where the buffers are intentionally preserved across
   * a queue reset (server replays them).
   */
  clearLastSelections(): void {
    this._lastConfirmedCards = [];
    this._lastSelectedCards = [];
    this._lastSelectedPromptType = null;
    this._hintCardConsumed = false;
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
      url = `${this.wsUrlBase}?reconnect=${this.reconnectToken}`;
    } else if (this.wsToken) {
      url = `${this.wsUrlBase}?token=${this.wsToken}`;
    } else {
      this._connectionStatus.set('lost');
      return;
    }

    this.ws = new WebSocket(url);

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
      // 4029 = rate limited — no point retrying immediately
      if (event.code === 4029) {
        this.reconnectToken = null;
        try { sessionStorage.removeItem(this.storageKey); } catch {}
        this._hasToken.set(this.wsToken !== null);
        this._connectionStatus.set('lost');
        return;
      }
      // 4001 = invalid/expired token — discard it but let handleReconnect try fallback
      if (event.code === 4001) {
        if (this.reconnectToken) {
          this.reconnectToken = null;
          try { sessionStorage.removeItem(this.storageKey); } catch {}
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
    this.onMessage?.(message);
    this.prefetchRevealedCards(message);
    switch (message.type) {
      case 'BOARD_STATE':
        this._rematchStarting.set(false);
        this._justReconnected.set(false);
        syncAfterBoardState(this.rbs, this.processor.chainPhase(),
          this.processor.animationQueue().length, message.data, this._boardActive);
        break;

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
        this._lastConfirmedCards = [];
        // P0-3bis follow-up — reset the selection accumulator and the
        // hint-consumed flag too.
        this._lastSelectedCards = [];
        this._lastSelectedPromptType = null;
        this._hintCardConsumed = false;
        this._rematchStarting.set(false);
        this.rbs.assertNoLocks('onStateSync');
        this.rbs.updateLogical(message.data);
        this.rbs.commitAll();
        this.processor.reset();
        // Clear stale prompt + hint: server will re-send them in order (hint first, then prompt)
        this._pendingPrompt.set(null);
        this._hintContext.set({ hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' });
        // Suppress auto-respond until the game resumes (first BOARD_STATE after reconnect)
        this._justReconnected.set(true);
        this.onStateSync?.();
        break;

      case 'CHAIN_STATE': {
        const cs = message as ChainStateMsg;
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
        // STATE_SYNC + CHAIN_STATE arrive in same WS batch — queue already cleared by processor.reset() in STATE_SYNC
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
        // Reset exclusion accumulator when the prompt type changes mid-sequence
        // (must happen before _pendingPrompt.set so attachComponent reads the correct value)
        if (this._lastSelectedPromptType !== null && this._lastSelectedPromptType !== message.type) {
          this._lastSelectedCards = [];
          this._lastSelectedPromptType = null;
        }
        if (this.tryAutoRespondEmptyCards(message as SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg | SelectCounterMsg)) break;
        this._waitingForOpponent.set(false);
        this._pendingPrompt.set(message);
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
        this._waitingForOpponent.set(false);
        this._pendingPrompt.set(message);
        break;

      case 'RPS_CHOICE':
        this._rpsResult.set(null);
        this._rpsInProgress.set(true);
        this._pendingPrompt.set(message);
        break;

      case 'RPS_RESULT':
        this._rpsInProgress.set(false);
        this._rpsResult.set(message as RpsResultMsg);
        break;

      case 'SELECT_TP':
        this._waitingForOpponent.set(false);
        this._pendingPrompt.set(message);
        break;

      case 'TP_RESULT':
        this._waitingForOpponent.set(false);
        this._tpResponseSent.set(false);
        this._tpResult.set({ goFirst: (message as { goFirst: boolean }).goFirst });
        break;

      case 'DUEL_STARTING':
        this._tpResult.set(null);
        this._ocgPlayerIndex.set(message.playerIndex as 0 | 1);
        if (message.cardCodes?.length) this._cardCodes.set(message.cardCodes);
        this.logger?.setTraceId(message.traceId);
        break;

      case 'MSG_HINT': {
        const isSelectMsg = message.hintType === 3;
        const isCardHint = !isSelectMsg; // type 10/13/15 identify a new card
        // A fresh card-identifying hint clears the consumed flag
        if (isCardHint) this._hintCardConsumed = false;
        const prev = this._hintContext();
        // Only preserve prev cardName if it hasn't been consumed by a prior prompt response
        const canInherit = isSelectMsg && !this._hintCardConsumed;
        const merged = {
          hintType: message.hintType,
          player: message.player,
          value: message.value,
          cardName: message.cardName || (canInherit ? prev.cardName : ''),
          hintAction: message.hintAction || (canInherit ? prev.hintAction : ''),
        };
        this.logger?.log(DuelLogCategory.PROC, 'MSG_HINT raw: %o => merged: %o', { hintType: message.hintType, cardName: message.cardName, hintAction: message.hintAction, isSelectMsg, canInherit }, merged);
        this._hintContext.set(merged);
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
        this._inactivityWarning.set(message);
        break;

      case 'DUEL_END':
        this._lastConfirmedCards = [];
        this.processor.reset();
        this._pendingPrompt.set(null);
        this._inactivityWarning.set(null);
        this._waitingForOpponent.set(false);
        this._tpResult.set(null);
        this._tpResponseSent.set(false);
        this._duelResult.set(message);
        this._opponentDisconnected.set(false);
        this._disconnectGraceSec.set(0);
        try { sessionStorage.removeItem(this.storageKey); } catch {}
        break;

      case 'REMATCH_INVITATION':
        this._rematchState.set('invited');
        break;

      case 'REMATCH_CANCELLED':
        this._rematchState.set(message.reason === 'opponent_left' ? 'opponent-left' : 'expired');
        break;

      case 'REMATCH_STARTING':
        this._lastConfirmedCards = [];
        this.processor.reset();
        this._rematchStarting.set(true);
        this._duelResult.set(null);
        this._cardCodes.set([]);
        this.rbs.updateLogical(EMPTY_DUEL_STATE);
        this.rbs.commitAll();
        this._pendingPrompt.set(null);
        this._waitingForOpponent.set(false);
        this._tpResult.set(null);
        this._tpResponseSent.set(false);
        this._opponentDisconnected.set(false);
        this._disconnectGraceSec.set(0);
        this._rematchState.set('idle');
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
        this._waitingForOpponent.set(true);
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
          try { sessionStorage.setItem(this.storageKey, this.reconnectToken); } catch {}
        }
        break;

      case 'MSG_CHAINING':
        this.processor.processMessage(message);
        break;

      case 'MSG_CHAIN_SOLVING':
      case 'MSG_CHAIN_SOLVED':
      case 'MSG_CHAIN_END':
      case 'MSG_CHAIN_NEGATED':
        this.processor.processMessage(message);
        break;

      case 'MSG_CONFIRM_CARDS':
        this._lastConfirmedCards = (message as ConfirmCardsMsg).cards;
        this.processor.processMessage(message);
        break;
      case 'MSG_MOVE':
      case 'MSG_DRAW':
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
      try { sessionStorage.removeItem(this.storageKey); } catch {}
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
