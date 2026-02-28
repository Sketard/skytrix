import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../../environments/environment';
import { DuelState, EMPTY_DUEL_STATE, Prompt, HintContext, GameEvent, ConnectionStatus } from '../types';
import { AnnounceCardMsg, DuelEndMsg, RpsResultMsg, ServerMessage, SessionTokenMsg, SortCardMsg, SortChainMsg, TimerStateMsg } from '../duel-ws.types';

export type ResponseData = Record<string, unknown>;

@Injectable()
export class DuelWebSocketService implements OnDestroy {
  private readonly snackBar = inject(MatSnackBar);
  private _duelState = signal<DuelState>(EMPTY_DUEL_STATE);
  private _pendingPrompt = signal<Prompt | null>(null);
  private _hintContext = signal<HintContext>({ hintType: 0, player: 0, value: 0 });
  private _animationQueue = signal<GameEvent[]>([]);
  private _timerState = signal<TimerStateMsg | null>(null);
  private _connectionStatus = signal<ConnectionStatus>('connected');
  private _opponentDisconnected = signal(false);

  readonly duelState = this._duelState.asReadonly();
  readonly pendingPrompt = this._pendingPrompt.asReadonly();
  readonly hintContext = this._hintContext.asReadonly();
  readonly animationQueue = this._animationQueue.asReadonly();
  readonly timerState = this._timerState.asReadonly();
  readonly connectionStatus = this._connectionStatus.asReadonly();
  readonly opponentDisconnected = this._opponentDisconnected.asReadonly();

  private ws: WebSocket | null = null;
  private retryCount = 0;
  private readonly MAX_RETRIES = 6;
  private wsToken: string | null = null;
  private reconnectToken: string | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private _duelResult = signal<DuelEndMsg | null>(null);
  private _rpsResult = signal<RpsResultMsg | null>(null);
  private _rpsInProgress = signal(false);
  private _rematchState = signal<'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired'>('idle');
  private _rematchStarting = signal(false);

  readonly duelResult = this._duelResult.asReadonly();
  readonly rpsResult = this._rpsResult.asReadonly();
  readonly rpsInProgress = this._rpsInProgress.asReadonly();
  readonly rematchState = this._rematchState.asReadonly();
  readonly rematchStarting = this._rematchStarting.asReadonly();

  get canRetry(): boolean {
    return this.retryCount < this.MAX_RETRIES;
  }

  connect(wsToken: string): void {
    this.wsToken = wsToken;
    this.retryCount = 0;
    this.openConnection();
  }

  sendResponse(promptType: string, data: ResponseData): void {
    this.ws?.send(JSON.stringify({ type: 'PLAYER_RESPONSE', promptType, data }));
    this._pendingPrompt.set(null);
  }

  clearRpsResult(): void {
    this._rpsResult.set(null);
  }

  sendSurrender(): void {
    this.ws?.send(JSON.stringify({ type: 'SURRENDER' }));
  }

  sendRematchRequest(): void {
    this.ws?.send(JSON.stringify({ type: 'REMATCH_REQUEST' }));
    this._rematchState.set('requested');
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private openConnection(): void {
    // Use reconnect token if available (post-connection reconnection), otherwise initial token
    let url: string;
    if (this.reconnectToken) {
      url = `${environment.wsUrl}?reconnect=${this.reconnectToken}`;
    } else if (this.wsToken) {
      url = `${environment.wsUrl}?token=${this.wsToken}`;
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
      this.retryCount = 0;
      this._opponentDisconnected.set(false);
      this._rematchStarting.set(false);
      // Only reset rematchState on initial connection (not reconnection) to avoid
      // desyncing with server-side rematchRequested state during rematch negotiation
      if (!this.reconnectToken) {
        this._rematchState.set('idle');
      }
      // Clear initial token after first successful connection — reconnect token takes over
      this.wsToken = null;
    };

    this.ws.onmessage = event => {
      const message: ServerMessage = JSON.parse(event.data);
      this.handleMessage(message);
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
    switch (message.type) {
      case 'BOARD_STATE':
      case 'STATE_SYNC':
        this._rematchStarting.set(false);
        this._duelState.set(message.data);
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

      // Auto-select fallback (PvP-A0) — respond immediately with first valid option
      case 'SORT_CARD':
      case 'SORT_CHAIN':
        this.autoSelectSort(message);
        break;
      case 'ANNOUNCE_CARD':
        this.autoSelectAnnounceCard(message);
        break;

      // RPS (pre-duel Rock/Paper/Scissors)
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

      case 'MSG_MOVE':
      case 'MSG_DRAW':
      case 'MSG_DAMAGE':
      case 'MSG_RECOVER':
      case 'MSG_PAY_LPCOST':
      case 'MSG_CHAINING':
      case 'MSG_CHAIN_SOLVING':
      case 'MSG_CHAIN_SOLVED':
      case 'MSG_CHAIN_END':
      case 'MSG_FLIP_SUMMONING':
      case 'MSG_CHANGE_POS':
      case 'MSG_SWAP':
      case 'MSG_ATTACK':
      case 'MSG_BATTLE':
        // TODO: Story 4.2 — re-enable when animation consumer exists
        // this._animationQueue.update(q => [...q, message]);
        break;

      default:
        console.log('Unhandled message type:', (message as ServerMessage).type);
        break;
    }
  }

  private autoSelectSort(message: SortCardMsg | SortChainMsg): void {
    this.sendResponse(message.type, { order: null });
    this.snackBar.open(`Auto-selected: ${message.type}`, '', { duration: 2000 });
  }

  private autoSelectAnnounceCard(message: AnnounceCardMsg): void {
    const value = message.opcodes.length > 0 ? message.opcodes[0] : 0;
    this.sendResponse(message.type, { value });
    this.snackBar.open(`Auto-selected: ${message.type}`, '', { duration: 2000 });
  }

  private handleReconnect(): void {
    if (this.retryCount >= this.MAX_RETRIES) {
      this._connectionStatus.set('lost');
      return;
    }

    this._connectionStatus.set('reconnecting');
    const delay = Math.min(Math.pow(2, this.retryCount) * 1000, 30_000); // 1s, 2s, 4s, 8s, 16s, 30s cap
    this.retryCount++;

    this.retryTimeout = setTimeout(() => {
      this.openConnection();
    }, delay);
  }

  retryConnection(): void {
    this.retryCount = 0;
    this._connectionStatus.set('reconnecting');
    this.openConnection();
  }

  private cleanup(): void {
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
}
