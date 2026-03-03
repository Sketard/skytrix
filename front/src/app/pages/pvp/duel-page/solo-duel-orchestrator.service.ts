import { computed, DestroyRef, effect, inject, Injectable, Injector, runInInjectionContext, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../../environments/environment';
import { DuelConnection } from './duel-connection';
import { DuelWebSocketService } from './duel-web-socket.service';
import { AnimationOrchestratorService } from './animation-orchestrator.service';
import { DebugLogService } from './debug-log.service';

@Injectable()
export class SoloDuelOrchestratorService {
  private readonly wsService = inject(DuelWebSocketService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly animationService = inject(AnimationOrchestratorService);
  private readonly debugLog = inject(DebugLogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  enabled = false;
  private _connections = signal<[DuelConnection, DuelConnection] | null>(null);
  readonly connections = this._connections.asReadonly();
  readonly activePlayerIndex = signal<0 | 1>(0);
  readonly firstPlayer = signal<0 | 1>(0);
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
    const conn0 = new DuelConnection(environment.wsUrl, false);
    const conn1 = new DuelConnection(environment.wsUrl, false);

    // Set callbacks on both connections
    conn0.onAutoSelect = (type: string) => {
      if (this.activePlayerIndex() === 0) this.snackBar.open(`Auto-selected: ${type}`, '', { duration: 2000 });
    };
    conn1.onAutoSelect = (type: string) => {
      if (this.activePlayerIndex() === 1) this.snackBar.open(`Auto-selected: ${type}`, '', { duration: 2000 });
    };

    conn0.onMessage = msg => this.debugLog.logServerMessage(msg);
    conn1.onMessage = msg => this.debugLog.logServerMessage(msg);
    conn0.onResponse = (promptType, data) => this.debugLog.logPlayerResponse(promptType, data);
    conn1.onResponse = (promptType, data) => this.debugLog.logPlayerResponse(promptType, data);

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
    this.animationService.resetForSwitch();
    this.activePlayerIndex.set(newIndex);
    this.wsService.setActiveConnection(conns[newIndex]);
  }

  cleanup(): void {
    const conns = this._connections();
    if (conns) {
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

      // Effect 2: auto-respond RPS — determine who goes first
      effect(() => {
        const rps0 = conns[0].rpsInProgress();
        const rps1 = conns[1].rpsInProgress();
        if (rps0 && rps1) {
          const first = this.firstPlayer();
          const second: 0 | 1 = first === 0 ? 1 : 0;
          conns[first].sendResponse('RPS_CHOICE', { choice: 0 }); // Rock
          conns[second].sendResponse('RPS_CHOICE', { choice: 2 }); // Scissors
        }
      }, { allowSignalWrites: true });

      // Effect 3: handle rematch reset when both connections receive REMATCH_STARTING
      effect(() => {
        const starting0 = conns[0].rematchStarting();
        const starting1 = conns[1].rematchStarting();
        if (starting0 && starting1) {
          this.activePlayerIndex.set(0);
          this.wsService.setActiveConnection(conns[0]);
          conns[0].resetRematchStarting();
          conns[1].resetRematchStarting();
          this._rematchReset.update(c => c + 1);
        }
      }, { allowSignalWrites: true });
    });
  }
}
