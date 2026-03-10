import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DuelConnection, ResponseData } from './duel-connection';
import { DebugLogService } from './debug-log.service';

export { ResponseData } from './duel-connection';

@Injectable()
export class DuelWebSocketService implements OnDestroy {
  private readonly debugLog = inject(DebugLogService);

  private readonly _defaultConnection = new DuelConnection(environment.wsUrl, true);
  private _activeConnection = signal<DuelConnection>(this._defaultConnection);

  constructor() {
    this._defaultConnection.onMessage = msg => {
      this.debugLog.logServerMessage(msg);
    };
    this._defaultConnection.onResponse = (promptType, data) => {
      this.debugLog.logPlayerResponse(promptType, data);
    };
  }

  // --- Swappable connection ---

  setActiveConnection(connection: DuelConnection): void {
    this._activeConnection.set(connection);
  }

  // --- All 13 signals + canRetry computed through _activeConnection ---

  readonly duelState = computed(() => this._activeConnection().duelState());
  readonly pendingPrompt = computed(() => this._activeConnection().pendingPrompt());
  readonly hintContext = computed(() => this._activeConnection().hintContext());
  readonly animationQueue = computed(() => this._activeConnection().animationQueue());
  readonly timerState = computed(() => this._activeConnection().timerState());
  readonly connectionStatus = computed(() => this._activeConnection().connectionStatus());
  readonly opponentDisconnected = computed(() => this._activeConnection().opponentDisconnected());
  readonly activeChainLinks = computed(() => this._activeConnection().activeChainLinks());
  readonly chainPhase = computed(() => this._activeConnection().chainPhase());
  readonly hasPendingChainEntry = computed(() => this._activeConnection().hasPendingChainEntry());
  readonly duelResult = computed(() => this._activeConnection().duelResult());
  readonly rpsResult = computed(() => this._activeConnection().rpsResult());
  readonly rpsInProgress = computed(() => this._activeConnection().rpsInProgress());
  readonly rematchState = computed(() => this._activeConnection().rematchState());
  readonly rematchStarting = computed(() => this._activeConnection().rematchStarting());
  readonly inactivityWarning = computed(() => this._activeConnection().inactivityWarning());
  readonly waitingForOpponent = computed(() => this._activeConnection().waitingForOpponent());

  readonly canRetry = computed(() => this._activeConnection().canRetry());

  // --- Delegated methods ---

  connect(wsToken: string): void {
    this._activeConnection().connect(wsToken);
  }

  sendResponse(promptType: string, data: ResponseData): void {
    this._activeConnection().sendResponse(promptType, data);
  }

  get lastSelectedCards(): import('../duel-ws.types').CardInfo[] {
    return this._activeConnection().lastSelectedCards;
  }

  clearRpsResult(): void {
    this._activeConnection().clearRpsResult();
  }

  sendSurrender(): void {
    this._activeConnection().sendSurrender();
  }

  sendRequestStateSync(): void {
    this._activeConnection().sendRequestStateSync();
  }

  sendRematchRequest(): void {
    this._activeConnection().sendRematchRequest();
  }

  sendActivityPing(): void {
    this._activeConnection().sendActivityPing();
  }

  dequeueAnimation(): import('../types').GameEvent | null {
    return this._activeConnection().dequeueAnimation();
  }

  clearAnimationQueue(): void {
    this._activeConnection().skipPendingAnimations();
  }

  applyChainSolving(chainIndex: number): void {
    this._activeConnection().applyChainSolving(chainIndex);
  }

  applyChainSolved(chainIndex: number): void {
    this._activeConnection().applyChainSolved(chainIndex);
  }

  applyChainEnd(): void {
    this._activeConnection().applyChainEnd();
  }

  retryConnection(): void {
    this._activeConnection().retryConnection();
  }

  ngOnDestroy(): void {
    this._defaultConnection.cleanup();
  }
}
