// =============================================================================
// solver-worker.ts — Piscina worker entry point for solver tasks
// Each worker boots OCGCore WASM + card DB, instantiates solver singletons,
// and exports runSolve() as the default function for piscina to call.
// =============================================================================

import { workerData } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import { join } from 'node:path';
import { loadDatabase, loadScripts } from '../ocg-scripts.js';
import { loadAllSolverConfigs } from './solver-config-loader.js';
import { OCGCoreAdapter } from './ocgcore-adapter.js';
import { ZobristHasher } from './zobrist.js';
import { TranspositionTable } from './transposition-table.js';
import { InterruptionScorer } from './interruption-scorer.js';
import { DfsSolver, extractMainPath } from './dfs-solver.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';
import type {
  DuelConfig,
  SolverConfig,
  SolverResult,
  SolverProgress,
  SolverAction,
} from './solver-types.js';

// =============================================================================
// Worker Boot Types
// =============================================================================

interface WorkerData {
  dataDir: string;
}

interface SolveTask {
  duelConfig: DuelConfig;
  solverConfig: SolverConfig;
  seed: bigint[];
  algorithm: 'dfs' | 'mcts' | 'auto';
  progressPort: MessagePort;
  type?: 'health-check';
  topK?: number;
}

interface WorkerResult {
  results: SolverResult[];
  snapshotAvailable: boolean;
}

// =============================================================================
// Module-Level Singletons (initialized at boot via top-level await)
// Boot takes 1-3s (WASM init + card scripts) — expected, not a hang.
// =============================================================================

const { dataDir } = workerData as WorkerData;

const cardDB = loadDatabase(join(dataDir, 'cards.cdb'));
const scripts = loadScripts(join(dataDir, 'scripts_full'));
const allConfigs = loadAllSolverConfigs(dataDir, cardDB);

const adapter = await OCGCoreAdapter.create(cardDB, scripts);
const hasher = new ZobristHasher();
const table = new TranspositionTable(allConfigs.solverConfig.transpositionMaxEntries);
const scorer = new InterruptionScorer(
  allConfigs.interruptionTags,
  allConfigs.interruptionWeights,
);
const ranker = new GoldfishChainRanker();
const solver = new DfsSolver(hasher, table, scorer, adapter, ranker, allConfigs.solverConfig);

// =============================================================================
// Default Export — piscina calls this per task
// =============================================================================

export default async function runSolve(task: SolveTask): Promise<WorkerResult | { ok: true }> {
  // Health check guard
  if (!task || task.type === 'health-check') {
    return { ok: true };
  }

  const { duelConfig, solverConfig, seed, algorithm, progressPort, topK = 3 } = task;

  // Apply seed to duel config
  const seededConfig: DuelConfig = { ...duelConfig, deckSeed: seed };

  // Worker-side progress throttling
  let lastProgressTime = 0;
  const throttleMs = allConfigs.solverConfig.progressThrottleMs;

  const onProgress = (progress: SolverProgress): void => {
    const now = Date.now();
    if (now - lastProgressTime < throttleMs) return;
    lastProgressTime = now;
    try {
      progressPort.postMessage({ type: 'progress', data: progress });
    } catch { /* port may be closed */ }
  };

  // Debug emission via progressPort when LOG_LEVEL=debug
  const LOG_LEVEL = process.env['LOG_LEVEL'];
  const postDebug = (cat: string, data: unknown): void => {
    if (LOG_LEVEL !== 'debug') return;
    try {
      progressPort.postMessage({ type: 'debug', cat, data });
    } catch { /* port may be closed */ }
  };

  // Algorithm fallback
  if (algorithm === 'mcts' || algorithm === 'auto') {
    console.warn('[Solver] MCTS not implemented, falling back to DFS');
  }

  // AbortSignal.timeout as defense-in-depth backup to DFS time budget checks.
  // piscina handles hard-kill via workerTerminateTimeout on the main thread.
  const signal = AbortSignal.timeout(solverConfig.timeLimitMs);

  postDebug('solve-start', { algorithm, seed: seed.map(s => s.toString()), topK });

  const startHandle = adapter.createDuel(seededConfig);

  try {
    // Run DFS solver (calls adapter.destroyAll() in its finally block)
    const result = solver.solve(adapter, solverConfig, signal, onProgress, startHandle);

    // Set deckSeed on stats (DFS doesn't know the seed)
    result.stats.deckSeed = seed.map(s => s.toString()).join(',');

    // Top-K extraction: root's first K children are alternative combo lines
    const K = Math.min(topK, result.tree.children.length);

    if (K === 0) {
      return { results: [result], snapshotAvailable: adapter.snapshotAvailable };
    }

    const alternatives: SolverResult[] = [];
    for (let i = 0; i < K; i++) {
      const altRoot = result.tree.children[i];
      const mainPath = extractMainPath(altRoot);
      alternatives.push({
        tree: altRoot,
        mainPath,
        score: altRoot.score,
        scoreBreakdown: altRoot.scoreBreakdown ?? result.scoreBreakdown,
        stats: { ...result.stats },
        verified: false,
      });
    }

    // Verification (NFR12): replay each mainPath on a fresh duel
    for (let i = 0; i < alternatives.length; i++) {
      alternatives[i].verified = verifyMainPath(adapter, seededConfig, alternatives[i].mainPath);
      if (!alternatives[i].verified) {
        console.warn('[Solver] verification-failed', { pathIndex: i });
      }
    }

    // Keep verified paths
    const verified = alternatives.filter(a => a.verified);
    if (verified.length > 0) {
      postDebug('solve-done', { verifiedCount: verified.length, totalK: K, bestScore: verified[0].score });
      return { results: verified, snapshotAvailable: adapter.snapshotAvailable };
    }

    // All paths failed verification — return best unverified
    console.warn('[Solver] all-paths-failed-verification');
    alternatives[0].verified = false;
    postDebug('solve-done', { verifiedCount: 0, totalK: K, allFailed: true });
    return { results: [alternatives[0]], snapshotAvailable: adapter.snapshotAvailable };
  } finally {
    progressPort.close();
    adapter.destroyAll();
  }
}

// =============================================================================
// Verification — Replay action sequence on fresh duel to confirm legality
// =============================================================================

function verifyMainPath(
  oracle: OCGCoreAdapter,
  duelConfig: DuelConfig,
  mainPath: SolverAction[],
): boolean {
  if (mainPath.length === 0) return true;

  const handle = oracle.createDuel(duelConfig);
  try {
    for (const action of mainPath) {
      const legalActions = oracle.getLegalActions(handle);
      // responseIndex is unique per prompt context in sequential replay.
      // SolverAction doesn't carry promptType (stripped by enrichAction),
      // but responseIndex alone suffices because getLegalActions returns
      // actions for exactly one prompt, and replay is sequential.
      const match = legalActions.find(
        a => a.responseIndex === action.responseIndex,
      );
      if (!match) return false;
      oracle.applyAction(handle, match);
    }
    return true;
  } catch {
    return false;
  } finally {
    oracle.destroyDuel(handle);
  }
}
