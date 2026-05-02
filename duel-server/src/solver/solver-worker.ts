// =============================================================================
// solver-worker.ts — Piscina worker entry point for solver tasks
// Each worker boots OCGCore WASM + card DB, instantiates solver singletons,
// and exports runSolve() as the default function for piscina to call.
// =============================================================================

import { workerData } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import { join } from 'node:path';
import { loadDatabase, loadScripts } from '../ocg-scripts.js';
import { loadAllSolverConfigs, filterExpertiseByDeck } from './solver-config-loader.js';
import { OCGCoreAdapter } from './ocgcore-adapter.js';
import { ZobristHasher } from './zobrist.js';
import { TranspositionTable } from './transposition-table.js';
import { InterruptionScorer } from './interruption-scorer.js';
import { buildCardMetadataMap } from './card-metadata.js';
import { DfsSolver } from './dfs-solver.js';
import { extractMainPath } from './tree-utils.js';
import { verifyAdversarialPath } from './solver-verifier.js';
import { MCTSSolver } from './mcts-solver.js';
import { MinimaxMctsSolver } from './minimax-mcts-solver.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';
import { RouteAwareRanker } from './route-aware-ranker.js';
import { GraphGuidedRanker } from './graph-guided-ranker.js';
import { NeuralFeatureRanker } from './neural-ranker.js';
import { PolicyGuidedRanker } from './policy-guided-ranker.js';
import { loadTunedWeightsIfEnabled } from './graph-weights-loader.js';
import { loadNeuralWeightsIfEnabled } from './neural-weights-loader.js';
import { loadVerbPolicyIfEnabled } from './verb-policy-loader.js';
import type { ActionRanker } from './solver-strategy.js';
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
// Constants
// =============================================================================

/** Number of alternative combo lines extracted alongside the main result.
 *  The worker returns the top-K root children as separate SolverResult entries
 *  and the orchestrator aggregates them. */
const TOP_K_ALTERNATIVES = 3;

/** Node budget for the auto-detection BF probe. 100 is small enough to
 *  finish in <50ms on real decks but large enough to sample 2-3 tree depths. */
const DFS_PROBE_NODE_LIMIT = 100;

/** Branching factor threshold at which `auto` mode switches from DFS to MCTS.
 *  Distinct from `bfComplexityThreshold` in solver-config.json which controls
 *  when the UI starts warning about complexity. The switch threshold is
 *  intentionally higher (hysteresis) so the UI can flag "getting complex"
 *  before the solver actually changes algorithms. */
const DFS_TO_MCTS_BF_SWITCH = 12;

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
  progressPort: MessagePort | null;
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
  undefined, // cardMetadata — set per-solve in runSolve
  allConfigs.structuralWeights,
  allConfigs.structuralTutorCards,
);
// Wrap the base ranker with RouteAwareRanker so that archetype-expertise
// routes can re-prioritize actions that advance known combo lines. The
// wrapper is a no-op unless expertise is configured per-solve via
// `setArchetypeExpertise` — done in runSolve() below once we know which
// deck we're solving for.
const baseRanker = new GoldfishChainRanker(allConfigs.interruptionTags);
const routeAwareRanker = new RouteAwareRanker(baseRanker);

// Phase B (graph-ml-v2 / neural) and graph-ml-v1 are mutually exclusive —
// when both env vars are set, neural wins (Phase B design doc §2; mirrors
// evaluate-structural.ts). NeuralFeatureRanker wraps RouteAwareRanker and
// adds a neural bonus over the deck-agnostic feature vector. Per-fixture
// metadata + mainDeck/extraDeck pools are pushed by runSolve() below.
// `setArchetypeExpertise` always targets `routeAwareRanker` directly —
// neither GraphGuidedRanker nor NeuralFeatureRanker has expertise coupling.
const neuralWeights = loadNeuralWeightsIfEnabled({ dataDir });
const tunedWeights = neuralWeights ? undefined : loadTunedWeightsIfEnabled({ dataDir });
const verbPolicyWeights = loadVerbPolicyIfEnabled({ dataDir });
let ranker: ActionRanker;
let neuralRanker: NeuralFeatureRanker | undefined;
let policyRanker: PolicyGuidedRanker | undefined;
if (neuralWeights) {
  const nr = new NeuralFeatureRanker(routeAwareRanker);
  nr.setInterruptionTags(allConfigs.interruptionTags);
  nr.setInterruptionWeights(allConfigs.interruptionWeights);
  nr.setNeuralWeights(neuralWeights);
  neuralRanker = nr;
  ranker = nr;
} else if (tunedWeights) {
  const gr = new GraphGuidedRanker(routeAwareRanker);
  gr.setWeights(tunedWeights);
  ranker = gr;
} else {
  ranker = routeAwareRanker;
}

// Phase 3 Stage 3b — verb-class policy wraps whichever ranker is current.
// Composition over extension: policy provides move-ordering prior at
// SELECT_IDLECMD, inner provides value/route bonus on every prompt. Off
// by default → wrapper not constructed → no behaviour change.
if (verbPolicyWeights) {
  const pgr = new PolicyGuidedRanker(ranker);
  pgr.setInterruptionTags(allConfigs.interruptionTags);
  pgr.setInterruptionWeights(allConfigs.interruptionWeights);
  pgr.setVerbPolicyWeights(verbPolicyWeights);
  policyRanker = pgr;
  ranker = pgr;
}

const dfsSolver = new DfsSolver(hasher, table, scorer, adapter, ranker, allConfigs.solverConfig);
const mctsSolver = new MCTSSolver(scorer, adapter, ranker, allConfigs.solverConfig);
const minimaxMctsSolver = new MinimaxMctsSolver(scorer, adapter, ranker, allConfigs.solverConfig);

// =============================================================================
// Default Export — piscina calls this per task
// =============================================================================

export default async function runSolve(task: SolveTask): Promise<WorkerResult | VerifyResult | { ok: true }> {
  // Health check guard
  if (!task || task.type === 'health-check') {
    return { ok: true };
  }

  // Step 1 structural value function — rebuild card metadata for the new
  // duelConfig so F1 (isRitualMonster/isRitualSpell), F3 (level pairing) and
  // the metadata-gated entry in computeStructuralValue all fire. Shared
  // structuralWeights + tutorCards were set at boot.
  const duelCards = [
    ...task.duelConfig.mainDeck,
    ...task.duelConfig.extraDeck,
    ...task.duelConfig.hand,
  ];
  const cardMetadata = buildCardMetadataMap(cardDB, duelCards);
  scorer.setCardMetadata(cardMetadata);
  // Phase B: per-solve metadata + deck pools for the neural ranker. The
  // feature extractor needs these to populate `act_card_in_main_deck_pool`
  // / `act_card_in_extra_deck_pool` and to look up source-card type bits.
  if (neuralRanker) {
    neuralRanker.setMetadata(cardMetadata);
    neuralRanker.setMainDeck(task.duelConfig.mainDeck);
    neuralRanker.setExtraDeck(task.duelConfig.extraDeck);
  }
  // Phase 3 Stage 3b — same per-solve metadata/deck-pool wiring for the
  // policy ranker. Its FeatureContext mirrors the neural ranker's; both
  // need the per-fixture deck Sets to populate `act_card_in_*_pool` etc.
  if (policyRanker) {
    policyRanker.setMetadata(cardMetadata);
    policyRanker.setMainDeck(task.duelConfig.mainDeck);
    policyRanker.setExtraDeck(task.duelConfig.extraDeck);
  }

  // Activate archetype-expertise for this duel — pass the deck's main (per the
  // loader's convention) to filter to matching archetypes (keyCards overlap
  // ≥ threshold). Both the scorer's goal-match evaluator and the ranker's
  // route-alignment walker need this to take effect; without it the bridges
  // and goals loaded from data/archetype-expertise/*.json are dormant.
  const filteredExpertise = filterExpertiseByDeck(
    allConfigs.archetypeExpertise,
    task.duelConfig.mainDeck,
  );
  scorer.setArchetypeExpertise(filteredExpertise);
  scorer.setDeckContents([...task.duelConfig.mainDeck, ...task.duelConfig.extraDeck]);
  // Expertise always lives on the inner RouteAwareRanker, even when
  // GraphGuidedRanker wraps it — the graph wrapper is expertise-agnostic.
  routeAwareRanker.setArchetypeExpertise(filteredExpertise);
  // Phase 5 of prompt-resolver-refactor — feed the same deck-filtered
  // expertise into the adapter so CardExpertiseOracle can consume it on
  // every DecisionContext. No-op pass-through until decisionHints fields are
  // populated (Phase 7).
  adapter.setArchetypeExpertise(filteredExpertise);
  // Resource scoring (Design D, 2026-05-02) — feed initial deck/extra sizes
  // into the scorer. No-op when SOLVER_USE_RESOURCE_SCORING flag absent.
  scorer.setInitialDeckSizes(task.duelConfig.mainDeck.length, task.duelConfig.extraDeck.length);

  // Verify mode: replay adversarial path on a fresh duel
  if (task.type === 'verify') {
    return verifyAdversarialPath(adapter, scorer, task.duelConfig, task.verifyPath!, task.verifyTimings!, task.verifyExpectedScore ?? 0);
  }

  const { duelConfig, solverConfig, seed, algorithm, progressPort: rawPort, topK = TOP_K_ALTERNATIVES } = task;
  const progressPort = rawPort!;

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

    // Adversarial mode: always use Minimax MCTS (skip DFS probe, no warmStart)
    if (solverConfig.mode === 'adversarial') {
      minimaxMctsSolver.setSeed(seed);
      result = minimaxMctsSolver.solve(adapter, solverConfig, signal, onProgress, startHandle);
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
      const probeResult = dfsSolver.probe(adapter, solverConfig, signal, DFS_PROBE_NODE_LIMIT, startHandle);
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

      if (avgBF >= DFS_TO_MCTS_BF_SWITCH) {
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
      // `extractMainPath(node)` walks `node.children[0]` recursively and
      // returns the actions along that chain — by design it SKIPS `node.action`
      // itself (so calling it on the tree root correctly omits the
      // ROOT_ACTION sentinel placed by `makeNode(ROOT_ACTION, ...)`).
      // Here `altRoot = result.tree.children[i]` holds a real enriched action
      // (the first-level player decision), so we must prepend it manually —
      // otherwise mainPath is off-by-one and starts at the game state AFTER
      // the first decision. That off-by-one silently broke `verifyMainPath`
      // on every solve: the fresh-duel replay compared mainPath[0] (= the
      // 2nd decision) against the fresh state's first prompt and diverged.
      const mainPath = [altRoot.action, ...extractMainPath(altRoot)];
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

    // Keep verified paths. Exclude empty-mainPath alternatives: `verifyMainPath`
    // returns true trivially for `[]` (noop), but an alternative with no
    // actions is not a real solve. Under `maxResultNodes` tree-cap pressure,
    // iter2's root can sprout 0-score 0-path siblings; without this filter
    // they'd outrank a higher-scoring alt[0] whose mainPath fails strict
    // verification (e.g., sentinel-action replay mismatch).
    const verified = alternatives.filter(a => a.verified && a.mainPath.length > 0);
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

// Adversarial verify is implemented in solver-verifier.ts so smoke tests can
// import it without booting the piscina worker (which requires workerData).
