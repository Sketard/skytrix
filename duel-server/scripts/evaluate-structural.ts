// =============================================================================
// evaluate-structural.ts — batch evaluation harness for step 1 regression gate.
//
// Runs DFS over every non-draft fixture in solver-validation-decks.json,
// collects per-fixture functional metrics (score, matched, peak field) +
// diagnostic metrics (nodes, actionsZero%, turn2%, walltime), writes a JSON
// baseline or compares against an existing one and reports regressions.
//
// Read-only: no production code changes. Reuses the adapter / scorer / DFS
// exactly as the solver-worker wires them.
//
// Usage:
//   cd duel-server
//   SOLVER_INSTRUMENT=1 npx tsx scripts/evaluate-structural.ts \
//     --out=../_bmad-output/planning-artifacts/research/baselines/pre-step1-baseline.json
//
//   SOLVER_INSTRUMENT=1 npx tsx scripts/evaluate-structural.ts \
//     --compare=../_bmad-output/planning-artifacts/research/baselines/pre-step1-baseline.json
//
// Deterministic regression gate (pre-S2 infra): --node-budget=N swaps the
// Phase L per-root-child wall-clock guard for a node-count guard, removing
// CPU-throughput sensitivity across runs. Pair with a large --budget-ms to
// prevent the global time budget from kicking in before the node-budget does:
//   SOLVER_INSTRUMENT=1 npx tsx scripts/evaluate-structural.ts \
//     --node-budget=400 --budget-ms=3600000 \
//     --compare=../_bmad-output/planning-artifacts/research/baselines/<baseline>.json
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Piscina } from 'piscina';

import { loadDatabase, loadScripts } from '../src/ocg-scripts.js';
import {
  loadAllSolverConfigs,
  applyStructuralWeightsOverride,
  applyInterruptionWeightsOverride,
} from '../src/solver/solver-config-loader.js';
import { OCGCoreAdapter } from '../src/solver/ocgcore-adapter.js';
import { InterruptionScorer } from '../src/solver/interruption-scorer.js';
import { GoldfishChainRanker } from '../src/solver/goldfish-chain-ranker.js';
import { RouteAwareRanker } from '../src/solver/route-aware-ranker.js';
import { GraphGuidedRanker, type RankerTrackingDump } from '../src/solver/graph-guided-ranker.js';
import { loadTunedWeightsIfEnabled } from '../src/solver/graph-weights-loader.js';
import { NeuralFeatureRanker } from '../src/solver/neural-ranker.js';
import { loadNeuralWeightsIfEnabled } from '../src/solver/neural-weights-loader.js';
import { PolicyGuidedRanker } from '../src/solver/policy-guided-ranker.js';
import { loadVerbPolicyIfEnabled } from '../src/solver/verb-policy-loader.js';
import { filterExpertiseByDeck } from '../src/solver/solver-config-loader.js';
import type { ActionRanker } from '../src/solver/solver-strategy.js';
import { DfsSolver } from '../src/solver/dfs-solver.js';
import { MCTSSolver } from '../src/solver/mcts-solver.js';
import { ZobristHasher } from '../src/solver/zobrist.js';
import { TranspositionTable } from '../src/solver/transposition-table.js';
import { buildCardMetadataMap, type CardMetadataMap } from '../src/solver/card-metadata.js';
import {
  buildFeatureContext,
  extractActionFeatures,
  extractStateFeatures,
  STATE_FEATURE_NAMES,
  ACTION_FEATURE_NAMES,
  computeFeatureSpecHash,
} from '../src/solver/state-feature-extractor.js';
import type { NeuralWeights } from '../src/solver/neural-ranker.js';
import type { DuelConfig, SolverConfig, ScoreBreakdown, SolverAction } from '../src/solver/solver-types.js';
import { extractMainPath } from '../src/solver/tree-utils.js';

export interface HandFixture {
  id: string;
  deck: string;
  description?: string;
  hand: number[];
  deckSeed: string;
  expectedBoard?: {
    zone: string;
    cardId: number;
    cardName: string;
    /** Optional — canonical combo posture. `attack`/`defense` require face-up;
     *  `set` matches face-down monsters (facedown-def) OR face-down spells/traps
     *  (facedown). When omitted, any position counts. */
    position?: 'attack' | 'defense' | 'set';
  }[];
  preferredIntermediates?: number[];
  maxDepth?: number;
  _draft?: boolean;
}

export interface FixtureFile {
  decks: Record<string, { main: number[]; extra: number[]; side?: number[]; _draft?: boolean }>;
  hands: HandFixture[];
}

export interface FixtureResult {
  /** User-facing interruption grade (= scoreBreakdown.interruptionScore).
   *  Matches `result.score` from SolverResult for backward-compat with
   *  pre-3.0 baselines. */
  score: number;
  /** Transposition table hits during the run. Surfaced for fitness-evaluator's
   *  `novelty` term (= nodesExplored − transpositionHits). Optional in result
   *  schema (older baselines may lack it). */
  transpositionHits?: number;
  /** DFS guidance signal (= scoreBreakdown.explorationScore = interruption
   *  + latent). Surfaced at this level so tuning sweeps can observe the
   *  effect of structural-weight / latentDiscount changes even when the
   *  peak terminal state is weight-invariant — the latent delta appears
   *  here even when the interruptionScore is stable. */
  explorationScore: number;
  /** Full ScoreBreakdown of the reported peak. Carries per-type counts
   *  (omniNegate, destruction, ...) + aggregates (weighted, fallbackPoints,
   *  latentPoints, interruptionScore, explorationScore). Enables causal
   *  analysis in tuning sweeps: which weight axis moved which component. */
  breakdown: ScoreBreakdown;
  matched: number;
  matchedTotal: number;
  matchedCardIds: number[];
  missingCardIds: number[];
  terminationReason: string;
  nodesExplored: number;
  maxDepthReached: number;
  actionsZeroPct: number;
  turn2Pct: number;
  wallMs: number;
  /** Populated when `runFixture` was called with `dumpEdges=true` and the
   *  active dfsRanker is a `GraphGuidedRanker`. Captures per-edge usage
   *  during this fixture's DFS run (graph-ml-v1 audit reco #2). Stays
   *  optional so existing baselines / consumers are unaffected. */
  edgeUsage?: RankerTrackingDump;
}

export interface BaselineFile {
  _meta: {
    timestamp: string;
    budgetMs: number;
    scorerVersion: string;
    gitHead?: string;
    /** Pre-S2 infra — present when the run used deterministic node-budget
     *  mode instead of the default wall-clock Phase L guard. Recorded for
     *  baseline traceability; `compareBaselines` does not key off it. */
    rootChildBudgetNodes?: number;
  };
  fixtures: Record<string, FixtureResult>;
  aggregate: {
    cumulativeMatched: number;
    cumulativeMatchedTotal: number;
    cumulativeScore: number;
    /** Sum of per-fixture `explorationScore`. Phase 3.0 addition — used as
     *  an alternative fitness target in `tune-weights.ts` when the tuned
     *  axes only move latent/structural (invisible to `cumulativeScore`). */
    cumulativeExplorationScore: number;
    fixtureCount: number;
  };
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg?.slice(name.length + 3);
}

function parseNumArg(name: string): number | undefined {
  const v = parseStringArg(name);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const MZONE_EXPANSION = new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'EMZ_L', 'EMZ_R']);
const SZONE_EXPANSION = new Set(['S1', 'S2', 'S3', 'S4', 'S5']);

function zoneMatches(expectedZone: string, actualZone: string): boolean {
  if (expectedZone === actualZone) return true;
  if (expectedZone === 'MZONE') return MZONE_EXPANSION.has(actualZone);
  if (expectedZone === 'SZONE') return SZONE_EXPANSION.has(actualZone);
  return false;
}

function positionMatches(
  expectedPosition: 'attack' | 'defense' | 'set' | undefined,
  actualPosition: string,
): boolean {
  if (!expectedPosition) return true;
  if (expectedPosition === 'attack') return actualPosition === 'faceup-atk';
  if (expectedPosition === 'defense') return actualPosition === 'faceup-def';
  if (expectedPosition === 'set') {
    return actualPosition === 'facedown' || actualPosition === 'facedown-def';
  }
  return false;
}

/** Canonical-path hint file format (matches `record-trajectory.ts::HintFile`).
 *  Strategic Grammar v1 integration — evaluate-structural loads these when
 *  `--use-hints` is set to force DFS into the canonical combo branch. */
interface HintFile {
  fixtureId: string;
  canonicalPath?: number[];
  bannedCardIds?: number[];
}

/** Load canonical-path hint for `<fixtureId>-hint.json` under
 *  `_bmad-output/planning-artifacts/research/trajectories/`. Returns undefined
 *  when the file does not exist (opt-in feature, silently skips fixtures
 *  without authored hints). */
function loadHintForFixture(fixtureId: string): HintFile | undefined {
  const hintPath = resolve(
    import.meta.dirname!, '..', '..',
    '_bmad-output', 'planning-artifacts', 'research', 'trajectories',
    `${fixtureId}-hint.json`,
  );
  try {
    const raw = readFileSync(hintPath, 'utf-8');
    const hint = JSON.parse(raw) as HintFile;
    return hint;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/** Phase 3 Stage 1 (2026-04-27) — trajectory dump format. One JSON file per
 *  fixture. The trajectory is the DFS's best mainPath replayed step-by-step
 *  on a fresh duel fork with per-step state + action features captured.
 *
 *  Schema-versioned so downstream Phase 3-4 corpus consumers can detect
 *  drift. Bump on any breaking change. */
export interface TrajectoryDumpFile {
  schemaVersion: 1;
  fixtureId: string;
  deckLabel: string;
  /** Basename of the weights file used during the DFS solve. `null` when no
   *  trained weights were loaded (vanilla DFS). */
  weightsBasename: string | null;
  weightsHash: string | null;
  weightsArch: string | null;
  /** Hash of the feature spec at dump time. Loaders SHOULD validate it
   *  matches their own `computeFeatureSpecHash()` before consuming, otherwise
   *  feature names are mis-aligned. */
  featureSpecHash: string;
  evalConfig: {
    expertiseDisabled: boolean;
    implicitGoalsWeight: number;
    budgetMs: number;
    nodeBudget: number | null;
  };
  outcome: {
    score: number;
    matched: number;
    matchedTotal: number;
    matchedCardIds: number[];
    missingCardIds: number[];
    nodesExplored: number;
    wallMs: number;
    terminationReason: string;
  };
  /** Phase 3 Stage 3a augmentation (2026-04-27) — present iff this dump is
   *  an alt branch of the search tree (not the primary mainPath). Primary
   *  dumps omit this field. */
  altOf?: {
    mainFixtureId: string;
    rank: number;
    score: number;
  };
  trajectory: TrajectoryStepDump[];
}

export interface TrajectoryStepDump {
  step: number;
  promptType: string;
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
  actionVerb: string | null;
  /** Named state features at this step (pre-action). Object form for human-
   *  readability + analysis flexibility; downstream ML training can re-key
   *  to ordered arrays via `STATE_FEATURE_NAMES`. */
  stateFeatures: Record<string, number>;
  /** Named action features for the chosen action (the one the DFS picked
   *  at this prompt). */
  actionFeatures: Record<string, number>;
}

/** Walk a `mainPath` on a fresh duel fork, extracting state + action features
 *  per step, and write the resulting JSON to disk. Side-effect free on the
 *  caller's adapter state — uses its own duel handle and destroys it on exit.
 *
 *  Drift handling: if a step's (responseIndex, cardId) doesn't match any
 *  legal action at the current prompt, the dump records the divergence and
 *  truncates the trajectory there. Empty mainPath → write a stub with
 *  `trajectory: []` (still useful as a per-fixture record of "DFS had no
 *  decisions to make" — see snake-eye / mitsurugi at honest baseline). */
export function dumpTrajectoryToFile(
  adapter: OCGCoreAdapter,
  duelConfig: DuelConfig,
  mainPath: SolverAction[],
  meta: {
    fixtureId: string;
    deckLabel: string;
    weightsBasename: string | null;
    weights: NeuralWeights | null;
    cardMetadata: CardMetadataMap;
    interruptionTags: ReturnType<typeof loadAllSolverConfigs>['interruptionTags'];
    interruptionWeights: ReturnType<typeof loadAllSolverConfigs>['interruptionWeights'];
    mainDeck: readonly number[];
    extraDeck: readonly number[];
    expertiseDisabled: boolean;
    implicitGoalsWeight: number;
    budgetMs: number;
    nodeBudget: number | null;
    outcome: {
      score: number;
      matched: number;
      matchedTotal: number;
      matchedCardIds: number[];
      missingCardIds: number[];
      nodesExplored: number;
      wallMs: number;
      terminationReason: string;
    };
    /** Phase 3 Stage 3a augmentation (2026-04-27) — when present, this dump
     *  represents an alt branch of the search tree, not the primary mainPath.
     *  rank=1 = best alt, rank=K-1 = worst alt kept. score = node.score
     *  (interruptionScore on that alt's tree node, NOT the post-replay
     *  field-state matched count — that requires a separate replay pass). */
    altOf?: { mainFixtureId: string; rank: number; score: number };
  },
  outPath: string,
): void {
  const ctx = buildFeatureContext({
    metadata: meta.cardMetadata,
    interruptionTags: meta.interruptionTags,
    interruptionWeights: meta.interruptionWeights,
    mainDeck: meta.mainDeck,
    extraDeck: meta.extraDeck,
  });

  // Fresh handle for replay — DFS may have left its solving handle dirty.
  // Phase 5-lite (2026-04-19): replay-trajectory.ts also flips this flag for
  // fixtures recorded with multi-pick exposure. Mirror so both authored and
  // ML-extracted trajectories use identical replay semantics.
  const wasMultiPick = adapter.exposeMultiPickMechanical;
  adapter.exposeMultiPickMechanical = true;
  const handle = adapter.createDuel(duelConfig);
  const trajectory: TrajectoryStepDump[] = [];

  try {
    for (let i = 0; i < mainPath.length; i++) {
      const step = mainPath[i];
      const legal = adapter.getLegalActions(handle);
      if (legal.length === 0) {
        // Path exhausted before mainPath — record divergence and stop.
        break;
      }
      const matched = legal.find(
        a => a.responseIndex === step.responseIndex && a.cardId === step.cardId,
      );
      if (!matched) {
        // Drift — re-record needed; truncate dump here.
        break;
      }
      const fieldState = adapter.getFieldState(handle);
      const stateVec = extractStateFeatures(fieldState, ctx);
      const actionVec = extractActionFeatures(matched, fieldState, ctx);
      // Apply the same is_self_turn override the ranker sees (extractFeatures
      // sets stateVec[4] from action.team). Keep the dump consistent with the
      // 116-dim vector NeuralFeatureRanker actually scored.
      stateVec[4] = matched.team === 1 ? 0 : 1;

      const stateNamed: Record<string, number> = {};
      for (let j = 0; j < STATE_FEATURE_NAMES.length; j++) {
        stateNamed[STATE_FEATURE_NAMES[j]] = stateVec[j];
      }
      const actionNamed: Record<string, number> = {};
      for (let j = 0; j < ACTION_FEATURE_NAMES.length; j++) {
        actionNamed[ACTION_FEATURE_NAMES[j]] = actionVec[j];
      }

      trajectory.push({
        step: i,
        promptType: matched.promptType,
        responseIndex: step.responseIndex,
        cardId: step.cardId,
        cardName: step.cardName,
        actionDescription: step.actionDescription,
        actionVerb: matched.actionVerb ?? null,
        stateFeatures: stateNamed,
        actionFeatures: actionNamed,
      });

      adapter.applyAction(handle, matched);
    }
  } finally {
    adapter.destroyDuel(handle);
    adapter.exposeMultiPickMechanical = wasMultiPick;
  }

  const archStr = meta.weights
    ? (meta.weights.arch.hidden.length === 0
        ? 'linear'
        : `mlp[${meta.weights.arch.hidden.join(',')}]`)
    : null;

  const dump: TrajectoryDumpFile = {
    schemaVersion: 1,
    fixtureId: meta.fixtureId,
    deckLabel: meta.deckLabel,
    weightsBasename: meta.weightsBasename,
    weightsHash: meta.weights?.featureSpecHash ?? null,
    weightsArch: archStr,
    featureSpecHash: computeFeatureSpecHash(),
    evalConfig: {
      expertiseDisabled: meta.expertiseDisabled,
      implicitGoalsWeight: meta.implicitGoalsWeight,
      budgetMs: meta.budgetMs,
      nodeBudget: meta.nodeBudget,
    },
    outcome: meta.outcome,
    ...(meta.altOf ? { altOf: meta.altOf } : {}),
    trajectory,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(dump, null, 2) + '\n', 'utf-8');
}

export async function runFixture(
  adapter: OCGCoreAdapter,
  scorer: InterruptionScorer,
  ranker: RouteAwareRanker,
  fixture: FixtureFile,
  hand: HandFixture,
  allConfigs: ReturnType<typeof loadAllSolverConfigs>,
  timeLimitMs: number,
  rootChildBudgetNodes: number | undefined,
  opts?: {
    useHints?: boolean;
    algorithm?: 'dfs' | 'mcts';
    dfsRanker?: ActionRanker;
    /** When true and `dfsRanker instanceof GraphGuidedRanker`, enable per-edge
     *  usage tracking on the ranker for the duration of this fixture's DFS run
     *  and embed the dump in the returned `FixtureResult.edgeUsage`. */
    dumpEdges?: boolean;
    /** Phase 3 Stage 1 — when set, after the DFS solve completes, replay the
     *  best mainPath on a fresh duel fork and write a per-fixture trajectory
     *  JSON to `<dumpTrajectoriesDir>/<fixtureId>.json`. Side-effect free on
     *  the caller's adapter state. Requires `cardMetadata` for the feature
     *  context. */
    dumpTrajectoriesDir?: string;
    /** Phase 3 Stage 1 — card metadata for feature extraction. Required when
     *  `dumpTrajectoriesDir` is set; ignored otherwise. */
    cardMetadata?: CardMetadataMap;
    /** Phase 3 Stage 1 — basename of the trained weights used in the DFS
     *  solve, embedded in the trajectory dump for traceability. Pass `null`
     *  for vanilla (untrained) DFS. */
    weightsBasename?: string | null;
    /** Phase 3 Stage 1 — neural weights blob (architecture + featureSpecHash
     *  metadata only; not used in extraction). Pass `null` if vanilla. */
    weights?: NeuralWeights | null;
    /** Phase 3 Stage 3a — when set and > 0, after the main mainPath dump,
     *  walk the top-K alt children of `result.tree` (excluding the main's
     *  first decision) and dump each as `<fixtureId>_alt-N.json`. Augments
     *  the corpus by ~K samples per fixture without rerunning DFS. Empty
     *  alts (zero score, empty subtree) are skipped silently. */
    dumpAltsK?: number;
  },
): Promise<FixtureResult> {
  const deck = fixture.decks[hand.deck];
  if (!deck) throw new Error(`Deck '${hand.deck}' not found`);

  const mainDeck = [...deck.main];
  for (const cid of hand.hand) {
    const idx = mainDeck.indexOf(cid);
    if (idx === -1) throw new Error(`Hand card ${cid} not in ${hand.deck}`);
    mainDeck.splice(idx, 1);
  }

  // Strategic Grammar v1 — filter archetype expertise by this fixture's
  // main-deck composition and push into scorer + ranker. The setters ensure
  // per-fixture context; the shared instances are reused across fixtures.
  // Filtering runs on the post-hand-removal mainDeck PLUS the hand itself
  // (initial hand cards ARE in-deck semantically).
  //
  // `SOLVER_DISABLE_EXPERTISE=1` (2026-04-26) — ablation flag for honest
  // baseline measurement. When set, both scorer and ranker receive an empty
  // expertise list, so:
  //   - InterruptionScorer.evaluateGoalMatch returns 0 (goalMatchPoints=0)
  //   - RouteAwareRanker.rank passes through to base ranker (no route bonuses)
  // Used to measure how much of the cum-score lift is attributable to
  // authored expertise scaffolding vs. pure search/structural/Phase-A.
  const deckCardIds = [...deck.main, ...deck.extra];
  const expertiseDisabled = process.env.SOLVER_DISABLE_EXPERTISE === '1';
  const filteredExpertise = expertiseDisabled
    ? []
    : filterExpertiseByDeck(allConfigs.archetypeExpertise, deckCardIds);
  scorer.setArchetypeExpertise(filteredExpertise);
  scorer.setDeckContents(deckCardIds);
  ranker.setArchetypeExpertise(filteredExpertise);

  // Phase A scorer fix (2026-04-26) — env-gated implicit ComboGoals from the
  // fixture's `expectedBoard`. Each card present on the terminal field
  // contributes `weight` units to interruptionScore. Always called per fixture
  // so a prior fixture's implicit goals never leak into this one (workers are
  // pooled across fixtures). Defaults to disabled (weight=0, goals=[]) so
  // pre-Phase-A baselines reproduce when the env vars are absent.
  const implicitGoalsEnabled = process.env.SOLVER_IMPLICIT_GOALS === '1';
  const implicitGoalWeight = implicitGoalsEnabled
    ? Number(process.env.SOLVER_IMPLICIT_GOALS_WEIGHT ?? '10')
    : 0;
  const implicitGoals = (implicitGoalsEnabled && hand.expectedBoard)
    ? hand.expectedBoard.map(e => ({
        zone: e.zone,
        cardId: e.cardId,
        ...(e.position !== undefined ? { position: e.position } : {}),
      }))
    : [];
  scorer.setImplicitBoardGoals(implicitGoals, implicitGoalWeight);

  const preferredSearchTargets = [
    ...(hand.expectedBoard ?? []).map(e => e.cardId),
    ...(hand.preferredIntermediates ?? []),
  ];

  const duelConfig: DuelConfig = {
    mainDeck,
    extraDeck: deck.extra,
    hand: hand.hand,
    deckSeed: hand.deckSeed.split(',').map(s => BigInt(s.trim())),
    opponentDeck: [],
    startingDrawCount: 0,
    drawCountPerTurn: 1,
    preferredSearchTargets,
  };

  const maxDepth = hand.maxDepth ?? allConfigs.solverConfig.maxDepth;
  const perFixtureConfig = {
    ...allConfigs.solverConfig,
    maxDepth,
    maxResultNodes: Math.max(allConfigs.solverConfig.maxResultNodes, maxDepth * 20),
  };
  const algorithm = opts?.algorithm ?? 'dfs';
  const hasher = new ZobristHasher();
  const table = new TranspositionTable(perFixtureConfig.transpositionMaxEntries);
  // dfsRanker = outer ranker stack (potentially GraphGuidedRanker(ranker) or
  // NeuralFeatureRanker(ranker)). Defaults to `ranker` so existing serial
  // callers keep working unchanged.
  const dfsRanker: ActionRanker = opts?.dfsRanker ?? ranker;
  // Phase B (graph-ml-v2): refresh per-fixture deck pools on the neural ranker.
  // Deck Sets are pre-computed once per call and reused across the rank()
  // batch. Cheap; idempotent if the pools haven't changed.
  // PolicyGuidedRanker delegates these setters to its inner — calling on the
  // outer wrapper updates both feature contexts.
  if (dfsRanker instanceof PolicyGuidedRanker) {
    dfsRanker.setMainDeck(deck.main);
    dfsRanker.setExtraDeck(deck.extra);
  } else if (dfsRanker instanceof NeuralFeatureRanker) {
    dfsRanker.setMainDeck(deck.main);
    dfsRanker.setExtraDeck(deck.extra);
  }
  const solver = algorithm === 'mcts'
    ? new MCTSSolver(scorer, adapter, dfsRanker, perFixtureConfig)
    : new DfsSolver(hasher, table, scorer, adapter, dfsRanker, perFixtureConfig);
  if (algorithm === 'mcts') {
    (solver as MCTSSolver).setSeed(duelConfig.deckSeed);
  }
  const startHandle = adapter.createDuel(duelConfig);
  const signal = AbortSignal.timeout(timeLimitMs + 5000);
  const solverConfig: SolverConfig = {
    mode: 'goldfish',
    speed: 'optimal',
    timeLimitMs,
    rootChildBudgetNodes,
  };

  // Strategic Grammar v1 × canonical-path hints (2026-04-21). When opts.useHints
  // is set, load the authored hint file and force-pin the starter decisions.
  // Hints complement goal-match scoring: hints steer DFS into the canonical
  // branch, grammar rewards reaching goals within that branch.
  if (opts?.useHints) {
    const hint = loadHintForFixture(hand.id);
    if (hint) {
      if (Array.isArray(hint.canonicalPath) && hint.canonicalPath.length > 0) {
        solverConfig.canonicalPath = hint.canonicalPath;
      }
      if (Array.isArray(hint.bannedCardIds) && hint.bannedCardIds.length > 0) {
        solverConfig.bannedCardIds = hint.bannedCardIds;
      }
    }
  }

  // Edge-usage tracking (graph-ml-v1 audit reco #2). Toggled per-fixture so
  // worker reuse across tasks doesn't leak hits between fixtures. Only fires
  // when dfsRanker is a GraphGuidedRanker — RouteAware-only paths skip
  // silently (no graph weights to track).
  let trackingActive = false;
  if (opts?.dumpEdges && dfsRanker instanceof GraphGuidedRanker) {
    dfsRanker.enableTracking();
    trackingActive = true;
  }

  const t0 = Date.now();
  const result = solver.solve(adapter, solverConfig, signal, () => {}, startHandle);
  const wallMs = Date.now() - t0;

  let edgeUsage: RankerTrackingDump | undefined;
  if (trackingActive && dfsRanker instanceof GraphGuidedRanker) {
    edgeUsage = dfsRanker.getTracking();
    dfsRanker.disableTracking();
  }

  const peakFs = result.stats.diagnostic?.bestTurn1FieldState as undefined | {
    zones: Record<string, { cardId: number; cardName?: string; position?: string }[]>;
  };
  const expected = hand.expectedBoard ?? [];
  const matchedCardIds: number[] = [];
  const missingCardIds: number[] = [];
  const mismatchDiagnostics: string[] = [];
  for (const e of expected) {
    let found = false;
    let foundByIdAnywhere: { zone: string; position: string } | null = null;
    if (peakFs) {
      for (const [zoneName, zs] of Object.entries(peakFs.zones)) {
        const zoneOk = zoneMatches(e.zone, zoneName);
        for (const c of zs) {
          if (c.cardId !== e.cardId) continue;
          if (!foundByIdAnywhere) foundByIdAnywhere = { zone: zoneName, position: c.position ?? '?' };
          if (!zoneOk) continue;
          if (!positionMatches(e.position, c.position ?? '')) continue;
          found = true;
          break;
        }
        if (found) break;
      }
    }
    if (found) matchedCardIds.push(e.cardId);
    else {
      missingCardIds.push(e.cardId);
      const expectedDesc = `${e.zone}${e.position ? `/${e.position}` : ''}`;
      if (foundByIdAnywhere) {
        mismatchDiagnostics.push(
          `  miss: ${e.cardId} ${e.cardName} — expected ${expectedDesc}, actual ${foundByIdAnywhere.zone}/${foundByIdAnywhere.position}`,
        );
      } else {
        mismatchDiagnostics.push(`  miss: ${e.cardId} ${e.cardName} — expected ${expectedDesc}, NOT ON FIELD`);
      }
    }
  }
  if (mismatchDiagnostics.length > 0 && process.env.SOLVER_DUMP_MISMATCHES === '1') {
    for (const line of mismatchDiagnostics) console.log(line);
  }

  const diag = result.stats.diagnostic;
  const totalTerminals = diag
    ? Object.values(diag.terminalReasons).reduce((a, b) => a + b, 0)
    : 0;
  const actionsZeroCount = diag?.terminalReasons['actionsZero'] ?? 0;
  const turn2Count = diag?.terminalReasons['turn2'] ?? 0;
  const actionsZeroPct = totalTerminals > 0 ? (actionsZeroCount / totalTerminals) * 100 : 0;
  const turn2Pct = totalTerminals > 0 ? (turn2Count / totalTerminals) * 100 : 0;

  // Phase 3 Stage 1 — trajectory dump. Always runs when the dir is set, even
  // for empty mainPath (writes a stub so corpus completeness is auditable).
  if (opts?.dumpTrajectoriesDir && opts?.cardMetadata) {
    const outPath = resolve(opts.dumpTrajectoriesDir, `${hand.id}.json`);
    dumpTrajectoryToFile(
      adapter,
      duelConfig,
      result.mainPath,
      {
        fixtureId: hand.id,
        deckLabel: hand.deck,
        weightsBasename: opts.weightsBasename ?? null,
        weights: opts.weights ?? null,
        cardMetadata: opts.cardMetadata,
        interruptionTags: allConfigs.interruptionTags,
        interruptionWeights: allConfigs.interruptionWeights,
        mainDeck: deck.main,
        extraDeck: deck.extra,
        expertiseDisabled,
        implicitGoalsWeight: implicitGoalWeight,
        budgetMs: timeLimitMs,
        nodeBudget: rootChildBudgetNodes ?? null,
        outcome: {
          score: result.score,
          matched: matchedCardIds.length,
          matchedTotal: expected.length,
          matchedCardIds,
          missingCardIds,
          nodesExplored: result.stats.nodesExplored,
          wallMs,
          terminationReason: result.stats.terminationReason,
        },
      },
      outPath,
    );

    // Phase 3 Stage 3a alt augmentation. Walk the top-K children of result.tree
    // (excluding the main mainPath's first decision) sorted by node.score desc,
    // dump each as `<fixtureId>_alt-N.json`. Skips empty-trajectory alts (alt
    // had no further decisions explored — common when nodeBudget is tight and
    // the DFS only fully explored the main branch).
    // Note: in single-worker DFS mode, `result.tree` is the iterative-deepening
    // last-completed iteration's tree, which generally contains only 1 deeply-
    // explored root child (the α-β winner). Alt yield at typical budgets
    // (nb=400/6s) is therefore ~0-1 per fixture. The multi-seed orchestrator
    // (solver-worker.ts) merges trees from multiple seeds and produces richer
    // alts; bypassed here for evaluator simplicity. For meaningful augmentation,
    // prefer multi-budget runs over alt extraction.
    const dumpAltsK = opts.dumpAltsK ?? 0;
    if (dumpAltsK > 0 && result.tree?.children?.length) {
      const mainFirstResponseIdx = result.mainPath[0]?.responseIndex;
      const altCandidates = result.tree.children
        .filter(c => c.action.responseIndex !== mainFirstResponseIdx)
        .sort((a, b) => b.score - a.score)
        .slice(0, dumpAltsK);
      for (let i = 0; i < altCandidates.length; i++) {
        const altRoot = altCandidates[i];
        // Same prepend-then-extract pattern used by solver-worker.ts top-K
        // (see verification-off-by-one fix 2026-04-24).
        const altMainPath = [altRoot.action, ...extractMainPath(altRoot)];
        if (altMainPath.length === 0) continue;
        const altOutPath = resolve(opts.dumpTrajectoriesDir, `${hand.id}_alt-${i + 1}.json`);
        dumpTrajectoryToFile(
          adapter,
          duelConfig,
          altMainPath,
          {
            fixtureId: `${hand.id}_alt-${i + 1}`,
            deckLabel: hand.deck,
            weightsBasename: opts.weightsBasename ?? null,
            weights: opts.weights ?? null,
            cardMetadata: opts.cardMetadata,
            interruptionTags: allConfigs.interruptionTags,
            interruptionWeights: allConfigs.interruptionWeights,
            mainDeck: deck.main,
            extraDeck: deck.extra,
            expertiseDisabled,
            implicitGoalsWeight: implicitGoalWeight,
            budgetMs: timeLimitMs,
            nodeBudget: rootChildBudgetNodes ?? null,
            outcome: {
              // Alt-specific score from the tree node; matched/missing left
              // as the main's (re-running matched-on-board for each alt would
              // require an extra replay pass — defer until the alts prove
              // useful for training).
              score: altRoot.score,
              matched: matchedCardIds.length,
              matchedTotal: expected.length,
              matchedCardIds,
              missingCardIds,
              nodesExplored: result.stats.nodesExplored,
              wallMs,
              terminationReason: result.stats.terminationReason,
            },
            altOf: {
              mainFixtureId: hand.id,
              rank: i + 1,
              score: altRoot.score,
            },
          },
          altOutPath,
        );
      }
    }
  }

  return {
    score: result.score,
    transpositionHits: result.stats.transpositionHits,
    explorationScore: result.scoreBreakdown.explorationScore,
    breakdown: result.scoreBreakdown,
    matched: matchedCardIds.length,
    matchedTotal: expected.length,
    matchedCardIds,
    missingCardIds,
    terminationReason: result.stats.terminationReason,
    nodesExplored: result.stats.nodesExplored,
    maxDepthReached: result.stats.maxDepthReached,
    actionsZeroPct: Number(actionsZeroPct.toFixed(1)),
    turn2Pct: Number(turn2Pct.toFixed(1)),
    wallMs,
    ...(edgeUsage ? { edgeUsage } : {}),
  };
}

/** Score-regression thresholds (v2).
 *
 *  A fixture is flagged as a score-regression when BOTH:
 *   - absolute drop exceeds `SCORE_REGRESSION_ABSOLUTE` (guards against
 *     relative false positives on low-score fixtures like Dinomorphia at ~1)
 *   - relative drop exceeds `SCORE_REGRESSION_RELATIVE` of the prior score
 *     (guards against absolute false positives on high-score fixtures where
 *     a -2 is noise).
 *
 *  Tuned so that the Phase 3 nekroz-ryzeal drop (-11 on baseline 46.58 =
 *  -23%) surfaces, while typical run-to-run variance (<1%) does not. */
const SCORE_REGRESSION_ABSOLUTE = 2.0;
const SCORE_REGRESSION_RELATIVE = 0.10;

function compareBaselines(prev: BaselineFile, curr: BaselineFile): {
  regressions: string[];
  improvements: string[];
  corrections: string[];
  stable: string[];
} {
  const regressions: string[] = [];
  const improvements: string[] = [];
  const corrections: string[] = [];
  const stable: string[] = [];
  const ids = new Set([...Object.keys(prev.fixtures), ...Object.keys(curr.fixtures)]);
  for (const id of ids) {
    const p = prev.fixtures[id];
    const c = curr.fixtures[id];
    if (!p) { improvements.push(`${id}: NEW fixture  matched=${c.matched}/${c.matchedTotal}  score=${c.score}`); continue; }
    if (!c) { regressions.push(`${id}: REMOVED`); continue; }
    const matchDelta = c.matched - p.matched;
    const scoreDelta = c.score - p.score;
    const relScoreDelta = p.score > 0 ? scoreDelta / p.score : 0;
    const isScoreRegression =
      scoreDelta < -SCORE_REGRESSION_ABSOLUTE &&
      relScoreDelta < -SCORE_REGRESSION_RELATIVE;
    const line = `${id}: matched ${p.matched}→${c.matched} (Δ${matchDelta >= 0 ? '+' : ''}${matchDelta})  score ${p.score}→${c.score} (Δ${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(2)})`;
    // Methodology v2 matched-drop rubric:
    //   matched ↓  + score ↓      → regression
    //   matched ↓  + score stable → correction (stricter endboard, not a bug)
    //   matched ↓  + score ↑      → correction (stricter endboard + better exploration)
    //   matched =  + score ↓      → score-only regression (threshold)
    //   matched ↑                 → improvement
    //   else                      → stable
    if (matchDelta < 0 && !isScoreRegression) {
      corrections.push(`${line}  [correction: stricter endboard]`);
    } else if (matchDelta < 0 || isScoreRegression) {
      regressions.push(isScoreRegression && matchDelta >= 0 ? `${line}  [score-only: -${(-relScoreDelta * 100).toFixed(1)}%]` : line);
    }
    else if (matchDelta > 0 || scoreDelta > 0) improvements.push(line);
    else stable.push(line);
  }
  return { regressions, improvements, corrections, stable };
}

// =============================================================================
// Reusable evaluation API — used by scripts/tune-weights.ts (C4) to run many
// evaluations without re-paying the cardDB/scripts/adapter boot cost.
// =============================================================================

export interface EvaluationContext {
  fixture: FixtureFile;
  adapter: OCGCoreAdapter;
  scorer: InterruptionScorer;
  /** Inner expertise host (always RouteAwareRanker). `runFixture` calls
   *  `setArchetypeExpertise` here. */
  ranker: RouteAwareRanker;
  /** Outer ranker passed to the DfsSolver. When `SOLVER_USE_TUNED_WEIGHTS=1`
   *  is set at process boot, this is `GraphGuidedRanker(ranker)` with weights
   *  loaded from `data/trained-weights/<basename>.json`. Otherwise it equals
   *  `ranker`. Mirror of solver-worker.ts wiring so the eval harness reflects
   *  production runtime exactly. */
  dfsRanker: ActionRanker;
  allConfigs: ReturnType<typeof loadAllSolverConfigs>;
  /** Same map injected into the scorer — exposed so diagnostic probes can
   *  call `computeLatentInterruption` / `computeStructuralValue` directly
   *  on a FieldState without rebuilding metadata. */
  cardMetadata: CardMetadataMap;
  metadataSize: number;
  /** Phase 3 Stage 1 — neural weights blob loaded at boot (same one wired
   *  into `dfsRanker` when graph-ml-v2 is active). `null` when no neural
   *  weights loaded. Read by the trajectory dump for embedded traceability
   *  (featureSpecHash, arch). */
  neuralWeights: NeuralWeights | null;
  /** Phase 3 Stage 1 — basename of the loaded neural weights file.
   *  Defaults to `process.env.SOLVER_NEURAL_WEIGHTS_FILE` when set, else
   *  `'neural-tier-a-latest'`. `null` when neural weights are not loaded. */
  neuralWeightsBasename: string | null;
  dispose(): void;
}

export interface EvaluationOptions {
  /** Fixture ids to include. `undefined` = all non-draft fixtures; an
   *  explicit (possibly singleton) array = that subset. The CLI `--only`
   *  flag wraps its single id into `[id]`. */
  fixtureFilter?: readonly string[];
  timeLimitMs: number;
  nodeBudget?: number;
  label: string;
}

/**
 * Absolute data directory (cards.cdb + scripts_full + solver configs).
 * Module-level so both the heavy `setupEvaluationContext()` path (workers)
 * and the light `loadDefaultBudgetMs()` path (main) share a single source
 * of truth for the on-disk layout.
 */
export const DATA_DIR = resolve(import.meta.dirname!, '..', 'data');

/** Absolute path to the fixture JSON used by evaluation harnesses. */
export const FIXTURE_PATH = resolve(
  import.meta.dirname!, '..', '..',
  '_bmad-output', 'planning-artifacts', 'research', 'solver-validation-decks.json',
);

/**
 * Light fixture loader for main threads that don't need to boot OCGCore
 * (parallel-mode orchestrators). Paired with `loadDefaultBudgetMs()` it lets
 * `main()` dispatch tasks to workers without paying the ~2s WASM boot itself.
 */
export function loadFixtureFile(): FixtureFile {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as FixtureFile;
}

/**
 * Load `solverConfig.timeBudgetOptimalMs` without booting WASM. Touches only
 * the SQLite cardDB + JSON configs. Used by main() to derive the default CLI
 * budget when `--budget-ms` is absent, without paying boot cost.
 */
export function loadDefaultBudgetMs(): number {
  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  return loadAllSolverConfigs(DATA_DIR, cardDB).solverConfig.timeBudgetOptimalMs;
}

/**
 * Build the shared evaluation context once per process. The adapter, scorer,
 * and ranker are reused across many `runEvaluation()` calls — boot cost
 * (cardDB + scripts + OCGCore create) is paid once.
 *
 * Metadata is built from the union of ALL non-draft fixture cards (ignoring
 * any per-run `fixtureFilter`), so the same context serves any fixture subset.
 */
export async function setupEvaluationContext(): Promise<EvaluationContext> {
  const fixture = loadFixtureFile();

  const cardDB = loadDatabase(join(DATA_DIR, 'cards.cdb'));
  const scripts = loadScripts(join(DATA_DIR, 'scripts_full'));
  const allConfigs = loadAllSolverConfigs(DATA_DIR, cardDB);
  const adapter = await OCGCoreAdapter.create(cardDB, scripts, allConfigs.interruptionTags);

  const metadataCardIds: number[] = [];
  for (const h of fixture.hands) {
    if (h._draft === true) continue;
    const deck = fixture.decks[h.deck];
    if (!deck) continue;
    metadataCardIds.push(...deck.main, ...deck.extra, ...h.hand);
  }
  const cardMetadata = buildCardMetadataMap(cardDB, metadataCardIds);

  const scorer = new InterruptionScorer(
    allConfigs.interruptionTags,
    allConfigs.interruptionWeights,
    cardMetadata,
    allConfigs.structuralWeights,
    allConfigs.structuralTutorCards,
  );
  const ranker = new RouteAwareRanker(new GoldfishChainRanker(allConfigs.interruptionTags));

  // Graph-ml-v1 (SOLVER_USE_TUNED_WEIGHTS=1) and graph-ml-v2 (SOLVER_USE_NEURAL_WEIGHTS=1)
  // are mutually exclusive — when both env vars are set, neural wins (Phase B
  // design doc §2). Off by default → `dfsRanker === ranker`, behaviour unchanged.
  const neuralWeights = loadNeuralWeightsIfEnabled({ dataDir: DATA_DIR });
  const tunedWeights = neuralWeights ? undefined : loadTunedWeightsIfEnabled({ dataDir: DATA_DIR });
  const verbPolicyWeights = loadVerbPolicyIfEnabled({ dataDir: DATA_DIR });
  let dfsRanker: ActionRanker;
  if (neuralWeights) {
    const nr = new NeuralFeatureRanker(ranker);
    nr.setMetadata(cardMetadata);
    nr.setInterruptionTags(allConfigs.interruptionTags);
    nr.setInterruptionWeights(allConfigs.interruptionWeights);
    nr.setNeuralWeights(neuralWeights);
    // Per-fixture mainDeck/extraDeck pools are pushed by `runFixture` (deck-pool
    // features need per-fixture context).
    dfsRanker = nr;
  } else if (tunedWeights) {
    const gr = new GraphGuidedRanker(ranker);
    gr.setWeights(tunedWeights);
    dfsRanker = gr;
  } else {
    dfsRanker = ranker;
  }

  // Phase 3 Stage 3b — verb-policy wraps whichever ranker is current.
  // setMainDeck/setExtraDeck are pushed per-fixture by `runFixture`.
  if (verbPolicyWeights) {
    const pgr = new PolicyGuidedRanker(dfsRanker);
    pgr.setMetadata(cardMetadata);
    pgr.setInterruptionTags(allConfigs.interruptionTags);
    pgr.setInterruptionWeights(allConfigs.interruptionWeights);
    pgr.setVerbPolicyWeights(verbPolicyWeights);
    dfsRanker = pgr;
  }

  const neuralWeightsBasename = neuralWeights
    ? (process.env['SOLVER_NEURAL_WEIGHTS_FILE'] ?? 'neural-tier-a-latest')
    : null;

  return {
    fixture,
    adapter,
    scorer,
    ranker,
    dfsRanker,
    allConfigs,
    cardMetadata,
    metadataSize: cardMetadata.size,
    neuralWeights: neuralWeights ?? null,
    neuralWeightsBasename,
    dispose: () => adapter.destroyAll(),
  };
}

/**
 * Per-task payload sent from main thread to a pool worker. The worker resets
 * its scorer to the baseline weights, applies `weightsOverride` (if any),
 * then runs the single fixture. Keeping override as part of the task lets one
 * worker serve many candidates across a tuning sweep.
 */
export interface FixtureTask {
  fixtureId: string;
  weightsOverride?: WeightsOverride;
  timeLimitMs: number;
  nodeBudget?: number;
  label: string;
  /** Strategic Grammar v1 + canonical-path hint pipeline (2026-04-21). When
   *  true, runFixture looks up
   *  `_bmad-output/planning-artifacts/research/trajectories/<fixtureId>-hint.json`
   *  and populates `SolverConfig.canonicalPath` + `bannedCardIds` from it.
   *  Opt-in — default off to preserve pre-hint baseline semantics. */
  useHints?: boolean;
  /** Solver algorithm. Defaults to 'dfs' for backward-compatibility with
   *  pre-2026-04-21 baselines. 'mcts' invokes the production-ready MCTSSolver
   *  with UCB1 selection + epsilon-greedy rollouts via the same ranker +
   *  scorer as DFS. */
  algorithm?: 'dfs' | 'mcts';
  /** Graph-ml-v1 audit reco #2: per-fixture per-edge usage dump. Worker
   *  toggles tracking on the GraphGuidedRanker for this task only. No-op when
   *  the dfsRanker isn't graph-guided (a warning is logged main-side). */
  dumpEdges?: boolean;
  /** Phase 3 Stage 1 (2026-04-27) — when set, the worker writes a per-fixture
   *  trajectory JSON to `<dumpTrajectoriesDir>/<fixtureId>.json` after the
   *  DFS solve completes. Worker pulls cardMetadata + neural weights from
   *  its own EvaluationContext for traceability metadata. */
  dumpTrajectoriesDir?: string;
  /** Phase 3 Stage 3a (2026-04-27) — when > 0 and `dumpTrajectoriesDir` is
   *  set, the worker also dumps the top-K alt branches of the search tree
   *  as `<fixtureId>_alt-N.json`. Augments the policy training corpus
   *  without rerunning DFS. */
  dumpAltsK?: number;
}

/** Minimal pool surface consumed by `runEvaluationParallel`. Kept structural
 *  (not importing `Piscina` directly) so the helper stays trivially testable
 *  with an in-memory stub. */
export interface FixturePool {
  run(task: FixtureTask): Promise<FixtureResult>;
}

export interface ParallelEvaluationOptions extends EvaluationOptions {
  /** Optional weight override forwarded to each worker task. Each worker
   *  resets to its baseline before applying, so overrides from different
   *  candidates do not compound. */
  weightsOverride?: WeightsOverride;
  /** Strategic Grammar v1 × hints — when true, each task loads its fixture's
   *  `<id>-hint.json` to pin starter decisions via `SolverConfig.canonicalPath`. */
  useHints?: boolean;
  /** Solver algorithm for this evaluation run. Defaults to 'dfs'. */
  algorithm?: 'dfs' | 'mcts';
  /** When set, each fixture's per-edge usage dump is written to
   *  `<dumpEdgesDir>/<fixtureId>.json`. Only effective when
   *  `SOLVER_USE_TUNED_WEIGHTS=1` so the worker has a GraphGuidedRanker. */
  dumpEdgesDir?: string;
  /** Phase 3 Stage 1 (2026-04-27) — when set, each fixture's mainPath is
   *  replayed on a fresh duel fork after the DFS solve and dumped to
   *  `<dumpTrajectoriesDir>/<fixtureId>.json` with per-step state + action
   *  features. Foundation for Phase 4 policy distillation corpus. */
  dumpTrajectoriesDir?: string;
  /** Phase 3 Stage 3a (2026-04-27) — when > 0, dump the top-K alt branches
   *  of each fixture's search tree alongside the main mainPath. Augments
   *  the corpus by ~K samples per fixture without rerunning DFS. */
  dumpAltsK?: number;
}

/**
 * Parallel fixture evaluation. Dispatches one task per fixture to the pool
 * and assembles a `BaselineFile` identical to the serial `runEvaluation()`
 * output. Logs per-fixture summaries as tasks settle — order is completion
 * order, not fixture-list order (trivially re-sortable downstream via
 * `baseline.fixtures` keys).
 */
export async function runEvaluationParallel(
  pool: FixturePool,
  fixture: FixtureFile,
  opts: ParallelEvaluationOptions,
): Promise<BaselineFile> {
  const validHands = fixture.hands.filter(h => {
    if (h._draft === true) return false;
    if (opts.fixtureFilter && !opts.fixtureFilter.includes(h.id)) return false;
    return true;
  });

  const modeTag = opts.nodeBudget !== undefined
    ? `node-budget=${opts.nodeBudget}`
    : `phase-L=wall-clock`;
  console.log(`[evaluate-par] fixtures: ${validHands.length}  budget=${opts.timeLimitMs}ms  ${modeTag}  label='${opts.label}'`);

  const fixtureResults: Record<string, FixtureResult> = {};
  if (opts.dumpEdgesDir) {
    mkdirSync(resolve(opts.dumpEdgesDir), { recursive: true });
    console.log(`[evaluate-par] edge usage dump → ${resolve(opts.dumpEdgesDir)}/<fixture>.json`);
  }
  if (opts.dumpTrajectoriesDir) {
    mkdirSync(resolve(opts.dumpTrajectoriesDir), { recursive: true });
    console.log(`[evaluate-par] trajectory dump → ${resolve(opts.dumpTrajectoriesDir)}/<fixture>.json`);
  }
  // Dispatch all tasks up-front; pool schedules them across its worker set.
  // Promise.allSettled so a single fixture failure does not abort the sweep.
  const settled = await Promise.allSettled(validHands.map(async hand => {
    const res = await pool.run({
      fixtureId: hand.id,
      weightsOverride: opts.weightsOverride,
      timeLimitMs: opts.timeLimitMs,
      nodeBudget: opts.nodeBudget,
      label: opts.label,
      useHints: opts.useHints,
      algorithm: opts.algorithm,
      dumpEdges: opts.dumpEdgesDir !== undefined,
      dumpTrajectoriesDir: opts.dumpTrajectoriesDir
        ? resolve(opts.dumpTrajectoriesDir)
        : undefined,
      dumpAltsK: opts.dumpAltsK,
    });
    return { hand, res };
  }));

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const { hand, res } = s.value;
      fixtureResults[hand.id] = res;
      console.log(`  [${hand.id}] (${hand.deck})  score=${res.score}  expl=${res.explorationScore}  ` +
        `latent=${res.breakdown.latentPoints}  matched=${res.matched}/${res.matchedTotal}  ` +
        `nodes=${res.nodesExplored}  depth=${res.maxDepthReached}  ` +
        `az=${res.actionsZeroPct}%  t2=${res.turn2Pct}%  walk=${res.wallMs}ms  term=${res.terminationReason}`);
      if (opts.dumpEdgesDir && res.edgeUsage) {
        const dumpPath = resolve(opts.dumpEdgesDir, `${hand.id}.json`);
        writeFileSync(dumpPath, JSON.stringify({
          fixtureId: hand.id,
          deck: hand.deck,
          ...res.edgeUsage,
        }, null, 2) + '\n', 'utf-8');
      } else if (opts.dumpEdgesDir && !res.edgeUsage) {
        console.warn(`  [${hand.id}] dump-edges requested but no edgeUsage — set SOLVER_USE_TUNED_WEIGHTS=1 so the worker uses GraphGuidedRanker.`);
      }
    } else {
      console.error(`  FAIL: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
    }
  }

  const cumulativeMatched = Object.values(fixtureResults).reduce((a, r) => a + r.matched, 0);
  const cumulativeMatchedTotal = Object.values(fixtureResults).reduce((a, r) => a + r.matchedTotal, 0);
  const cumulativeScore = Object.values(fixtureResults).reduce((a, r) => a + r.score, 0);
  const cumulativeExplorationScore = Object.values(fixtureResults).reduce((a, r) => a + r.explorationScore, 0);

  const baseline: BaselineFile = {
    _meta: {
      timestamp: new Date().toISOString(),
      budgetMs: opts.timeLimitMs,
      scorerVersion: opts.label,
      ...(opts.nodeBudget !== undefined ? { rootChildBudgetNodes: opts.nodeBudget } : {}),
    },
    fixtures: fixtureResults,
    aggregate: {
      cumulativeMatched,
      cumulativeMatchedTotal,
      cumulativeScore,
      cumulativeExplorationScore,
      fixtureCount: Object.keys(fixtureResults).length,
    },
  };

  console.log(`\n[evaluate-par] ═══ AGGREGATE ═══`);
  console.log(`  cumulative matched:          ${cumulativeMatched}/${cumulativeMatchedTotal}`);
  console.log(`  cumulative score:            ${cumulativeScore}`);
  console.log(`  cumulative explorationScore: ${cumulativeExplorationScore}`);
  console.log(`  fixtures:                    ${Object.keys(fixtureResults).length}`);

  return baseline;
}

/**
 * Weights override payload. Both objects are optional; fields missing from
 * the override retain their loaded `structural-weights.json` /
 * `interruption-weights.json` value. Unknown fields throw (silent typos
 * would make tuning runs misleading).
 *
 * On-disk format (consumed by `--weights-override` flag):
 * ```json
 * {
 *   "structural":   { "F1_W": 3, "latentDiscount": 0.7 },
 *   "interruption": { "destruction": 1.5 }
 * }
 * ```
 */
export interface WeightsOverride {
  structural?: Record<string, unknown>;
  interruption?: Record<string, unknown>;
}

export function applyWeightsOverride(
  ctx: EvaluationContext,
  override: WeightsOverride,
  sourceLabel: string,
  opts?: { silent?: boolean },
): void {
  if (override.structural && Object.keys(override.structural).length > 0) {
    const merged = applyStructuralWeightsOverride(ctx.allConfigs.structuralWeights, override.structural);
    ctx.scorer.setStructuralWeights(merged);
    if (!opts?.silent) {
      console.log(`[evaluate] structural override applied from ${sourceLabel} (${Object.keys(override.structural).length} fields)`);
    }
  }
  if (override.interruption && Object.keys(override.interruption).length > 0) {
    const merged = applyInterruptionWeightsOverride(ctx.allConfigs.interruptionWeights, override.interruption);
    ctx.scorer.setInterruptionWeights(merged);
    if (!opts?.silent) {
      console.log(`[evaluate] interruption override applied from ${sourceLabel} (${Object.keys(override.interruption).length} fields)`);
    }
  }
}

/** Reset the scorer's mutable weights to the loader-defined baseline. Called
 *  by each worker task before applying a candidate's override so overrides
 *  from a prior task do not compound into this one. */
export function resetWeightsToBaseline(ctx: EvaluationContext): void {
  ctx.scorer.setStructuralWeights(ctx.allConfigs.structuralWeights);
  ctx.scorer.setInterruptionWeights(ctx.allConfigs.interruptionWeights);
}

async function main(): Promise<void> {
  const outPath = parseStringArg('out');
  const comparePath = parseStringArg('compare');
  const budgetOverride = parseNumArg('budget-ms');
  const nodeBudget = parseNumArg('node-budget');
  const fixtureFilter = parseStringArg('only');
  const scorerVersion = parseStringArg('label') ?? 'unspecified';
  const weightsOverridePath = parseStringArg('weights-override');
  const poolSizeOverride = parseNumArg('pool-size');
  const useHints = process.argv.includes('--use-hints');
  const algorithmArg = parseStringArg('algorithm');
  const algorithm: 'dfs' | 'mcts' = algorithmArg === 'mcts' ? 'mcts' : 'dfs';
  const dumpEdgesDir = parseStringArg('dump-edges-per-fixture');
  const dumpTrajectoriesDir = parseStringArg('dump-trajectories');
  const dumpAltsK = parseNumArg('dump-trajectories-alts');

  // Phase A scorer fix (2026-04-26) — `--implicit-goals=N` CLI flag is a
  // reproducibility wrapper that sets the SOLVER_IMPLICIT_GOALS env vars
  // BEFORE workers spawn (Piscina worker_threads inherit env at creation).
  // The env-var path remains the source of truth in `runFixture` so an
  // explicit env var still works without the flag.
  const implicitGoalsArg = parseNumArg('implicit-goals');
  if (implicitGoalsArg !== undefined && implicitGoalsArg > 0) {
    process.env.SOLVER_IMPLICIT_GOALS = '1';
    process.env.SOLVER_IMPLICIT_GOALS_WEIGHT = String(implicitGoalsArg);
    console.log(`[evaluate] --implicit-goals=${implicitGoalsArg}: expectedBoard cards score +${implicitGoalsArg}/match into interruptionScore`);
  }

  // Parallel mode: main thread stays lightweight (fixture JSON + config read,
  // no WASM boot). Each Piscina worker boots its own OCGCore/scorer once.
  const fixture = loadFixtureFile();
  const timeLimitMs = budgetOverride ?? loadDefaultBudgetMs();
  const weightsOverride = weightsOverridePath !== undefined
    ? JSON.parse(readFileSync(resolve(weightsOverridePath), 'utf-8')) as WeightsOverride
    : undefined;

  const poolSize = poolSizeOverride ?? Math.max(1, availableParallelism() - 2);
  console.log(`[evaluate] pool size: ${poolSize}`);

  const pool = new Piscina({
    // .mjs bootstrap registers tsx's ESM loader inside the worker before
    // dynamic-importing the .ts worker. Direct pointing at the .ts fails
    // because worker threads don't inherit tsx's parent-process hooks.
    filename: resolve(import.meta.dirname!, 'evaluate-structural-worker.mjs'),
    minThreads: poolSize,
    maxThreads: poolSize,
    idleTimeout: Infinity,
  });

  let exitCode = 0;
  try {
    if (useHints) console.log(`[evaluate] --use-hints ENABLED: canonical-path pins from <fixture>-hint.json will override DFS action selection at matching decision points`);
    if (algorithm === 'mcts') console.log(`[evaluate] --algorithm=mcts: using MCTSSolver instead of DfsSolver`);

    const baseline = await runEvaluationParallel(pool, fixture, {
      fixtureFilter: fixtureFilter !== undefined ? [fixtureFilter] : undefined,
      timeLimitMs,
      nodeBudget,
      label: scorerVersion,
      weightsOverride,
      useHints,
      algorithm,
      dumpEdgesDir,
      dumpTrajectoriesDir,
      dumpAltsK,
    });

    if (outPath) {
      const absOut = resolve(outPath);
      mkdirSync(dirname(absOut), { recursive: true });
      writeFileSync(absOut, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
      console.log(`\n[evaluate] wrote ${absOut}`);
    }

    if (comparePath) {
      const prev = JSON.parse(readFileSync(resolve(comparePath), 'utf-8')) as BaselineFile;
      const { regressions, improvements, corrections, stable } = compareBaselines(prev, baseline);
      console.log(`\n[evaluate] ═══ COMPARISON vs ${comparePath} ═══`);
      console.log(`  prev label: '${prev._meta.scorerVersion}'  (${prev._meta.timestamp})`);
      console.log(`  curr label: '${baseline._meta.scorerVersion}'  (${baseline._meta.timestamp})`);
      console.log(`  cumulative matched:           ${prev.aggregate.cumulativeMatched} → ${baseline.aggregate.cumulativeMatched}  (Δ${baseline.aggregate.cumulativeMatched - prev.aggregate.cumulativeMatched >= 0 ? '+' : ''}${baseline.aggregate.cumulativeMatched - prev.aggregate.cumulativeMatched})`);
      console.log(`  cumulative score:             ${prev.aggregate.cumulativeScore} → ${baseline.aggregate.cumulativeScore}  (Δ${baseline.aggregate.cumulativeScore - prev.aggregate.cumulativeScore >= 0 ? '+' : ''}${baseline.aggregate.cumulativeScore - prev.aggregate.cumulativeScore})`);
      // `cumulativeExplorationScore` added in Phase 3.0 C5. Older baselines
      // lack it; coerce to undefined-safe comparison so pre-C5 gates still run.
      const prevExpl = prev.aggregate.cumulativeExplorationScore ?? null;
      const currExpl = baseline.aggregate.cumulativeExplorationScore;
      if (prevExpl !== null) {
        const delta = currExpl - prevExpl;
        console.log(`  cumulative explorationScore:  ${prevExpl} → ${currExpl}  (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`);
      } else {
        console.log(`  cumulative explorationScore:  (prev baseline pre-C5)  curr=${currExpl}`);
      }
      if (improvements.length > 0) {
        console.log(`\n  IMPROVEMENTS (${improvements.length}):`);
        for (const l of improvements) console.log(`    ✓ ${l}`);
      }
      if (corrections.length > 0) {
        console.log(`\n  CORRECTIONS (${corrections.length}):`);
        for (const l of corrections) console.log(`    ~ ${l}`);
      }
      if (stable.length > 0) {
        console.log(`\n  STABLE (${stable.length}):`);
        for (const l of stable) console.log(`    = ${l}`);
      }
      if (regressions.length > 0) {
        console.log(`\n  REGRESSIONS (${regressions.length}):`);
        for (const l of regressions) console.log(`    ✗ ${l}`);
        console.log(`\n[evaluate] FAIL: ${regressions.length} regression(s) detected`);
        exitCode = 1;
      } else {
        console.log(`\n[evaluate] PASS: no regressions`);
      }
    }
  } finally {
    await pool.destroy();
  }

  process.exit(exitCode);
}

// Only run the CLI when this file is the entry point. The worker bootstrap
// imports this module as a library (for its `runFixture`, `setupEvaluation
// Context`, etc.); without this guard, each imported copy would spawn its
// own Piscina pool → recursive fork bomb.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('[evaluate] FATAL:', err);
    process.exit(1);
  });
}
