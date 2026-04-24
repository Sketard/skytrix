// =============================================================================
// fitness-evaluator.ts — graph-ml-v1 M1 composite-reward fitness function.
//
// Runs DFS on a pre-loaded fixture with a supplied GraphWeights vector and
// returns a composite reward designed to provide dense gradient to an
// evolutionary optimizer. Wraps the same scorer / adapter / card-metadata the
// production `solver-worker.ts` uses, so learned weights transfer directly.
//
// Composite reward (per-eval, all terms ≥ 0 under normal conditions):
//   fitness = α × matched²
//           + β × partial_goals          // result.scoreBreakdown.goalMatchPoints
//           + γ × novelty                // nodes_explored − transposition_hits
//           + ε × terminal_bonus         // 1 when DFS terminated cleanly, else 0
//
//   - `matched` counts how many `expectedBoard` cards landed on the peak
//     turn-1 field state. Squaring rewards the combo-completion threshold
//     (low ceiling = rare signal, but a huge step when hit).
//   - `partial_goals` (= goalMatchPoints) gives dense per-goal progress in
//     [0, Σ baselineScore] — the workhorse gradient for M1.
//   - `novelty` is a cheap proxy (distinct states visited) so the optimizer
//     pays a tiny bonus for exploring wider search trees instead of
//     re-walking a learnt pin. Not a true novelty-search metric — that
//     ships in M3.
//   - `terminal_bonus` penalises timeouts / abort terminations so tuning
//     doesn't accidentally steer toward infinite-cost searches.
//
// Roadmap: memory `project_graph_ml_v1_roadmap_2026_04_24.md`.
// =============================================================================

import type { OCGCoreAdapter } from '../../src/solver/ocgcore-adapter.js';
import type { InterruptionScorer } from '../../src/solver/interruption-scorer.js';
import type { RouteAwareRanker } from '../../src/solver/route-aware-ranker.js';
import type { GraphGuidedRanker } from '../../src/solver/graph-guided-ranker.js';
import type { GraphWeights } from '../../src/solver/graph-weights-types.js';
import { DfsSolver } from '../../src/solver/dfs-solver.js';
import { ZobristHasher } from '../../src/solver/zobrist.js';
import { TranspositionTable } from '../../src/solver/transposition-table.js';
import {
  filterExpertiseByDeck,
  type loadAllSolverConfigs,
} from '../../src/solver/solver-config-loader.js';
import type {
  DuelConfig,
  SolverConfig,
  SolverResult,
  FieldState,
  FieldCard,
} from '../../src/solver/solver-types.js';

import type { HandFixture, FixtureFile } from '../evaluate-structural.js';

export interface FitnessWeights {
  alphaMatchedSq: number;
  betaPartialGoals: number;
  gammaNovelty: number;
  epsilonTerminalBonus: number;
}

export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = {
  alphaMatchedSq: 5.0,
  betaPartialGoals: 1.0,
  gammaNovelty: 0.001,
  epsilonTerminalBonus: 2.0,
};

export interface EvaluatorSignals {
  matched: number;
  matchedTotal: number;
  partialGoals: number;
  novelty: number;
  terminalBonus: number;
  interruptionScore: number;
  explorationScore: number;
  nodesExplored: number;
  wallMs: number;
  terminationReason: string;
}

export interface EvaluatorResult {
  fitness: number;
  signals: EvaluatorSignals;
}

export interface FitnessEvaluatorOptions {
  adapter: OCGCoreAdapter;
  scorer: InterruptionScorer;
  /** Base ranker — expertise is set here so goal-match evaluator runs. */
  baseRanker: RouteAwareRanker;
  /** Graph-guided wrapper — receives the per-individual weight vector. */
  graphRanker: GraphGuidedRanker;
  fixture: FixtureFile;
  hand: HandFixture;
  allConfigs: ReturnType<typeof loadAllSolverConfigs>;
  timeLimitMs: number;
  nodeBudget?: number;
  fitnessWeights?: Partial<FitnessWeights>;
}

/**
 * FitnessEvaluator pins ONE fixture per instance — the fixture-level setup
 * (expertise, deck contents, duelConfig) runs once in the constructor, then
 * each `evaluate(weights)` call pays only for: `setWeights` + fresh DFS +
 * `solve` + composite reward computation.
 */
export class FitnessEvaluator {
  private readonly adapter: OCGCoreAdapter;
  private readonly scorer: InterruptionScorer;
  private readonly graphRanker: GraphGuidedRanker;
  private readonly allConfigs: ReturnType<typeof loadAllSolverConfigs>;
  private readonly hand: HandFixture;
  private readonly duelConfig: DuelConfig;
  private readonly timeLimitMs: number;
  private readonly nodeBudget?: number;
  private readonly fitnessWeights: FitnessWeights;
  private readonly perFixtureConfig: ReturnType<typeof loadAllSolverConfigs>['solverConfig'];

  constructor(opts: FitnessEvaluatorOptions) {
    this.adapter = opts.adapter;
    this.scorer = opts.scorer;
    this.graphRanker = opts.graphRanker;
    this.allConfigs = opts.allConfigs;
    this.hand = opts.hand;
    this.timeLimitMs = opts.timeLimitMs;
    this.nodeBudget = opts.nodeBudget;
    this.fitnessWeights = { ...DEFAULT_FITNESS_WEIGHTS, ...opts.fitnessWeights };

    const deck = opts.fixture.decks[opts.hand.deck];
    if (!deck) throw new Error(`[fitness-evaluator] deck '${opts.hand.deck}' not found`);

    const mainDeck = [...deck.main];
    for (const cid of opts.hand.hand) {
      const idx = mainDeck.indexOf(cid);
      if (idx === -1) throw new Error(`[fitness-evaluator] hand card ${cid} not in ${opts.hand.deck}`);
      mainDeck.splice(idx, 1);
    }

    // Pre-set expertise on scorer + base ranker — once per fixture. graphRanker
    // does not need expertise; its bonus is state-independent.
    const deckCardIds = [...deck.main, ...deck.extra];
    const filteredExpertise = filterExpertiseByDeck(this.allConfigs.archetypeExpertise, deckCardIds);
    this.scorer.setArchetypeExpertise(filteredExpertise);
    this.scorer.setDeckContents(deckCardIds);
    opts.baseRanker.setArchetypeExpertise(filteredExpertise);

    this.duelConfig = {
      mainDeck,
      extraDeck: deck.extra,
      hand: opts.hand.hand,
      deckSeed: opts.hand.deckSeed.split(',').map(s => BigInt(s.trim())),
      opponentDeck: [],
      startingDrawCount: 0,
      drawCountPerTurn: 1,
      preferredSearchTargets: [
        ...(opts.hand.expectedBoard ?? []).map(e => e.cardId),
        ...(opts.hand.preferredIntermediates ?? []),
      ],
    };

    const maxDepth = opts.hand.maxDepth ?? this.allConfigs.solverConfig.maxDepth;
    this.perFixtureConfig = {
      ...this.allConfigs.solverConfig,
      maxDepth,
      maxResultNodes: Math.max(this.allConfigs.solverConfig.maxResultNodes, maxDepth * 20),
    };
  }

  evaluate(weights: GraphWeights): EvaluatorResult {
    this.graphRanker.setWeights(weights);

    // Fresh hasher + TT per eval — TT state from a prior individual must not
    // bias the current evaluation (its stored scores reflect different
    // action-ordering, hence different sub-tree values).
    const hasher = new ZobristHasher();
    const table = new TranspositionTable(this.perFixtureConfig.transpositionMaxEntries);
    const solver = new DfsSolver(hasher, table, this.scorer, this.adapter, this.graphRanker, this.perFixtureConfig);

    const solverConfig: SolverConfig = {
      mode: 'goldfish',
      speed: 'optimal',
      timeLimitMs: this.timeLimitMs,
      ...(this.nodeBudget !== undefined ? { rootChildBudgetNodes: this.nodeBudget } : {}),
    };

    const startHandle = this.adapter.createDuel(this.duelConfig);
    const signal = AbortSignal.timeout(this.timeLimitMs + 5000);
    const t0 = Date.now();
    let result: SolverResult;
    try {
      result = solver.solve(this.adapter, solverConfig, signal, () => {}, startHandle);
    } finally {
      this.adapter.destroyDuel(startHandle);
    }
    const wallMs = Date.now() - t0;

    const expected = this.hand.expectedBoard ?? [];
    const peakFs = result.stats.diagnostic?.bestTurn1FieldState;
    const matched = peakFs ? countMatches(expected, peakFs) : 0;

    const novelty = Math.max(
      0,
      result.stats.nodesExplored - (result.stats.transpositionHits ?? 0),
    );
    const terminalBonus = result.stats.terminationReason === 'completed' ? 1 : 0;
    const partialGoals = result.scoreBreakdown.goalMatchPoints;

    const fw = this.fitnessWeights;
    const fitness = fw.alphaMatchedSq * matched * matched
      + fw.betaPartialGoals * partialGoals
      + fw.gammaNovelty * novelty
      + fw.epsilonTerminalBonus * terminalBonus;

    return {
      fitness,
      signals: {
        matched,
        matchedTotal: expected.length,
        partialGoals,
        novelty,
        terminalBonus,
        interruptionScore: result.scoreBreakdown.interruptionScore,
        explorationScore: result.scoreBreakdown.explorationScore,
        nodesExplored: result.stats.nodesExplored,
        wallMs,
        terminationReason: result.stats.terminationReason,
      },
    };
  }
}

// -----------------------------------------------------------------------------
// Expected-board matching (trimmed from evaluate-structural.runFixture — we
// need only the count here, not the diagnostics).
// -----------------------------------------------------------------------------

type ExpectedEntry = NonNullable<HandFixture['expectedBoard']>[number];

function countMatches(expected: readonly ExpectedEntry[], fs: FieldState): number {
  let count = 0;
  for (const e of expected) {
    if (findOnField(fs, e)) count++;
  }
  return count;
}

function findOnField(fs: FieldState, e: ExpectedEntry): boolean {
  for (const [zoneName, cards] of Object.entries(fs.zones)) {
    if (!zoneMatches(e.zone, zoneName)) continue;
    for (const c of cards as FieldCard[]) {
      if (c.cardId !== e.cardId) continue;
      if (!positionMatches(e.position, c.position)) continue;
      return true;
    }
  }
  return false;
}

function zoneMatches(expectedZone: string, actualZone: string): boolean {
  if (expectedZone === actualZone) return true;
  // Accept loose matches for EMZ / MZONE — runFixture uses the same
  // convention (startsWith-based bucketing is adequate for training).
  if (expectedZone === 'MZONE' && actualZone.startsWith('MZONE')) return true;
  if (expectedZone === 'SZONE' && actualZone.startsWith('SZONE')) return true;
  if (expectedZone === 'EMZONE' && actualZone.startsWith('EMZONE')) return true;
  if (expectedZone === 'FZONE' && actualZone.startsWith('FZONE')) return true;
  return false;
}

function positionMatches(expected: ExpectedEntry['position'], actual: FieldCard['position']): boolean {
  if (!expected) return true;
  switch (expected) {
    case 'attack':
      return actual === 'faceup-atk';
    case 'defense':
      return actual === 'faceup-def';
    case 'set':
      return actual === 'facedown-def' || actual === 'facedown';
    default:
      return false;
  }
}
