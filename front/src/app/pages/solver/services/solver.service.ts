import { inject, Injectable, OnDestroy } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../core/services/notification.service';
import { SolverDebugLogService } from './solver-debug-log.service';
import { computed, signal } from '@angular/core';
import { duelAssert } from '../../../core/utilities/duel-assert';
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
  EndBoardCard,
  HistoryEntry,
  HistoryEntryConfig,
} from '../../../core/model/solver.model';

const SESSION_HISTORY_CAP = 10;
const INIT_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 2_000;
const IDLE_CHECK_INTERVAL_MS = 60_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;
/** After a reconnect, if the WS replies with SOLVER_HANDTRAPS but no cached
 *  SOLVER_RESULT follows within this window, a previously-running solve is
 *  considered orphaned (server-side cache evicted) and the page is unlocked. */
const RECONNECT_RESULT_GRACE_MS = 1_500;
/** Cooldown between Solve clicks — matches the server-side rate limit so the
 *  Solve button stays visibly disabled instead of round-tripping a RATE_LIMITED
 *  error (Story 1.5b). */
const SOLVE_COOLDOWN_MS = 2_000;
const PREFS_STORAGE_KEY = 'solver:prefs:v1';

export interface SolverPrefs {
  speed: 'fast' | 'optimal';
  algorithm: 'dfs' | 'mcts' | 'auto';
  mode: 'goldfish';
  handtrapIds: number[];
}

const DEFAULT_PREFS: SolverPrefs = {
  speed: 'fast',
  algorithm: 'auto',
  mode: 'goldfish',
  handtrapIds: [],
};

function loadPrefs(): SolverPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<SolverPrefs>;
    return {
      speed: parsed.speed === 'optimal' ? 'optimal' : 'fast',
      algorithm: parsed.algorithm === 'dfs' || parsed.algorithm === 'mcts' || parsed.algorithm === 'auto'
        ? parsed.algorithm
        : 'auto',
      mode: 'goldfish',
      handtrapIds: Array.isArray(parsed.handtrapIds) ? parsed.handtrapIds.filter(n => Number.isInteger(n)) : [],
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

@Injectable({ providedIn: 'root' })
export class SolverService implements OnDestroy {
  private readonly notify = inject(NotificationService);
  private readonly debugLog = inject(SolverDebugLogService, { optional: true });

  readonly solverState = signal<SolverState>('idle');
  readonly progress = signal<SolverProgress | null>(null);
  readonly result = signal<SolverResult | null>(null);
  readonly error = signal<SolverErrorMessage | null>(null);
  readonly handtraps = signal<HandtrapConfig[] | null>(null);
  /** True when SOLVER_HANDTRAPS failed to load after the init retry. Goldfish
   *  mode stays usable; only adversarial features should disable themselves. */
  readonly handtrapsLoadFailed = signal(false);
  readonly sessionHistory = signal<HistoryEntry[]>([]);
  readonly currentDeckId = signal<string | null>(null);
  readonly isPartialResult = computed(() => this.result()?.partial === true);

  /** Persisted user preferences (mode/speed/algorithm/handtraps) — Story 1.5a. */
  readonly prefs = signal<SolverPrefs>(loadPrefs());

  /** Per-deck hand selection (cardId → copy count). Persists across navigation
   *  for the lifetime of the SolverService singleton — resets when the deck
   *  context changes (different deckId). Story 1.5a. */
  private readonly handsByDeck = signal<Record<string, Record<number, number>>>({});

  /** Timestamp of the most recent SOLVER_START send — used to enforce the
   *  client-side 2s cooldown so the Solve button stays disabled instead of
   *  round-tripping a RATE_LIMITED error from the server. Story 1.5b. */
  readonly lastSolveAt = signal<number>(0);
  readonly cooldownUntil = computed(() => this.lastSolveAt() + SOLVE_COOLDOWN_MS);

  private readonly lastSolveConfig = signal<HistoryEntryConfig | null>(null);

  getHandForDeck(deckId: string): Record<number, number> {
    return this.handsByDeck()[deckId] ?? {};
  }

  setHandForDeck(deckId: string, hand: Record<number, number>): void {
    this.handsByDeck.update(prev => ({ ...prev, [deckId]: hand }));
  }

  updatePrefs(partial: Partial<SolverPrefs>): void {
    const next: SolverPrefs = { ...this.prefs(), ...partial };
    this.prefs.set(next);
    try {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch { /* quota / private mode — silently ignore */ }
  }

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
  private reconnectResultGraceId: ReturnType<typeof setTimeout> | null = null;

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
    hand: number[];
    mode: 'goldfish' | 'adversarial';
    speed: 'fast' | 'optimal';
    algorithm?: 'dfs' | 'mcts' | 'auto';
    handtraps?: { cardId: number; cardName: string }[];
    deckSeed?: string;
  }): void {
    this.lastInteractionTs = Date.now();
    this.lastSolveAt.set(Date.now());
    this.lastSolveDeckId = config.deckId;
    this.solverState.set('running');
    this.progress.set(null);
    this.result.set(null);
    this.error.set(null);

    const solveConfig: HistoryEntryConfig = {
      deckId: config.deckId,
      hand: { ...this.getHandForDeck(config.deckId) },
      mode: config.mode,
      speed: config.speed,
      algorithm: config.algorithm ?? this.prefs().algorithm,
      handtraps: this.prefs().handtrapIds,
    };

    const msg: SolverStartMessage = { type: SOLVER_START, ...config };
    if (this.sendMessage(msg)) {
      this.lastSolveConfig.set(solveConfig);
    } else {
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
        this.handtrapsLoadFailed.set(false);

        // Reconnect-during-running guard: if the page was waiting on a solve
        // when the WS dropped, the server replays the cached SOLVER_RESULT
        // immediately after SOLVER_HANDTRAPS. If no result follows within the
        // grace window, the cache was evicted and the spinner would otherwise
        // hang forever — fall back to 'configuring' so the user can re-run.
        if (this.solverState() === 'running') {
          if (this.reconnectResultGraceId !== null) clearTimeout(this.reconnectResultGraceId);
          this.reconnectResultGraceId = setTimeout(() => {
            this.reconnectResultGraceId = null;
            if (this.solverState() !== 'running') return;
            this.solverState.set('configuring');
            this.progress.set(null);
            this.notify.error('solver.error.resultEvicted');
          }, RECONNECT_RESULT_GRACE_MS);
        }
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
          stalled: payload.stalled,
        });
        break;
      }

      case SOLVER_RESULT: {
        // Cancel the post-reconnect grace timer — a real result is arriving.
        if (this.reconnectResultGraceId !== null) {
          clearTimeout(this.reconnectResultGraceId);
          this.reconnectResultGraceId = null;
        }
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
            endBoardCards: [],
            stats: payload.stats as unknown as SolverStats,
            partial: true,
          };
          this.result.set(partialResult);
          this.addToHistory(partialResult);
          this.solverState.set('complete');
        } else {
          this.solverState.set('configuring');
        }
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
      endBoardCards: payload.endBoardCards ?? [],
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
    const config = this.lastSolveConfig();
    if (!config) return;
    this.sessionHistory.update(history => {
      const base = history.length >= SESSION_HISTORY_CAP ? history.slice(1) : history;
      return [...base, { result, config, partial: result.partial }];
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
        // Goldfish (Epic 1) does not consume handtraps. Mark the failure on a
        // dedicated signal so adversarial features (Epic 2) can self-disable,
        // but keep the page usable for goldfish solves. Do NOT enter the
        // global 'error' state, which would block everything.
        this.handtrapsLoadFailed.set(true);
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
    if (this.reconnectResultGraceId !== null) {
      clearTimeout(this.reconnectResultGraceId);
      this.reconnectResultGraceId = null;
    }
  }
}
