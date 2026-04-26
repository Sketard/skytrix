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
import { filterExpertiseByDeck } from '../src/solver/solver-config-loader.js';
import type { ActionRanker } from '../src/solver/solver-strategy.js';
import { DfsSolver } from '../src/solver/dfs-solver.js';
import { MCTSSolver } from '../src/solver/mcts-solver.js';
import { ZobristHasher } from '../src/solver/zobrist.js';
import { TranspositionTable } from '../src/solver/transposition-table.js';
import { buildCardMetadataMap, type CardMetadataMap } from '../src/solver/card-metadata.js';
import type { DuelConfig, SolverConfig, ScoreBreakdown } from '../src/solver/solver-types.js';

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
  const deckCardIds = [...deck.main, ...deck.extra];
  const filteredExpertise = filterExpertiseByDeck(allConfigs.archetypeExpertise, deckCardIds);
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
  // dfsRanker = outer ranker stack (potentially GraphGuidedRanker(ranker)).
  // Defaults to `ranker` so existing serial callers keep working unchanged.
  const dfsRanker: ActionRanker = opts?.dfsRanker ?? ranker;
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

  // Graph-ml-v1 opt-in : mirror solver-worker.ts wiring exactly so the eval
  // harness sees the same ranker stack production does. When env gate is off,
  // `dfsRanker === ranker` and behaviour is unchanged.
  const tunedWeights = loadTunedWeightsIfEnabled({ dataDir: DATA_DIR });
  const dfsRanker: ActionRanker = tunedWeights
    ? (() => {
        const gr = new GraphGuidedRanker(ranker);
        gr.setWeights(tunedWeights);
        return gr;
      })()
    : ranker;

  return {
    fixture,
    adapter,
    scorer,
    ranker,
    dfsRanker,
    allConfigs,
    cardMetadata,
    metadataSize: cardMetadata.size,
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
