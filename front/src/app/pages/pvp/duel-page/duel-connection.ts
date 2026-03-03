import { computed, signal } from '@angular/core';
import { DuelState, EMPTY_DUEL_STATE, Prompt, HintContext, GameEvent, ConnectionStatus, ChainLinkState } from '../types';
import type { ChainingMsg } from '../duel-ws.types';
import { AnnounceCardMsg, DuelEndMsg, RpsResultMsg, ServerMessage, SessionTokenMsg, SortCardMsg, SortChainMsg, TimerStateMsg } from '../duel-ws.types';
import { locationToZoneId } from '../pvp-zone.utils';

export type ResponseData = Record<string, unknown>;

export class DuelConnection {
  // --- Signals (13 pairs) ---
  private _duelState = signal<DuelState>(EMPTY_DUEL_STATE);
  private _pendingPrompt = signal<Prompt | null>(null);
  private _hintContext = signal<HintContext>({ hintType: 0, player: 0, value: 0 });
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

  // --- Callbacks (set by wrapper services) ---
  onAutoSelect?: (type: string) => void;
  onMessage?: (msg: ServerMessage) => void;
  onResponse?: (promptType: string, data: ResponseData) => void;

  constructor(wsUrlBase: string, autoReconnect: boolean) {
    this.wsUrlBase = wsUrlBase;
    this._autoReconnect = autoReconnect;
  }

  // --- Public API ---

  connect(wsToken: string): void {
    this.wsToken = wsToken;
    this._retryCount.set(0);
    this.openConnection();
  }

  sendResponse(promptType: string, data: ResponseData): void {
    if (this.safeSend({ type: 'PLAYER_RESPONSE', promptType, data })) {
      this.onResponse?.(promptType, data);
      this._pendingPrompt.set(null);
    }
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
    this.onAutoSelect?.(message.type);
  }

  private autoSelectAnnounceCard(message: AnnounceCardMsg): void {
    const value = message.opcodes.length > 0 ? message.opcodes[0] : 0;
    this.sendResponse(message.type, { value });
    this.onAutoSelect?.(message.type);
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

    this.ws.onclose = () => {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
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
        this._activeChainLinks.set([]);
        break;

      case 'STATE_SYNC':
        this._rematchStarting.set(false);
        this._duelState.set(message.data);
        this._activeChainLinks.set([]);
        this._animationQueue.set([]);
        break;

      case 'SELECT_IDLECMD':
      case 'SELECT_BATTLECMD':
      case 'SELECT_CARD':
      case 'SELECT_CHAIN':
      case 'SELECT_EFFECTYN':
      case 'SELECT_YESNO':
      case 'SELECT_PLACE':
      case 'SELECT_DISFIELD':
      case 'SELECT_POSITION':
      case 'SELECT_OPTION':
      case 'SELECT_TRIBUTE':
      case 'SELECT_SUM':
      case 'SELECT_UNSELECT_CARD':
      case 'SELECT_COUNTER':
      case 'ANNOUNCE_RACE':
      case 'ANNOUNCE_ATTRIB':
      case 'ANNOUNCE_NUMBER':
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

      case 'MSG_HINT':
        this._hintContext.set({ hintType: message.hintType, player: message.player, value: message.value });
        break;

      case 'TIMER_STATE':
        this._timerState.set(message);
        break;

      case 'DUEL_END':
        this._pendingPrompt.set(null);
        this._duelResult.set(message);
        this._opponentDisconnected.set(false);
        this._activeChainLinks.set([]);
        this._animationQueue.set([]);
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

      case 'SESSION_TOKEN':
        this.reconnectToken = (message as SessionTokenMsg).token;
        break;

      case 'MSG_CHAINING': {
        const msg = message as ChainingMsg;
        this._activeChainLinks.update(links => [...links, {
          chainIndex: msg.chainIndex,
          cardCode: msg.cardCode,
          player: msg.player,
          zoneId: locationToZoneId(msg.location, msg.sequence),
          resolving: false,
        }]);
        this._animationQueue.update(q => [...q, message]);
        break;
      }

      case 'MSG_CHAIN_SOLVING':
        this._activeChainLinks.update(links =>
          links.map(l => l.chainIndex === message.chainIndex ? { ...l, resolving: true } : l),
        );
        break;

      case 'MSG_CHAIN_SOLVED':
        this._activeChainLinks.update(links =>
          links.filter(l => l.chainIndex !== message.chainIndex),
        );
        break;

      case 'MSG_CHAIN_END':
        this._activeChainLinks.set([]);
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
