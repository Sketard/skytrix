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
  AdversarialTiming,
  VerifyResult,
} from './solver-types.js';
import { solverAssert } from './solver-assert.js';

// =============================================================================
// Constants
// =============================================================================

/** Multiplier applied to `timeLimitMs` to get the hard-kill deadline. After
 *  this deadline, the orchestrator aborts all workers even if they're still
 *  running. Gives the solver a 50% margin over its self-reported budget. */
const HARD_KILL_MULTIPLIER = 1.5;

/** Grace window (ms) after abort for workers to settle before we snapshot
 *  whatever results have been collected. Short enough that cancelled solves
 *  still return snappily, long enough to pick up any result already in-flight. */
const ABORT_SETTLE_MS = 500;

/** Total time budget (ms) for verify mode. Verify is a single-worker deterministic
 *  replay — sub-100ms in practice, but we give 10s headroom for decks with
 *  many chain windows / large activation logs. */
const VERIFY_TIME_LIMIT_MS = 10_000;

/** Top-K alternative combo lines extracted per solve. Each alternative is
 *  the root child at index [0..K-1]. Must match the worker's default. */
const TOP_K_ALTERNATIVES = 3;

/** Worker pool health-check timeout (ms). If the pool doesn't respond to a
 *  no-op task within this window at boot, the pool is marked degraded. */
const POOL_HEALTH_CHECK_MS = 10_000;

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
} | {
  type: 'cancelled';
  partialResult?: SolverResult;
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
    this.poolSize = configFile.poolSize || Math.max(1, availableParallelism() - 2);

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

    // Health check: dispatch a no-op task and verify it resolves within the
    // configured pool-health-check window.
    try {
      const healthPromise = this.pool.run({ type: 'health-check' });
      const timeout = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), POOL_HEALTH_CHECK_MS));
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

    // DFS is deterministic given a deck order — running multiple workers on
    // identical input is wasteful. Dispatch to a single worker for 'dfs',
    // and to the full pool for 'mcts'/'auto' (auto may resolve to MCTS via
    // the BF probe, so it needs full parallelism upfront).
    const dispatchCount = algorithm === 'dfs' ? 1 : this.poolSize;

    // Seed diversity: generate unique seeds per worker
    const seeds = Array.from({ length: dispatchCount }, () => {
      const buf = randomBytes(16);
      return [buf.readBigUInt64LE(0), buf.readBigUInt64LE(8)];
    });

    // Progress aggregation state
    const workerProgress = new Map<number, SolverProgress>();
    let lastProgressEmit = 0;
    let lastSumNodes = -1;
    let lastNodeAdvanceAt = startTime;
    let stalledFlag = false;

    const aggregateAndEmit = (now: number, force: boolean): void => {
      let maxBestScore = -1;
      let sumNodes = 0;
      let highComplexity = false;
      for (const p of workerProgress.values()) {
        if (p.bestScore > maxBestScore) maxBestScore = p.bestScore;
        sumNodes += p.nodesExplored;
        if (p.highComplexity) highComplexity = true;
      }

      // Track node-advance for stall detection
      if (sumNodes > lastSumNodes) {
        lastSumNodes = sumNodes;
        lastNodeAdvanceAt = now;
        if (stalledFlag) {
          stalledFlag = false;
          force = true; // emit a clearing update immediately
        }
      } else if (!stalledFlag && now - lastNodeAdvanceAt >= this.config.stalledWarningMs) {
        stalledFlag = true;
        force = true; // emit the stall transition immediately
      }

      if (!force && now - lastProgressEmit < this.config.progressThrottleMs) return;
      lastProgressEmit = now;

      onProgress({
        nodesExplored: sumNodes,
        bestScore: maxBestScore,
        elapsed: now - startTime,
        ...(stalledFlag ? { stalled: true } : {}),
        ...(highComplexity ? { highComplexity: true } : {}),
      });
    };

    // Periodic stall watchdog: fires even when no worker emits a progress
    // message, so the frontend can switch the spinner copy when a synchronous
    // WASM call freezes the worker event loop.
    const stallTimer = setInterval(() => {
      if (activeSolve.resolved) return;
      aggregateAndEmit(Date.now(), false);
    }, Math.min(this.config.stalledWarningMs, this.config.progressThrottleMs));

    // Set up MessageChannels for progress streaming
    const channels: MessageChannel[] = [];
    const workerPromises: Promise<WorkerResult>[] = [];

    for (let i = 0; i < dispatchCount; i++) {
      const { port1, port2 } = new MessageChannel();
      channels.push({ port1, port2 } as MessageChannel);

      port1.on('message', (msg: { type: string; data?: SolverProgress; cat?: string }) => {
        if (activeSolve.resolved) return;

        if (msg.type === 'progress' && msg.data) {
          workerProgress.set(i, msg.data);
          aggregateAndEmit(Date.now(), false);
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
        topK: TOP_K_ALTERNATIVES,
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

    // Hard-kill timeout: timeLimitMs * HARD_KILL_MULTIPLIER (1.5×)
    const hardKillMs = solverConfig.timeLimitMs * HARD_KILL_MULTIPLIER;
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
            setTimeout(() => r([]), ABORT_SETTLE_MS),
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

      // Cancelled — return 'cancelled' variant with optional partial result
      if (activeSolve.resolved) {
        if (allResults.length > 0) {
          return { type: 'cancelled', partialResult: this.mergeResults(allResults) };
        }
        return { type: 'cancelled' };
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
        return { type: 'cancelled' };
      }
      activeSolve.resolved = true;
      console.error('[Solver] Unexpected error', err);
      return { type: 'error', error: 'INTERNAL_ERROR', message: String(err) };
    } finally {
      clearTimeout(hardKillTimer!);
      clearInterval(stallTimer);
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
  // verify — Dispatch adversarial path verification to a single worker
  // ===========================================================================

  async verify(
    duelConfig: DuelConfig,
    verifyPath: SolverAction[],
    verifyTimings: AdversarialTiming[],
    expectedScore: number,
  ): Promise<VerifyResult> {
    const task = {
      duelConfig,
      solverConfig: { mode: 'adversarial' as const, speed: 'fast' as const, timeLimitMs: VERIFY_TIME_LIMIT_MS },
      seed: duelConfig.deckSeed,
      algorithm: 'dfs' as const,
      progressPort: null,
      type: 'verify' as const,
      verifyPath,
      verifyTimings,
      verifyExpectedScore: expectedScore,
    };

    const result = await this.pool.run(task) as VerifyResult;
    return result;
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
    // Invariant: callers upstream filter empty result arrays into error paths
    // before reaching merge. A zero-length array here means a regression in
    // solve() result collection.
    solverAssert(
      allResults.length > 0,
      'SolverOrchestrator.mergeResults',
      'called with empty result array — upstream filter broken',
    );

    // Adversarial results: sort by minimax (worst-case resilience) descending.
    // Goldfish results: sort by score (optimistic) descending.
    const isAdversarial = allResults[0]?.minimax !== undefined;
    allResults.sort((a, b) => isAdversarial
      ? (b.minimax ?? b.score) - (a.minimax ?? a.score)
      : b.score - a.score,
    );

    // Group by mainPath hash. Two workers can converge on the same recommended
    // path while exploring entirely different alternative branches below it —
    // we want to preserve those, not discard duplicates.
    const groups = new Map<string, SolverResult[]>();
    const emptyPathResults: SolverResult[] = [];

    for (const r of allResults) {
      if (r.mainPath.length === 0) {
        emptyPathResults.push(r);
        continue;
      }
      const hash = hashMainPath(r.mainPath);
      let group = groups.get(hash);
      if (!group) {
        group = [];
        groups.set(hash, group);
      }
      group.push(r);
    }

    // Merge each group into a single representative result by unioning
    // alternative subtrees along the shared mainPath.
    const merged: SolverResult[] = [];
    for (const group of groups.values()) {
      merged.push(this.mergeMainPathDuplicates(group));
    }
    for (const r of emptyPathResults) merged.push(r);

    merged.sort((a, b) => isAdversarial
      ? (b.minimax ?? b.score) - (a.minimax ?? a.score)
      : b.score - a.score,
    );

    const topX = this.config.treePruningTopX;
    const best = merged[0];

    // Prune the best result's tree. Adversarial trees are already pruned by
    // minimax-mcts during solve (worst-case branches retained); re-pruning
    // here would discard the resilience signal the minimax phase preserved.
    if (!isAdversarial) {
      this.pruneTree(best.tree, topX, this.config.maxResultNodes);
    }

    // Sum nodesExplored across all results for stats. Return a new object
    // rather than mutating `best.stats` in place — `best` may be referenced
    // by upstream caches or test fixtures, and silently mutating its stats
    // produces hard-to-track action-at-a-distance bugs.
    let totalNodes = 0;
    for (const r of allResults) {
      totalNodes += r.stats.nodesExplored;
    }
    return { ...best, stats: { ...best.stats, nodesExplored: totalNodes } };
  }

  // ===========================================================================
  // mainPath Group Merging — union alternative subtrees along the shared path
  // ===========================================================================

  private mergeMainPathDuplicates(group: SolverResult[]): SolverResult {
    if (group.length === 1) return group[0];

    // Highest-scoring result is the base; mutate its tree in place to absorb
    // alternative children from the other duplicates.
    group.sort((a, b) => b.score - a.score);
    const base = group[0];

    this.mergeAlternativesAlongPath(
      base.tree,
      group.map(r => r.tree),
      base.mainPath,
      0,
    );

    return base;
  }

  private mergeAlternativesAlongPath(
    baseNode: DecisionNode,
    duplicateNodes: DecisionNode[],
    mainPath: SolverAction[],
    depth: number,
  ): void {
    const mainResponseIdx = depth < mainPath.length ? mainPath[depth].responseIndex : null;

    // Collect alternative children (everything that isn't the next mainPath
    // step) from all duplicates at this level, dedup by responseIndex,
    // keep highest-scoring on collision.
    const altByResponse = new Map<number, DecisionNode>();

    for (const dup of duplicateNodes) {
      for (const child of dup.children) {
        if (child.action.responseIndex === mainResponseIdx) continue;
        const existing = altByResponse.get(child.action.responseIndex);
        if (!existing || child.score > existing.score) {
          altByResponse.set(child.action.responseIndex, child);
        }
      }
    }

    // Rebuild baseNode.children: main child first, then merged alternatives
    // sorted by score descending.
    const mainChild = baseNode.children.find(c => c.action.responseIndex === mainResponseIdx);
    const alts = Array.from(altByResponse.values()).sort((a, b) => b.score - a.score);
    baseNode.children = mainChild ? [mainChild, ...alts] : alts;

    // Recurse into the main child if mainPath continues. Gather the
    // corresponding main descendant from each duplicate to keep the
    // lockstep walk consistent.
    if (mainChild && depth + 1 < mainPath.length) {
      const nextDuplicates: DecisionNode[] = [];
      for (const dup of duplicateNodes) {
        const dupMain = dup.children.find(c => c.action.responseIndex === mainResponseIdx);
        if (dupMain) nextDuplicates.push(dupMain);
      }
      this.mergeAlternativesAlongPath(mainChild, nextDuplicates, mainPath, depth + 1);
    }
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
