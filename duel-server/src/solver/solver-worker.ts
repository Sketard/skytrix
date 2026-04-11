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
import { MCTSSolver } from './mcts-solver.js';
import { IsMctsSolver } from './ismcts-solver.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';
import type {
  DuelConfig,
  SolverConfig,
  SolverResult,
  SolverProgress,
  SolverAction,
  AdversarialTiming,
  VerifyResult,
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
  type?: 'health-check' | 'verify';
  topK?: number;
  verifyPath?: SolverAction[];
  verifyTimings?: AdversarialTiming[];
  verifyExpectedScore?: number;
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

const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);
const hasher = new ZobristHasher();
const table = new TranspositionTable(allConfigs.solverConfig.transpositionMaxEntries);
const scorer = new InterruptionScorer(
  allConfigs.interruptionTags,
  allConfigs.interruptionWeights,
);
const ranker = new GoldfishChainRanker();
const dfsSolver = new DfsSolver(hasher, table, scorer, adapter, ranker, allConfigs.solverConfig);
const mctsSolver = new MCTSSolver(scorer, adapter, ranker, allConfigs.solverConfig);
const ismctsSolver = new IsMctsSolver(scorer, adapter, ranker, allConfigs.solverConfig);

// =============================================================================
// Default Export — piscina calls this per task
// =============================================================================

export default async function runSolve(task: SolveTask): Promise<WorkerResult | VerifyResult | { ok: true }> {
  // Health check guard
  if (!task || task.type === 'health-check') {
    return { ok: true };
  }

  // Verify mode: replay adversarial path on a fresh duel
  if (task.type === 'verify') {
    return verifyAdversarialPath(adapter, task.duelConfig, task.verifyPath!, task.verifyTimings!, task.verifyExpectedScore ?? 0);
  }

  const { duelConfig, solverConfig, seed, algorithm, progressPort, topK = 3 } = task;

  // Anchor for time accounting. The 'auto' branch runs a probe BEFORE the
  // main solver, so the main solver must subtract probe elapsed from its own
  // budget — otherwise it over-runs and starves the verification budget.
  const taskStartTime = Date.now();

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

  // AbortSignal.timeout as defense-in-depth backup to solver time budget checks.
  // piscina handles hard-kill via workerTerminateTimeout on the main thread.
  const signal = AbortSignal.timeout(solverConfig.timeLimitMs);

  postDebug('solve-start', { algorithm, seed: seed.map(s => s.toString()), topK });

  const startHandle = adapter.createDuel(seededConfig);

  try {
    // Algorithm dispatch
    let result: SolverResult;

    // Adversarial mode: always use IS-MCTS (skip DFS probe, no warmStart)
    if (solverConfig.mode === 'adversarial') {
      ismctsSolver.setSeed(seed);
      result = ismctsSolver.solve(adapter, solverConfig, signal, onProgress, startHandle);
    } else if (algorithm === 'dfs') {
      result = dfsSolver.solve(adapter, solverConfig, signal, onProgress, startHandle);
    } else if (algorithm === 'mcts') {
      mctsSolver.setSeed(seed);
      result = mctsSolver.solve(adapter, solverConfig, signal, onProgress, startHandle);
    } else {
      // 'auto' — run 100-node DFS probe to measure branching factor
      //
      // REVIEW NOTE (finding #9): 100 nodes typically explore only 2-3 depth
      // levels. The measured avgBF may not reflect mid-game branching (e.g.,
      // a wide opening with a narrow combo continuation can flip MCTS on when
      // DFS would have been fine). Revisit the sample size and/or threshold
      // once we have empirical data on mis-dispatch rates per deck archetype.
      const probeResult = dfsSolver.probe(adapter, solverConfig, signal, 100, startHandle);
      const avgBF = probeResult.averageBranchingFactor;

      postDebug('auto-probe', { avgBF, bestScore: probeResult.bestScore, nodes: probeResult.nodesExplored });

      // Emit highComplexity BEFORE solve so UI can display live warning
      if (avgBF > allConfigs.solverConfig.bfComplexityThreshold) {
        onProgress({
          nodesExplored: probeResult.nodesExplored,
          bestScore: probeResult.bestScore,
          elapsed: 0,
          highComplexity: true,
        });
      }

      // Subtract probe elapsed from the budget passed to the main solver.
      // The original code recomputed solveBudgetMs from the full timeLimitMs
      // and over-ran the global AbortSignal, eating into the verification slice.
      const remainingMs = Math.max(0, solverConfig.timeLimitMs - (Date.now() - taskStartTime));
      const adjustedConfig: SolverConfig = { ...solverConfig, timeLimitMs: remainingMs };

      if (avgBF >= 12) {
        // High BF → switch to MCTS with warm-start from probe stats
        mctsSolver.setSeed(seed);
        mctsSolver.warmStart(probeResult);
        // Clean up DFS transposition table — stale entries won't help MCTS
        table.reset();
        result = mctsSolver.solve(adapter, adjustedConfig, signal, onProgress, startHandle);
      } else {
        // Low BF → continue with DFS, reusing TT from probe
        dfsSolver.resumeFromProbe(probeResult);
        result = dfsSolver.solve(adapter, adjustedConfig, signal, onProgress, startHandle);
      }
    }

    // Set worker-level stats (solvers don't know these values)
    result.stats.deckSeed = seed.map(s => s.toString()).join(',');
    result.stats.algorithm = algorithm;

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
    for (let i = 0; i < mainPath.length; i++) {
      const action = mainPath[i];
      const legalActions = oracle.getLegalActions(handle);
      // Match by both responseIndex AND cardId. responseIndex alone is the
      // typical sequential-replay invariant, but if OCGCore's enumeration
      // order shifts (e.g., via internal PRNG or chain link order), the same
      // index slot can point to a different card. Adding the cardId check
      // turns silent corruption into an explicit verification failure.
      // H3 finding from the Epic 1 review.
      const match = legalActions.find(
        a => a.responseIndex === action.responseIndex && a.cardId === action.cardId,
      );
      if (!match) {
        // Surface enough state to localize the divergence in production logs.
        console.warn('[Solver] verification-step-failed', {
          stepIndex: i,
          totalSteps: mainPath.length,
          expectedResponseIndex: action.responseIndex,
          expectedCardName: action.cardName,
          legalPromptType: legalActions[0]?.promptType,
          legalResponseIndexes: legalActions.map(a => a.responseIndex),
        });
        return false;
      }
      oracle.applyAction(handle, match);
    }
    return true;
  } catch (err) {
    console.warn('[Solver] verification-threw', { error: String(err) });
    return false;
  } finally {
    oracle.destroyDuel(handle);
  }
}

// =============================================================================
// Adversarial Verification — Replay with opponent handtrap injection at timings
// =============================================================================

function verifyAdversarialPath(
  oracle: OCGCoreAdapter,
  duelConfig: DuelConfig,
  verifyPath: SolverAction[],
  verifyTimings: AdversarialTiming[],
  expectedScore: number,
): VerifyResult {
  if (verifyPath.length === 0) return { verified: true };

  // Build a timing lookup: playerStepIndex → AdversarialTiming
  const timingMap = new Map<number, AdversarialTiming>();
  for (const t of verifyTimings) {
    timingMap.set(t.stepIndex, t);
  }

  const handle = oracle.createDuel(duelConfig);
  try {
    let playerStepIndex = 0;
    let pathIndex = 0;

    while (pathIndex < verifyPath.length) {
      const legalActions = oracle.getLegalActions(handle);

      // Empty actions means duel ended
      if (legalActions.length === 0) {
        return {
          verified: false,
          divergenceStep: pathIndex,
          reason: `Step ${pathIndex}: duel ended prematurely (expected ${verifyPath.length - pathIndex} more actions)`,
        };
      }

      // Opponent prompt (team === 1): handle via timings or auto-pass
      if (legalActions[0]?.team === 1) {
        const timing = timingMap.get(playerStepIndex);
        if (timing) {
          // Inject the handtrap activation at this timing
          const match = legalActions.find(
            a => a.responseIndex === timing.responseIndex,
          );
          if (!match) {
            return {
              verified: false,
              divergenceStep: pathIndex,
              reason: `Step ${pathIndex}: opponent timing responseIndex ${timing.responseIndex} (${timing.handtrapCardName}) not in legal actions`,
            };
          }
          oracle.applyAction(handle, match);
        } else {
          // No timing for this step — auto-pass (decline chain)
          const pass = legalActions.find(a => a.responseIndex === -1);
          if (pass) {
            oracle.applyAction(handle, pass);
          } else {
            // No pass option — pick first action (shouldn't happen for SELECT_CHAIN)
            oracle.applyAction(handle, legalActions[0]);
          }
        }
        continue; // Don't increment pathIndex or playerStepIndex for opponent prompts
      }

      // Player prompt: match against verifyPath
      const expected = verifyPath[pathIndex];
      const match = legalActions.find(
        a => a.responseIndex === expected.responseIndex && a.cardId === expected.cardId,
      );
      if (!match) {
        return {
          verified: false,
          divergenceStep: pathIndex,
          reason: `Step ${pathIndex}: expected ${expected.cardName} (idx ${expected.responseIndex}) but not in legal actions`,
        };
      }
      oracle.applyAction(handle, match);
      playerStepIndex++;
      pathIndex++;
    }

    // All actions replayed — compare final board score
    const fieldState = oracle.getFieldState(handle);
    const { score: finalScore } = scorer.score(fieldState);
    if (finalScore !== expectedScore) {
      return {
        verified: false,
        divergenceStep: verifyPath.length,
        reason: `Final board score mismatch: expected ${expectedScore}, got ${finalScore}`,
      };
    }
    return { verified: true };
  } catch (err) {
    return {
      verified: false,
      divergenceStep: -1,
      reason: `Verification threw: ${String(err)}`,
    };
  } finally {
    oracle.destroyDuel(handle);
  }
}
