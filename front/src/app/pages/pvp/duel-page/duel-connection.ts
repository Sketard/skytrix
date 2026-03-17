import { computed, signal } from '@angular/core';
import { DuelState, EMPTY_DUEL_STATE, Prompt, HintContext, GameEvent, ConnectionStatus, ChainLinkState } from '../types';
import type { ChainingMsg, MoveMsg } from '../duel-ws.types';
import { CardInfo, ConfirmCardsMsg, DuelEndMsg, InactivityWarningMsg, RpsResultMsg, SelectCardMsg, SelectChainMsg, SelectCounterMsg, SelectSumMsg, SelectTributeMsg, SelectUnselectCardMsg, ServerMessage, SessionTokenMsg, TimerStateMsg } from '../duel-ws.types';
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
  private _duelState = signal<DuelState>(EMPTY_DUEL_STATE);
  private _pendingPrompt = signal<Prompt | null>(null);
  private _hintContext = signal<HintContext>({ hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' });
  private _animationQueue = signal<GameEvent[]>([]);
  private _timerState = signal<TimerStateMsg | null>(null);
  private _timerStatePerPlayer = signal<[TimerStateMsg | null, TimerStateMsg | null]>([null, null]);
  private _connectionStatus = signal<ConnectionStatus>('connected');
  private _opponentDisconnected = signal(false);
  private _disconnectGraceSec = signal(0);
  private _activeChainLinks = signal<ChainLinkState[]>([]);
  private _chainPhase = signal<'idle' | 'building' | 'resolving'>('idle');
  private _duelResult = signal<DuelEndMsg | null>(null);
  private _rpsResult = signal<RpsResultMsg | null>(null);
  private _rpsInProgress = signal(false);
  private _rematchState = signal<'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired'>('idle');
  private _rematchStarting = signal(false);
  private _inactivityWarning = signal<InactivityWarningMsg | null>(null);
  private _waitingForOpponent = signal(false);
  private _pendingBoardState: DuelState | null = null;
  private _boardActive = false;
  private _animating = false;
  private _drawMaskActive = false;
  private _pendingBoardStateTimer: ReturnType<typeof setTimeout> | null = null;

  readonly duelState = this._duelState.asReadonly();
  readonly pendingPrompt = this._pendingPrompt.asReadonly();
  readonly hintContext = this._hintContext.asReadonly();
  readonly animationQueue = this._animationQueue.asReadonly();
  readonly timerState = this._timerState.asReadonly();
  readonly timerStatePerPlayer = this._timerStatePerPlayer.asReadonly();
  readonly connectionStatus = this._connectionStatus.asReadonly();
  readonly opponentDisconnected = this._opponentDisconnected.asReadonly();
  readonly disconnectGraceSec = this._disconnectGraceSec.asReadonly();
  readonly activeChainLinks = this._activeChainLinks.asReadonly();
  readonly chainPhase = this._chainPhase.asReadonly();
  readonly duelResult = this._duelResult.asReadonly();
  readonly rpsResult = this._rpsResult.asReadonly();
  readonly rpsInProgress = this._rpsInProgress.asReadonly();
  readonly rematchState = this._rematchState.asReadonly();
  readonly rematchStarting = this._rematchStarting.asReadonly();
  readonly inactivityWarning = this._inactivityWarning.asReadonly();
  readonly waitingForOpponent = this._waitingForOpponent.asReadonly();

  /** Dev-only: inject a fake prompt to test prompt UI without a real duel. */
  debugInjectPrompt(prompt: ServerMessage): void {
    this._pendingPrompt.set(prompt as any);
  }

  // --- Reconnect state ---
  private _retryCount = signal(0);
  private readonly _maxRetries = 6;
  private readonly _autoReconnect: boolean;

  readonly canRetry = computed(() => this._retryCount() < this._maxRetries && this._autoReconnect);

  // --- WS internals ---
  private ws: WebSocket | null = null;
  private wsToken: string | null = null;
  private reconnectToken: string | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly wsUrlBase: string;

  // --- Last selected cards (for excluding from next card-selection prompt) ---
  // Only accumulated within a streak of the same prompt type; resets on type change.
  private _lastSelectedCards: CardInfo[] = [];
  private _lastSelectedPromptType: string | null = null;
  get lastSelectedCards(): CardInfo[] { return this._lastSelectedCards; }

  // --- Last confirmed/revealed cards (from MSG_CONFIRM_CARDS — excavation/reveal effects) ---
  private _lastConfirmedCards: CardInfo[] = [];
  get lastConfirmedCards(): CardInfo[] { return this._lastConfirmedCards; }

  // --- Pending chain entry ---
  // MSG_CHAINING stores here instead of immediately adding to _activeChainLinks.
  // Committed when cost prompts are resolved (SELECT_CHAIN, MSG_CHAIN_SOLVING, next MSG_CHAINING).
  private _pendingChainEntry: ChainLinkState | null = null;
  private _hasPendingChainEntry = signal(false);
  readonly hasPendingChainEntry = this._hasPendingChainEntry.asReadonly();

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

  constructor(wsUrlBase: string, autoReconnect: boolean, storageKey = 'duel-reconnect-token') {
    if (wsUrlBase.startsWith('/')) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.wsUrlBase = `${proto}//${location.host}${wsUrlBase}`;
    } else {
      this.wsUrlBase = wsUrlBase;
    }
    this._autoReconnect = autoReconnect;
    this.storageKey = storageKey;
  }

  clearStorageToken(): void {
    try { sessionStorage.removeItem(this.storageKey); } catch {}
  }

  /** Flush pending chain entry into activeChainLinks (cost is resolved). */
  private commitPendingChainEntry(): void {
    if (this._pendingChainEntry) {
      const entry = this._pendingChainEntry;
      this._pendingChainEntry = null;
      this._hasPendingChainEntry.set(false);
      this._activeChainLinks.update(links => [...links, entry]);
    }
  }

  // --- Public API ---

  connect(wsToken: string): void {
    if (this._autoReconnect) {
      const stored = sessionStorage.getItem(this.storageKey);
      if (stored) this.reconnectToken = stored;
    }
    this.wsToken = wsToken;
    this._retryCount.set(0);
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
      this._hintCardConsumed = true;
      this.onResponse?.(promptType, data);
      this._pendingPrompt.set(null);
      this._inactivityWarning.set(null);
    }
  }

  sendActivityPing(): void {
    this.safeSend({ type: 'ACTIVITY_PING' });
    this._inactivityWarning.set(null);
  }

  clearRpsResult(): void {
    this._rpsResult.set(null);
  }

  sendSurrender(): void {
    this.safeSend({ type: 'SURRENDER' });
  }

  sendRequestStateSync(): void {
    this.safeSend({ type: 'REQUEST_STATE_SYNC' });
  }

  sendRematchRequest(): void {
    if (this.safeSend({ type: 'REMATCH_REQUEST' })) {
      this._rematchState.set('requested');
    }
  }

  dequeueAnimation(): GameEvent | null {
    const q = this._animationQueue();
    if (q.length === 0) return null;
    const first = q[0];
    this._animationQueue.update(queue => queue.slice(1));
    return first;
  }

  removeAnimationAt(index: number): void {
    this._animationQueue.update(q => [...q.slice(0, index), ...q.slice(index + 1)]);
  }

  skipPendingAnimations(): void {
    this._animationQueue.set([]);
    this.applyPendingBoardState();
    // If chain RESOLUTION was in progress when switching, force-clear so the overlay doesn't
    // freeze on the next view (MSG_CHAIN_END would never fire since the queue was cleared).
    // 'building' phase is intentionally left intact — chain links are still valid data.
    if (this._chainPhase() === 'resolving') {
      this.applyChainEnd();
    }
  }

  applyPendingBoardState(): void {
    this.cancelPendingBoardStateFlush();
    if (this._pendingBoardState) {
      this._duelState.set(this._pendingBoardState);
      this._pendingBoardState = null;
    }
  }

  /**
   * Schedule auto-flush of pending board state after a short delay.
   * If animation events arrive before the timer fires, the timer is cancelled
   * (via cancelPendingBoardStateFlush called from setAnimating).
   */
  private schedulePendingBoardStateFlush(): void {
    this.cancelPendingBoardStateFlush();
    this._pendingBoardStateTimer = setTimeout(() => {
      this._pendingBoardStateTimer = null;
      // Only auto-flush if no animations started in the meantime.
      // During chain resolution, the orchestrator controls when board state is applied
      // (after overlay exit + replay) — never auto-flush in that phase.
      if (!this._animating && this._animationQueue().length === 0
        && this._chainPhase() !== 'resolving') {
        this.applyPendingBoardState();
      }
    }, 50);
  }

  private cancelPendingBoardStateFlush(): void {
    if (this._pendingBoardStateTimer !== null) {
      clearTimeout(this._pendingBoardStateTimer);
      this._pendingBoardStateTimer = null;
    }
  }

  setBoardActive(active: boolean): void {
    this._boardActive = active;
  }

  setAnimating(animating: boolean): void {
    this._animating = animating;
    if (animating) {
      this.cancelPendingBoardStateFlush();
    }
  }

  setDrawMaskActive(active: boolean): void {
    this._drawMaskActive = active;
  }

  applyChainSolving(chainIndex: number): void {
    this._chainPhase.set('resolving');
    this._activeChainLinks.update(links =>
      links.map(l => l.chainIndex === chainIndex ? { ...l, resolving: true } : l),
    );
  }

  applyChainSolved(chainIndex: number): void {
    this._activeChainLinks.update(links =>
      links.filter(l => l.chainIndex !== chainIndex),
    );
    console.log('[DBG:BADGE] applyChainSolved idx=%d → remaining links=%o',
      chainIndex, this._activeChainLinks().map(l => ({ idx: l.chainIndex, loc: l.location, seq: l.sequence, zoneId: l.zoneId })));
  }

  applyChainEnd(): void {
    this._chainPhase.set('idle');
    this._activeChainLinks.set([]);
    console.log('[DBG:BADGE] applyChainEnd → phase=idle, links cleared');
  }

  private applyChainNegated(chainIndex: number): void {
    if (this._pendingChainEntry?.chainIndex === chainIndex) {
      this._pendingChainEntry = { ...this._pendingChainEntry, negated: true };
    }
    this._activeChainLinks.update(links =>
      links.map(l => l.chainIndex === chainIndex ? { ...l, negated: true } : l),
    );
  }

  resetRematchStarting(): void {
    this._rematchStarting.set(false);
  }

  retryConnection(): void {
    this._retryCount.set(0);
    this._connectionStatus.set('reconnecting');
    this.openConnection();
  }

  cleanup(): void {
    this.cancelPendingBoardStateFlush();
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
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
      return;
    }

    this.ws = new WebSocket(url);

    this.connectionTimeout = setTimeout(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.ws?.close();
        this.handleReconnect();
      }
    }, 5000);

    this.ws.onopen = () => {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      this._connectionStatus.set('connected');
      this._retryCount.set(0);
      this._opponentDisconnected.set(false);
      this._rematchStarting.set(false);
      if (!this.reconnectToken) {
        this._rematchState.set('idle');
      }
      this.wsToken = null;
    };

    this.ws.onmessage = event => {
      try {
        const message: ServerMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    this.ws.onclose = (event) => {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
      if (event.code === 4001) {
        this.reconnectToken = null;
        try { sessionStorage.removeItem(this.storageKey); } catch {}
        this._connectionStatus.set('lost');
        return;
      }
      if (this._connectionStatus() !== 'lost') {
        this.handleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will be called after onerror
    };
  }

  private handleMessage(message: ServerMessage): void {
    this.onMessage?.(message);
    switch (message.type) {
      case 'BOARD_STATE':
        this._rematchStarting.set(false);
        this._justReconnected.set(false);
        if (!this._boardActive) {
          this._duelState.set(message.data);
        } else if (this._drawMaskActive) {
          // Draw masking handles visual hiding — apply immediately
          this._duelState.set(message.data);
        } else {
          // Buffer for non-draw animations — apply when queue empties
          this._pendingBoardState = message.data;
          this.schedulePendingBoardStateFlush();
        }
        break;

      case 'STATE_SYNC':
        this._lastConfirmedCards = [];
        this._rematchStarting.set(false);
        this._pendingBoardState = null;
        this._duelState.set(message.data);
        this._activeChainLinks.set([]);
        this._chainPhase.set('idle');
        this._animationQueue.set([]);
        // Clear stale prompt + hint: server will re-send them in order (hint first, then prompt)
        this._pendingPrompt.set(null);
        this._hintContext.set({ hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' });
        // Suppress auto-respond until the game resumes (first BOARD_STATE after reconnect)
        this._justReconnected.set(true);
        this.onStateSync?.();
        break;

      case 'SELECT_CARD':
      case 'SELECT_CHAIN':
      case 'SELECT_TRIBUTE':
      case 'SELECT_SUM':
      case 'SELECT_UNSELECT_CARD':
      case 'SELECT_COUNTER':
        // SELECT_CHAIN means cost phase is done — commit pending chain entry
        if (message.type === 'SELECT_CHAIN') this.commitPendingChainEntry();
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
        this._waitingForOpponent.set(false);
        this._pendingPrompt.set(message);
        break;

      case 'SORT_CARD':
      case 'SORT_CHAIN':
      case 'ANNOUNCE_CARD':
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
        console.log('[MSG_HINT] raw:', { hintType: message.hintType, cardName: message.cardName, hintAction: message.hintAction, isSelectMsg, canInherit }, '=> merged:', merged);
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
        this._pendingChainEntry = null;
        this._hasPendingChainEntry.set(false);
        this._pendingPrompt.set(null);
        this._inactivityWarning.set(null);
        this._waitingForOpponent.set(false);
        this._duelResult.set(message);
        this._opponentDisconnected.set(false);
        this._disconnectGraceSec.set(0);
        this._activeChainLinks.set([]);
        this._chainPhase.set('idle');
        this._animationQueue.set([]);
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
        this._pendingChainEntry = null;
        this._hasPendingChainEntry.set(false);
        this._rematchStarting.set(true);
        this._duelResult.set(null);
        this._duelState.set(EMPTY_DUEL_STATE);
        this._pendingPrompt.set(null);
        this._waitingForOpponent.set(false);
        this._opponentDisconnected.set(false);
        this._disconnectGraceSec.set(0);
        this._rematchState.set('idle');
        this._activeChainLinks.set([]);
        this._chainPhase.set('idle');
        this._animationQueue.set([]);
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
        this.commitPendingChainEntry();
        this._waitingForOpponent.set(true);
        break;

      case 'SESSION_TOKEN':
        this.reconnectToken = (message as SessionTokenMsg).token;
        if (this._autoReconnect) {
          try { sessionStorage.setItem(this.storageKey, this.reconnectToken); } catch {}
        }
        break;

      case 'MSG_CHAINING': {
        const msg = message as ChainingMsg;
        if (this._chainPhase() === 'idle') {
          this._chainPhase.set('building');
        }
        // Commit any previous pending entry first (its cost is resolved)
        this.commitPendingChainEntry();
        // Store as pending — will be committed when cost prompts are resolved
        this._pendingChainEntry = {
          chainIndex: msg.chainIndex,
          cardCode: msg.cardCode,
          cardName: msg.cardName,
          player: msg.player,
          zoneId: locationToZoneId(msg.location, msg.sequence),
          location: msg.location,
          sequence: msg.sequence,
          resolving: false,
          negated: false,
        };
        this._hasPendingChainEntry.set(true);
        this._animationQueue.update(q => [...q, message]);
        break;
      }

      case 'MSG_CHAIN_SOLVING':
        console.log('[DBG:CONN] MSG_CHAIN_SOLVING chainIndex=%d | links=%o',
          (message as any).chainIndex,
          this._activeChainLinks().map(l => ({ idx: l.chainIndex, negated: l.negated, resolving: l.resolving })));
        this.commitPendingChainEntry();
        // Phase transition deferred to applyChainSolving() — called by orchestrator when queue reaches this event
        this._animationQueue.update(q => [...q, message]);
        break;
      case 'MSG_CHAIN_SOLVED':
        console.log('[DBG:CONN] MSG_CHAIN_SOLVED chainIndex=%d', (message as any).chainIndex);
        this._animationQueue.update(q => [...q, message]);
        break;
      case 'MSG_CHAIN_END':
        console.log('[DBG:CONN] MSG_CHAIN_END');
        this.commitPendingChainEntry();
        // Phase transition deferred to applyChainEnd() — called by orchestrator when queue reaches this event
        this._animationQueue.update(q => [...q, message]);
        break;

      case 'MSG_CHAIN_NEGATED':
        console.log('[DBG:CONN] MSG_CHAIN_NEGATED chainIndex=%d | links before=%o',
          message.chainIndex,
          this._activeChainLinks().map(l => ({ idx: l.chainIndex, negated: l.negated, resolving: l.resolving })));
        this.applyChainNegated(message.chainIndex);
        console.log('[DBG:CONN] MSG_CHAIN_NEGATED links after=%o',
          this._activeChainLinks().map(l => ({ idx: l.chainIndex, negated: l.negated, resolving: l.resolving })));
        break;

      case 'MSG_CONFIRM_CARDS':
        this._lastConfirmedCards = (message as ConfirmCardsMsg).cards;
        this._animationQueue.update(q => [...q, message]);
        break;
      case 'MSG_MOVE':
        this._animationQueue.update(q => [...q, message]);
        break;
      case 'MSG_DRAW':
      case 'MSG_SHUFFLE_HAND':
      case 'MSG_SHUFFLE_DECK':
      case 'MSG_DAMAGE':
      case 'MSG_RECOVER':
      case 'MSG_PAY_LPCOST':
      case 'MSG_FLIP_SUMMONING':
      case 'MSG_CHANGE_POS':
      case 'MSG_SWAP':
      case 'MSG_ATTACK':
      case 'MSG_BATTLE':
      case 'MSG_BECOME_TARGET':
        this._animationQueue.update(q => [...q, message]);
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

    if (this._retryCount() >= this._maxRetries) {
      this._connectionStatus.set('lost');
      return;
    }

    this._connectionStatus.set('reconnecting');
    const delay = Math.min(Math.pow(2, this._retryCount()) * 1000, 30_000);
    this._retryCount.update(c => c + 1);

    this.retryTimeout = setTimeout(() => {
      this.openConnection();
    }, delay);
  }

  private safeSend(data: object): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }
}
