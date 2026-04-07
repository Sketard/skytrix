// =============================================================================
// solver-orchestrator.ts — Main thread solver pool management & result aggregation
// Manages a piscina worker pool, dispatches solves with seed diversity,
// aggregates top-K results, enforces 1 solve per user concurrency.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { Piscina } from 'piscina';
import type {
  DuelConfig,
  SolverConfig,
  SolverConfigFile,
  SolverResult,
  SolverProgress,
  SolverAction,
  SolverError,
  DecisionNode,
} from './solver-types.js';

// =============================================================================
// Types
// =============================================================================

interface ActiveSolve {
  controller: AbortController;
  resolved: boolean;
}

type SolveOutcome = {
  type: 'result';
  result: SolverResult;
} | {
  type: 'error';
  error: SolverError;
  message: string;
};

type OnProgress = (progress: SolverProgress) => void;
type OnDebug = (cat: string, data: unknown) => void;

interface WorkerResult {
  results: SolverResult[];
  snapshotAvailable: boolean;
}

// =============================================================================
// mainPath Hash Utility (Task 4)
// =============================================================================

export function hashMainPath(mainPath: SolverAction[]): string {
  return mainPath.map(a => a.responseIndex).join(',');
}

// =============================================================================
// SolverOrchestrator
// =============================================================================

export class SolverOrchestrator {
  private pool!: Piscina;
  private poolSize!: number;
  private config!: SolverConfigFile;
  private activeSolves = new Map<string, ActiveSolve>();

  async init(configFile: SolverConfigFile, dataDir: string, workerPathOverride?: string): Promise<void> {
    this.config = configFile;
    this.poolSize = configFile.poolSize || (availableParallelism() - 2);

    const memPerWorker = Math.floor(
      (configFile.memoryBudgetMb - (this.poolSize * 20)) / this.poolSize,
    );

    const workerPath = workerPathOverride ?? resolve(import.meta.dirname!, 'solver-worker.js');

    this.pool = new Piscina({
      filename: workerPath,
      minThreads: this.poolSize,
      maxThreads: this.poolSize,
      idleTimeout: Infinity,
      workerData: { dataDir },
      resourceLimits: {
        maxOldGenerationSizeMb: memPerWorker,
      },
      // Piscina runtime supports workerTerminateTimeout (zombie worker cleanup)
      // but @types/piscina may not expose it — safe to pass at runtime.
      workerTerminateTimeout: configFile.timeBudgetOptimalMs * 2,
    } as ConstructorParameters<typeof Piscina>[0]);

    console.log('[Solver] pool-ready', {
      poolSize: this.poolSize,
      memoryPerWorkerMb: memPerWorker,
      snapshotMode: false,
    });

    // Health check: dispatch a no-op task and verify it resolves within 10s
    try {
      const healthPromise = this.pool.run({ type: 'health-check' });
      const timeout = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 10_000));
      const race = await Promise.race([healthPromise, timeout]);
      if (race === 'timeout') {
        console.warn('[Solver] pool-degraded — worker boot failed (timeout)');
      }
    } catch (err) {
      console.warn('[Solver] pool-degraded — worker boot failed', err);
    }
  }

  // ===========================================================================
  // solve — Dispatch work to pool, aggregate results
  // ===========================================================================

  async solve(
    userId: string,
    duelConfig: DuelConfig,
    solverConfig: SolverConfig,
    algorithm: 'dfs' | 'mcts' | 'auto',
    onProgress: OnProgress,
    onDebug?: OnDebug,
    deckId?: string,
  ): Promise<SolveOutcome> {
    // Concurrency enforcement: abort existing solve for this user
    const existing = this.activeSolves.get(userId);
    if (existing && !existing.resolved) {
      existing.controller.abort();
      existing.resolved = true;
    }

    const controller = new AbortController();
    const activeSolve: ActiveSolve = { controller, resolved: false };
    this.activeSolves.set(userId, activeSolve);

    const startTime = Date.now();

    // Seed diversity: generate unique seeds per worker
    const seeds = Array.from({ length: this.poolSize }, () => {
      const buf = randomBytes(16);
      return [buf.readBigUInt64LE(0), buf.readBigUInt64LE(8)];
    });

    // Progress aggregation state
    const workerProgress = new Map<number, SolverProgress>();
    let lastProgressEmit = 0;

    // Set up MessageChannels for progress streaming
    const channels: MessageChannel[] = [];
    const workerPromises: Promise<WorkerResult>[] = [];

    for (let i = 0; i < this.poolSize; i++) {
      const { port1, port2 } = new MessageChannel();
      channels.push({ port1, port2 } as MessageChannel);

      port1.on('message', (msg: { type: string; data?: SolverProgress; cat?: string }) => {
        if (activeSolve.resolved) return;

        if (msg.type === 'progress' && msg.data) {
          workerProgress.set(i, msg.data);

          // Throttled aggregated progress emission
          const now = Date.now();
          if (now - lastProgressEmit >= this.config.progressThrottleMs) {
            lastProgressEmit = now;
            let maxBestScore = -1;
            let sumNodes = 0;
            for (const p of workerProgress.values()) {
              if (p.bestScore > maxBestScore) maxBestScore = p.bestScore;
              sumNodes += p.nodesExplored;
            }
            onProgress({
              nodesExplored: sumNodes,
              bestScore: maxBestScore,
              elapsed: now - startTime,
            });
          }
        } else if (msg.type === 'debug' && onDebug && process.env['LOG_LEVEL'] === 'debug') {
          onDebug(msg.cat ?? '', msg.data);
        }
      });

      const task = {
        duelConfig,
        solverConfig,
        seed: seeds[i],
        algorithm,
        progressPort: port2,
        topK: 3,
      };

      workerPromises.push(
        this.pool.run(task, {
          signal: controller.signal,
          // piscina accepts MessagePort in transferList at runtime but its
          // types don't export TransferList — suppress with targeted cast.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transferList: [port2] as any,
        }) as Promise<WorkerResult>,
      );
    }

    // Hard-kill timeout: timeLimitMs * 1.5
    const hardKillMs = solverConfig.timeLimitMs * 1.5;
    let hardKillTimer: ReturnType<typeof setTimeout>;
    const hardKillPromise = new Promise<'hard-kill'>(r => {
      hardKillTimer = setTimeout(() => r('hard-kill'), hardKillMs);
    });

    try {
      const allSettled = Promise.allSettled(workerPromises);
      const race = await Promise.race([allSettled, hardKillPromise]);

      let settledResults: PromiseSettledResult<WorkerResult>[];

      if (race === 'hard-kill') {
        // Hard-kill: abort all workers, collect whatever is settled
        controller.abort();

        // Give workers a brief moment to settle, then snapshot
        const settled = await Promise.race([
          allSettled,
          new Promise<PromiseSettledResult<WorkerResult>[]>(r =>
            setTimeout(() => r([]), 500),
          ),
        ]);
        settledResults = settled;
      } else {
        settledResults = race;
      }

      // Collect successful results (even if cancelled — partial result support AC10)
      const allResults: SolverResult[] = [];
      let snapshotAvailable = false;
      let workersUsed = 0;
      let hadOom = false;

      for (const settled of settledResults) {
        if (settled.status === 'fulfilled' && settled.value?.results) {
          const wr = settled.value;
          if (wr.results.length > 0) {
            allResults.push(...wr.results);
            workersUsed++;
          }
          if (wr.snapshotAvailable) snapshotAvailable = true;
        } else if (settled.status === 'rejected') {
          const err = settled.reason as Error;
          if (err?.message?.includes('heap')) {
            console.warn('[Solver] Worker OOM', err.message);
            hadOom = true;
          }
        }
      }

      // Cancelled — return partial result if available (AC10)
      if (activeSolve.resolved) {
        if (allResults.length > 0) {
          return { type: 'result', result: this.mergeResults(allResults) };
        }
        return { type: 'error', error: 'INTERNAL_ERROR', message: 'Solve was cancelled' };
      }
      activeSolve.resolved = true;

      if (allResults.length === 0) {
        if (hadOom) {
          return { type: 'error', error: 'MEMORY_LIMIT', message: 'Solver worker exceeded memory limit' };
        }
        if (race === 'hard-kill') {
          return { type: 'error', error: 'INTERNAL_ERROR', message: 'Solve hard-kill timeout exceeded' };
        }
        return { type: 'error', error: 'INTERNAL_ERROR', message: 'No results from workers' };
      }

      // Merge & deduplicate results
      const merged = this.mergeResults(allResults);
      const elapsedMs = Date.now() - startTime;

      console.log('[Solver] solve-complete', {
        deckId: deckId ?? 'N/A',
        algorithm,
        mode: solverConfig.mode,
        speed: solverConfig.speed,
        nodesExplored: merged.stats.nodesExplored,
        finalScore: merged.score,
        elapsedMs,
        workersUsed,
        snapshotAvailable,
      });

      return { type: 'result', result: merged };
    } catch (err) {
      if (activeSolve.resolved) {
        return { type: 'error', error: 'INTERNAL_ERROR', message: 'Solve was cancelled' };
      }
      activeSolve.resolved = true;
      console.error('[Solver] Unexpected error', err);
      return { type: 'error', error: 'INTERNAL_ERROR', message: String(err) };
    } finally {
      clearTimeout(hardKillTimer!);
      for (const ch of channels) {
        try { ch.port1.close(); } catch { /* best effort */ }
      }
      this.activeSolves.delete(userId);
    }
  }

  // ===========================================================================
  // cancel — Abort active solve and return partial result
  // ===========================================================================

  cancel(userId: string): void {
    const active = this.activeSolves.get(userId);
    if (active && !active.resolved) {
      active.controller.abort();
      active.resolved = true;
    }
  }

  // ===========================================================================
  // destroy — Shut down pool gracefully
  // ===========================================================================

  async destroy(): Promise<void> {
    // Abort all active solves
    for (const active of this.activeSolves.values()) {
      if (!active.resolved) {
        active.controller.abort();
        active.resolved = true;
      }
    }
    this.activeSolves.clear();
    await this.pool.destroy();
  }

  // ===========================================================================
  // Result Merging & Deduplication
  // ===========================================================================

  private mergeResults(allResults: SolverResult[]): SolverResult {
    // Sort by score descending
    allResults.sort((a, b) => b.score - a.score);

    // Deduplicate by mainPath hash (skip empty mainPaths)
    const seen = new Set<string>();
    const unique: SolverResult[] = [];

    for (const r of allResults) {
      if (r.mainPath.length === 0) {
        // Keep empty-path results without dedup
        unique.push(r);
        continue;
      }
      const hash = hashMainPath(r.mainPath);
      if (!seen.has(hash)) {
        seen.add(hash);
        unique.push(r);
      }
    }

    // Keep up to treePruningTopX alternatives
    const topX = this.config.treePruningTopX;
    const kept = unique.slice(0, topX);

    // Build merged tree: best result as primary, alternatives as extra children
    const best = kept[0];

    // Prune the best result's tree
    this.pruneTree(best.tree, topX, this.config.maxResultNodes);

    // Sum nodesExplored across all results for stats
    let totalNodes = 0;
    for (const r of allResults) {
      totalNodes += r.stats.nodesExplored;
    }
    best.stats.nodesExplored = totalNodes;

    return best;
  }

  // ===========================================================================
  // Tree Pruning — top-X children per node, maxResultNodes cap
  // ===========================================================================

  private pruneTree(root: DecisionNode, topX: number, maxNodes: number): void {
    let nodeCount = 0;

    const prune = (node: DecisionNode): void => {
      nodeCount++;

      if (node.children.length > topX) {
        node.prunedChildren = node.children.length - topX;
        node.children = node.children.slice(0, topX);
      }

      if (nodeCount >= maxNodes) {
        if (node.children.length > 0) {
          node.truncated = true;
          node.children = [];
        }
        return;
      }

      for (const child of node.children) {
        if (nodeCount >= maxNodes) {
          child.truncated = true;
          child.children = [];
          continue;
        }
        prune(child);
      }
    };

    prune(root);
  }
}
