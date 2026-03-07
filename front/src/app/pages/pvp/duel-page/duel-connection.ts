import { computed, signal } from '@angular/core';
import { DuelState, EMPTY_DUEL_STATE, Prompt, HintContext, GameEvent, ConnectionStatus, ChainLinkState } from '../types';
import type { ChainingMsg } from '../duel-ws.types';
import { AnnounceCardMsg, CardInfo, DuelEndMsg, InactivityWarningMsg, RpsResultMsg, SelectCardMsg, SelectChainMsg, SelectCounterMsg, SelectSumMsg, SelectTributeMsg, SelectUnselectCardMsg, ServerMessage, SessionTokenMsg, SortCardMsg, SortChainMsg, TimerStateMsg } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';

export type ResponseData = Record<string, unknown>;

export class DuelConnection {
  // --- Signals (13 pairs) ---
  private _duelState = signal<DuelState>(EMPTY_DUEL_STATE);
  private _pendingPrompt = signal<Prompt | null>(null);
  private _hintContext = signal<HintContext>({ hintType: 0, player: 0, value: 0, cardName: '', hintAction: '' });
  private _animationQueue = signal<GameEvent[]>([]);
  private _timerState = signal<TimerStateMsg | null>(null);
  private _connectionStatus = signal<ConnectionStatus>('connected');
  private _opponentDisconnected = signal(false);
  private _activeChainLinks = signal<ChainLinkState[]>([]);
  private _duelResult = signal<DuelEndMsg | null>(null);
  private _rpsResult = signal<RpsResultMsg | null>(null);
  private _rpsInProgress = signal(false);
  private _rematchState = signal<'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired'>('idle');
  private _rematchStarting = signal(false);
  private _inactivityWarning = signal<InactivityWarningMsg | null>(null);
  private _waitingForOpponent = signal(false);

  readonly duelState = this._duelState.asReadonly();
  readonly pendingPrompt = this._pendingPrompt.asReadonly();
  readonly hintContext = this._hintContext.asReadonly();
  readonly animationQueue = this._animationQueue.asReadonly();
  readonly timerState = this._timerState.asReadonly();
  readonly connectionStatus = this._connectionStatus.asReadonly();
  readonly opponentDisconnected = this._opponentDisconnected.asReadonly();
  readonly activeChainLinks = this._activeChainLinks.asReadonly();
  readonly duelResult = this._duelResult.asReadonly();
  readonly rpsResult = this._rpsResult.asReadonly();
  readonly rpsInProgress = this._rpsInProgress.asReadonly();
  readonly rematchState = this._rematchState.asReadonly();
  readonly rematchStarting = this._rematchStarting.asReadonly();
  readonly inactivityWarning = this._inactivityWarning.asReadonly();
  readonly waitingForOpponent = this._waitingForOpponent.asReadonly();

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
  private _lastSelectedCards: CardInfo[] = [];
  get lastSelectedCards(): CardInfo[] { return this._lastSelectedCards; }

  // --- Callbacks (set by wrapper services) ---
  onMessage?: (msg: ServerMessage) => void;
  onResponse?: (promptType: string, data: ResponseData) => void;

  constructor(wsUrlBase: string, autoReconnect: boolean) {
    this.wsUrlBase = wsUrlBase;
    this._autoReconnect = autoReconnect;
  }

  // --- Public API ---

  connect(wsToken: string): void {
    if (this._autoReconnect) {
      const stored = sessionStorage.getItem('duel-reconnect-token');
      if (stored) this.reconnectToken = stored;
    }
    this.wsToken = wsToken;
    this._retryCount.set(0);
    this.openConnection();
  }

  sendResponse(promptType: string, data: ResponseData): void {
    if (this.safeSend({ type: 'PLAYER_RESPONSE', promptType, data })) {
      // Capture selected cards before clearing prompt (for excluding from next prompt)
      const prompt = this._pendingPrompt();
      if (prompt && 'cards' in prompt) {
        const cards = (prompt as { cards: CardInfo[] }).cards;
        if ('indices' in data) {
          const indices = data['indices'] as number[];
          this._lastSelectedCards = indices.map(i => cards[i]).filter(Boolean);
        } else if ('index' in data && data['index'] != null) {
          const card = cards[data['index'] as number];
          this._lastSelectedCards = card ? [card] : [];
        } else {
          this._lastSelectedCards = [];
        }
      } else {
        this._lastSelectedCards = [];
      }
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

  skipPendingAnimations(): void {
    this._animationQueue.set([]);
  }

  applyChainSolving(chainIndex: number): void {
    this._activeChainLinks.update(links =>
      links.map(l => l.chainIndex === chainIndex ? { ...l, resolving: true } : l),
    );
  }

  applyChainSolved(chainIndex: number): void {
    this._activeChainLinks.update(links =>
      links.filter(l => l.chainIndex !== chainIndex),
    );
  }

  applyChainEnd(): void {
    this._activeChainLinks.set([]);
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

  private autoSelectSort(message: SortCardMsg | SortChainMsg): void {
    this.sendResponse(message.type, { order: null });
  }

  private tryAutoRespondEmptyCards(message: SelectCardMsg | SelectChainMsg | SelectTributeMsg | SelectSumMsg | SelectUnselectCardMsg | SelectCounterMsg): boolean {
    if (message.cards.length > 0) return false;
    if (message.type === 'SELECT_SUM' && message.mustSelect.length > 0) return false;

    console.warn(`[DuelConnection] Empty cards for ${message.type} — auto-responding`);

    if (message.type === 'SELECT_CHAIN' || message.type === 'SELECT_UNSELECT_CARD') {
      this.sendResponse(message.type, { index: null });
    } else if (message.type === 'SELECT_COUNTER') {
      this.sendResponse(message.type, { counters: [] });
    } else {
      this.sendResponse(message.type, { indices: [] });
    }
    return true;
  }

  private autoSelectAnnounceCard(message: AnnounceCardMsg): void {
    const value = message.opcodes.length > 0 ? message.opcodes[0] : 0;
    this.sendResponse(message.type, { value });
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
        try { sessionStorage.removeItem('duel-reconnect-token'); } catch {}
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
        this._duelState.set(message.data);
        // Chain links are now cleared by MSG_CHAIN_END through the animation queue,
        // so animations remain visible until the orchestrator processes them.
        break;

      case 'STATE_SYNC':
        this._rematchStarting.set(false);
        this._duelState.set(message.data);
        this._activeChainLinks.set([]);
        this._animationQueue.set([]);
        break;

      case 'SELECT_CARD':
      case 'SELECT_CHAIN':
      case 'SELECT_TRIBUTE':
      case 'SELECT_SUM':
      case 'SELECT_UNSELECT_CARD':
      case 'SELECT_COUNTER':
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
        this.autoSelectSort(message);
        break;
      case 'ANNOUNCE_CARD':
        this.autoSelectAnnounceCard(message);
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
        // HINT_SELECTMSG (3) arrives after a card hint — preserve prior cardName
        // Other hint types start a new context — clear stale fields
        const isSelectMsg = message.hintType === 3;
        const prev = this._hintContext();
        const merged = {
          hintType: message.hintType,
          player: message.player,
          value: message.value,
          cardName: message.cardName || (isSelectMsg ? prev.cardName : ''),
          hintAction: message.hintAction || (isSelectMsg ? prev.hintAction : ''),
        };
        console.log('[HintContext] type=%d value=%d cardName=%s hintAction=%s | prev.cardName=%s prev.hintAction=%s | merged.cardName=%s merged.hintAction=%s',
          message.hintType, message.value, JSON.stringify(message.cardName), JSON.stringify(message.hintAction),
          JSON.stringify(prev.cardName), JSON.stringify(prev.hintAction),
          JSON.stringify(merged.cardName), JSON.stringify(merged.hintAction));
        this._hintContext.set(merged);
        break;
      }

      case 'TIMER_STATE':
        this._timerState.set(message);
        break;

      case 'INACTIVITY_WARNING':
        this._inactivityWarning.set(message);
        break;

      case 'DUEL_END':
        this._pendingPrompt.set(null);
        this._inactivityWarning.set(null);
        this._waitingForOpponent.set(false);
        this._duelResult.set(message);
        this._opponentDisconnected.set(false);
        this._activeChainLinks.set([]);
        this._animationQueue.set([]);
        try { sessionStorage.removeItem('duel-reconnect-token'); } catch {}
        break;

      case 'REMATCH_INVITATION':
        this._rematchState.set('invited');
        break;

      case 'REMATCH_CANCELLED':
        this._rematchState.set(message.reason === 'opponent_left' ? 'opponent-left' : 'expired');
        break;

      case 'REMATCH_STARTING':
        this._rematchStarting.set(true);
        this._duelResult.set(null);
        this._duelState.set(EMPTY_DUEL_STATE);
        this._pendingPrompt.set(null);
        this._waitingForOpponent.set(false);
        this._opponentDisconnected.set(false);
        this._rematchState.set('idle');
        this._activeChainLinks.set([]);
        this._animationQueue.set([]);
        break;

      case 'OPPONENT_DISCONNECTED':
        this._opponentDisconnected.set(true);
        break;

      case 'OPPONENT_RECONNECTED':
        this._opponentDisconnected.set(false);
        break;

      case 'WAITING_RESPONSE':
        this._waitingForOpponent.set(true);
        break;

      case 'SESSION_TOKEN':
        this.reconnectToken = (message as SessionTokenMsg).token;
        if (this._autoReconnect) {
          try { sessionStorage.setItem('duel-reconnect-token', this.reconnectToken); } catch {}
        }
        break;

      case 'MSG_CHAINING': {
        const msg = message as ChainingMsg;
        this._activeChainLinks.update(links => [...links, {
          chainIndex: msg.chainIndex,
          cardCode: msg.cardCode,
          cardName: msg.cardName,
          player: msg.player,
          zoneId: locationToZoneId(msg.location, msg.sequence),
          resolving: false,
        }]);
        this._animationQueue.update(q => [...q, message]);
        break;
      }

      case 'MSG_CHAIN_SOLVING':
      case 'MSG_CHAIN_SOLVED':
      case 'MSG_CHAIN_END':
        this._animationQueue.update(q => [...q, message]);
        break;

      case 'MSG_MOVE':
      case 'MSG_DRAW':
      case 'MSG_DAMAGE':
      case 'MSG_RECOVER':
      case 'MSG_PAY_LPCOST':
      case 'MSG_FLIP_SUMMONING':
      case 'MSG_CHANGE_POS':
      case 'MSG_SWAP':
      case 'MSG_ATTACK':
      case 'MSG_BATTLE':
        this._animationQueue.update(q => [...q, message]);
        break;

      default:
        console.log('Unhandled message type:', (message as ServerMessage).type);
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
    console.warn('WebSocket not open, message dropped:', data);
    return false;
  }
}
