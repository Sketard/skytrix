import { computed, DestroyRef, effect, inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { DuelConnection } from './duel-connection';
import { DuelWebSocketService } from './duel-web-socket.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { DebugLogService } from './debug-log.service';
import { DuelLogger } from './duel-logger';
import { DuelCardArtService } from './duel-card-art.service';

@Injectable()
export class SoloDuelOrchestratorService {
  private readonly wsService = inject(DuelWebSocketService);
  private readonly animationService = inject(AnimationOrchestratorService);
  private readonly debugLog = inject(DebugLogService);
  private readonly logger = inject(DuelLogger);
  private readonly artService = inject(DuelCardArtService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  enabled = false;
  private _connections = signal<[DuelConnection, DuelConnection] | null>(null);
  readonly connections = this._connections.asReadonly();
  readonly activePlayerIndex = signal<0 | 1>(0);
  private _rematchReset = signal(0);
  readonly rematchReset = this._rematchReset.asReadonly();

  readonly connectionLost = computed(() => {
    const conns = this._connections();
    return conns !== null && (conns[0].connectionStatus() === 'lost' || conns[1].connectionStatus() === 'lost');
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  init(token1: string, token2: string): void {
    this.enabled = true;
    const conn0 = new DuelConnection(environment.wsUrl, true, 'duel-reconnect-token-p1', this.logger);
    const conn1 = new DuelConnection(environment.wsUrl, true, 'duel-reconnect-token-p2', this.logger);
    // Share the art service so the prefetch dedup Set is unified — switching
    // players doesn't re-prefetch the same cards.
    conn0.artService = this.artService;
    conn1.artService = this.artService;

    // Set callbacks on both connections
    conn0.onMessage = msg => this.debugLog.logServerMessage(msg);
    conn1.onMessage = msg => this.debugLog.logServerMessage(msg);
    conn0.onResponse = (promptType, data) => this.debugLog.logPlayerResponse(promptType, data);
    conn1.onResponse = (promptType, data) => this.debugLog.logPlayerResponse(promptType, data);
    conn0.onStateSync = () => this.wsService.onStateSync?.();
    conn1.onStateSync = () => this.wsService.onStateSync?.();

    this._connections.set([conn0, conn1]);
    conn0.connect(token1);
    conn1.connect(token2);
    this.wsService.setActiveConnection(conn0);

    this.setupRematchEffects();
  }

  switchPlayer(): void {
    const conns = this._connections();
    if (!conns) return;

    const outgoingIndex = this.activePlayerIndex();
    const newIndex: 0 | 1 = outgoingIndex === 0 ? 1 : 0;

    conns[outgoingIndex].skipPendingAnimations();
    // Clear the incoming connection's accumulated animation queue — it has been
    // receiving events since game start (MSG_DRAW, MSG_MOVE, etc.) but its RBS
    // is already fully committed (_boardActive was false → every BOARD_STATE
    // called commitAll). Without this, resetForSwitch resets _initialDrawDone
    // and the stale MSG_DRAW events re-trigger the initial draw animation on
    // top of already-visible cards.
    conns[newIndex].skipPendingAnimations();
    // M16: drop prompt-flow accumulators on both sides. Otherwise the
    // outgoing connection's lastConfirmedCards/lastSelectedCards persist
    // until its next sendResponse, and would surface in the next prompt's
    // "revealed cards" panel after switching back.
    conns[outgoingIndex].clearLastSelections();
    conns[newIndex].clearLastSelections();
    this.animationService.resetForSwitch();
    this.activePlayerIndex.set(newIndex);
    this.wsService.setActiveConnection(conns[newIndex]);
    // Ensure the incoming connection buffers BOARD_STATE instead of applying it immediately.
    // setBoardActive is only called once at game start (on P1's connection), so P2 would
    // otherwise apply every BOARD_STATE instantly, bypassing the animation masking system.
    conns[newIndex].setBoardActive(true);
  }

  cleanup(): void {
    const conns = this._connections();
    if (conns) {
      conns[0].clearStorageToken();
      conns[1].clearStorageToken();
      conns[0].cleanup();
      conns[1].cleanup();
    }
  }

  private setupRematchEffects(): void {
    const conns = this._connections();
    if (!conns) return;

    runInInjectionContext(this.injector, () => {
      // Effect 1: auto-accept rematch on the connection that receives REMATCH_INVITATION
      effect(() => {
        const state0 = conns[0].rematchState();
        const state1 = conns[1].rematchState();
        if (state0 === 'invited') {
          conns[0].sendRematchRequest();
        }
        if (state1 === 'invited') {
          conns[1].sendRematchRequest();
        }
      }, { allowSignalWrites: true });

      // Effect 2: handle rematch reset when both connections receive REMATCH_STARTING
      effect(() => {
        const starting0 = conns[0].rematchStarting();
        const starting1 = conns[1].rematchStarting();
        if (starting0 && starting1) {
          conns[0].skipPendingAnimations();
          conns[1].skipPendingAnimations();
          this.activePlayerIndex.set(0);
          this.wsService.setActiveConnection(conns[0]);
          this.animationService.resetForSwitch();
          conns[0].resetRematchStarting();
          conns[1].resetRematchStarting();
          this._rematchReset.update(c => c + 1);
        }
      }, { allowSignalWrites: true });
    });
  }
}
