import { inject, Injectable, OnDestroy } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../core/services/notification.service';
import { SolverDebugLogService } from './solver-debug-log.service';
import { signal } from '@angular/core';
import { duelAssert } from '../../pvp/duel-page/duel-assert';
import type {
  SolverStartMessage,
  SolverProgressMessage,
  SolverResultMessage,
  SolverCancelledMessage,
  SolverErrorMessage as SolverErrorWsMsg,
  SolverHandtrapsMessage,
} from '../../pvp/duel-ws.types';
import {
  SOLVER_INIT,
  SOLVER_START,
  SOLVER_CANCEL,
  SOLVER_PROGRESS,
  SOLVER_RESULT,
  SOLVER_CANCELLED,
  SOLVER_ERROR,
  SOLVER_HANDTRAPS,
} from '../../pvp/duel-ws.types';
import {
  EMPTY_SCORE_BREAKDOWN,
} from '../../../core/model/solver.model';
import type {
  SolverState,
  SolverProgress,
  SolverResult,
  SolverErrorMessage,
  HandtrapConfig,
  DecisionNode,
  SolverAction,
  ScoreBreakdown,
  SolverStats,
  AdversarialTiming,
} from '../../../core/model/solver.model';

const SESSION_HISTORY_CAP = 20;
const INIT_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 2_000;
const IDLE_CHECK_INTERVAL_MS = 60_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;

@Injectable({ providedIn: 'root' })
export class SolverService implements OnDestroy {
  private readonly notify = inject(NotificationService);
  private readonly debugLog = inject(SolverDebugLogService, { optional: true });

  readonly solverState = signal<SolverState>('idle');
  readonly progress = signal<SolverProgress | null>(null);
  readonly result = signal<SolverResult | null>(null);
  readonly error = signal<SolverErrorMessage | null>(null);
  readonly handtraps = signal<HandtrapConfig[] | null>(null);
  readonly sessionHistory = signal<SolverResult[]>([]);
  readonly currentDeckId = signal<string | null>(null);

  private ws: WebSocket | null = null;
  private lastSolveDeckId: string | null = null;
  private initTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private retryCount = 0;
  private resultAsserted = false;
  private lastInteractionTs = Date.now();
  private idleIntervalId: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  connect(): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) return;

    const token = localStorage.getItem('ACCESS_TOKEN');
    if (!token) {
      console.warn('[SolverService] No ACCESS_TOKEN — cannot connect');
      this.solverState.set('error');
      this.error.set({ error: 'INTERNAL_ERROR', message: 'Not authenticated' });
      return;
    }

    this.intentionalClose = false;
    const url = `${environment.wsUrl}?mode=solver&token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.retryCount = 0;
      this.sendMessage({ type: SOLVER_INIT });
      this.startInitTimeout();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        console.warn('[SolverService] Failed to parse WS message');
        return;
      }

      this.debugLog?.logMessage(msg, 'solver-in');
      this.handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.intentionalClose && !this.destroyed) {
        this.attemptReconnect();
      }
    };

    this.ws.onerror = () => {
      console.warn('[SolverService] WebSocket error');
    };

    this.startIdleTimer();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  solve(config: {
    deckId: string;
    deck: { main: number[]; extra: number[] };
    hand: number[];
    mode: 'goldfish';
    speed: 'fast' | 'optimal';
    algorithm?: 'dfs' | 'mcts' | 'auto';
    deckSeed?: string;
  }): void {
    this.lastInteractionTs = Date.now();
    this.lastSolveDeckId = config.deckId;
    this.solverState.set('running');
    this.progress.set(null);
    this.result.set(null);
    this.error.set(null);

    const msg: SolverStartMessage = { type: SOLVER_START, ...config };
    if (!this.sendMessage(msg)) {
      this.solverState.set('error');
      this.error.set({ error: 'INTERNAL_ERROR', message: 'Connection not ready' });
      this.notify.error('solver.error.connectionFailed');
    }
  }

  cancel(): void {
    this.lastInteractionTs = Date.now();
    this.sendMessage({ type: SOLVER_CANCEL });
  }

  setDeckContext(deckId: string): void {
    this.lastInteractionTs = Date.now();
    this.currentDeckId.set(deckId);
    if (this.solverState() === 'loading') {
      this.solverState.set('idle');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  private handleMessage(msg: { type: string; [k: string]: unknown }): void {
    switch (msg.type) {
      case SOLVER_HANDTRAPS: {
        if (this.initTimeoutId !== null) {
          clearTimeout(this.initTimeoutId);
          this.initTimeoutId = null;
        }
        const payload = msg as unknown as SolverHandtrapsMessage;
        this.handtraps.set(payload.handtraps as HandtrapConfig[]);
        break;
      }

      case SOLVER_PROGRESS: {
        if (this.solverState() !== 'running') return;
        const payload = msg as unknown as SolverProgressMessage;
        this.progress.set({
          nodesExplored: payload.nodesExplored,
          bestScore: payload.bestScore,
          elapsed: payload.elapsed,
          highComplexity: payload.highComplexity,
        });
        break;
      }

      case SOLVER_RESULT: {
        const payload = msg as unknown as SolverResultMessage;
        const result = this.mapResult(payload);
        this.addToHistory(result);

        const state = this.solverState();
        if (state === 'running') {
          this.result.set(result);
          this.solverState.set('complete');
        } else if (state === 'idle' || state === 'configuring') {
          if (this.lastSolveDeckId !== null && this.lastSolveDeckId === this.currentDeckId()) {
            this.result.set(result);
            this.solverState.set('complete');
          }
        }
        // cancelled/error → silent history add only
        break;
      }

      case SOLVER_CANCELLED: {
        const payload = msg as unknown as SolverCancelledMessage;
        if (payload.partialTree) {
          const partialResult: SolverResult = {
            tree: payload.partialTree as unknown as DecisionNode,
            mainPath: [],
            score: 0,
            scoreBreakdown: EMPTY_SCORE_BREAKDOWN,
            stats: payload.stats as unknown as SolverStats,
          };
          this.result.set(partialResult);
          this.addToHistory(partialResult);
        }
        this.solverState.set('configuring');
        break;
      }

      case SOLVER_ERROR: {
        const payload = msg as unknown as SolverErrorWsMsg;
        this.error.set({ error: payload.error, message: payload.message });
        this.notify.error(payload.message, undefined, 0);
        this.solverState.set('configuring');
        break;
      }
    }
  }

  private mapResult(payload: SolverResultMessage): SolverResult {
    const result: SolverResult = {
      tree: payload.tree as unknown as DecisionNode,
      mainPath: payload.mainPath as unknown as SolverAction[],
      score: payload.score,
      scoreBreakdown: payload.scoreBreakdown as unknown as ScoreBreakdown,
      stats: payload.stats as unknown as SolverStats,
      adversarialTimings: payload.adversarialTimings as unknown as AdversarialTiming[] | undefined,
      minimax: payload.minimax,
      verified: payload.verified,
    };

    if (!this.resultAsserted) {
      this.resultAsserted = true;
      duelAssert(
        result.tree?.children !== undefined,
        'SolverService',
        'SOLVER_RESULT tree.children missing — WS/model type drift',
      );
      duelAssert(
        result.stats?.algorithmUsed !== undefined,
        'SolverService',
        'SOLVER_RESULT stats.algorithmUsed missing',
      );
    }

    return result;
  }

  private addToHistory(result: SolverResult): void {
    this.sessionHistory.update(history => {
      const next = history.length >= SESSION_HISTORY_CAP ? history.slice(1) : [...history];
      next.push(result);
      return next;
    });
  }

  private sendMessage(msg: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      this.debugLog?.logMessage(msg as { type: string; [k: string]: unknown }, 'solver-out');
      return true;
    } catch {
      return false;
    }
  }

  private startInitTimeout(): void {
    if (this.initTimeoutId !== null) clearTimeout(this.initTimeoutId);
    this.initTimeoutId = setTimeout(() => {
      this.initTimeoutId = null;
      if (this.handtraps() !== null) return;

      if (this.retryCount === 0) {
        this.retryCount = 1;
        this.disconnect();
        this.connect();
      } else {
        this.solverState.set('error');
        this.error.set({ error: 'INTERNAL_ERROR', message: 'Handtrap data unavailable — check server connection' });
      }
    }, INIT_TIMEOUT_MS);
  }

  private attemptReconnect(): void {
    if (this.reconnectTimeoutId !== null) return;
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      if (!this.destroyed && !this.intentionalClose) {
        this.connect();
      }
    }, RECONNECT_DELAY_MS);
  }

  private startIdleTimer(): void {
    if (this.idleIntervalId !== null) return;
    this.idleIntervalId = setInterval(() => {
      const state = this.solverState();
      if (
        Date.now() - this.lastInteractionTs > IDLE_TIMEOUT_MS &&
        (state === 'idle' || state === 'configuring')
      ) {
        this.disconnect();
      }
    }, IDLE_CHECK_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.initTimeoutId !== null) {
      clearTimeout(this.initTimeoutId);
      this.initTimeoutId = null;
    }
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.idleIntervalId !== null) {
      clearInterval(this.idleIntervalId);
      this.idleIntervalId = null;
    }
  }
}
