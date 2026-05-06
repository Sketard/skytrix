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
//           + β × exploration_score      // result.scoreBreakdown.explorationScore
//           + γ × novelty                // nodes_explored − transposition_hits
//           + ε × terminal_bonus         // 1 when DFS terminated cleanly, else 0
//
//   - `matched` counts how many `expectedBoard` cards landed on the peak
//     turn-1 field state. Squaring rewards the combo-completion threshold
//     (low ceiling = rare signal, but a huge step when hit).
//   - `exploration_score` (= scoreBreakdown.explorationScore = interruption
//     + latent) is the production-aligned shaping metric. **2026-04-25
//     reformulation**: prior versions used `goalMatchPoints` here; the audit
//     hooks revealed ES could inflate goalMatchPoints (+11) without producing
//     any matched cards AND while collapsing the production interruption
//     score (71 → 20 on training fixture). Switching to explorationScore
//     aligns ES gradient with production semantics — same metric tune-weights.ts
//     uses as alternate fitness, see evaluate-structural.ts FixtureResult.
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
import type { loadAllSolverConfigs } from '../../src/solver/solver-config-loader.js';

import { runFixture, type HandFixture, type FixtureFile } from '../evaluate-structural.js';

export interface FitnessWeights {
  alphaMatchedSq: number;
  betaExplorationScore: number;
  gammaNovelty: number;
  epsilonTerminalBonus: number;
}

export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = {
  alphaMatchedSq: 5.0,
  betaExplorationScore: 1.0,
  gammaNovelty: 0.001,
  epsilonTerminalBonus: 2.0,
};

export interface EvaluatorSignals {
  matched: number;
  matchedTotal: number;
  /** Kept exposed for diagnostic comparison even though it no longer drives
   *  the composite reward (audit 2026-04-25 — gameable axis). */
  partialGoals: number;
  novelty: number;
  terminalBonus: number;
  interruptionScore: number;
  /** Production-aligned shaping metric — also drives the composite reward
   *  via `betaExplorationScore`. */
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
 * FitnessEvaluator pins ONE fixture per instance. Per-evaluate cost = setWeights
 * on the graph-guided ranker + delegate to `runFixture` (production code path)
 * + composite reward. **Audit 2026-04-25 F7**: prior implementation had its
 * own DFS setup + zone-matching code that diverged from runFixture's. The
 * stricter local zoneMatches reported `matched=0` whenever the actual zone was
 * `M1..M5` (the real scheme) instead of `MZONE0` (the broken expectation),
 * so `α·matched²` was a dead term and ES received no matched-count gradient.
 * Delegating eliminates the divergence by construction.
 */
export class FitnessEvaluator {
  private readonly adapter: OCGCoreAdapter;
  private readonly scorer: InterruptionScorer;
  private readonly baseRanker: RouteAwareRanker;
  private readonly graphRanker: GraphGuidedRanker;
  private readonly allConfigs: ReturnType<typeof loadAllSolverConfigs>;
  private readonly fixture: FixtureFile;
  private readonly hand: HandFixture;
  private readonly timeLimitMs: number;
  private readonly nodeBudget?: number;
  private readonly fitnessWeights: FitnessWeights;

  constructor(opts: FitnessEvaluatorOptions) {
    this.adapter = opts.adapter;
    this.scorer = opts.scorer;
    this.baseRanker = opts.baseRanker;
    this.graphRanker = opts.graphRanker;
    this.allConfigs = opts.allConfigs;
    this.fixture = opts.fixture;
    this.hand = opts.hand;
    this.timeLimitMs = opts.timeLimitMs;
    this.nodeBudget = opts.nodeBudget;
    this.fitnessWeights = { ...DEFAULT_FITNESS_WEIGHTS, ...opts.fitnessWeights };

    const deck = opts.fixture.decks[opts.hand.deck];
    if (!deck) throw new Error(`[fitness-evaluator] deck '${opts.hand.deck}' not found`);
    for (const cid of opts.hand.hand) {
      if (!deck.main.includes(cid)) {
        throw new Error(`[fitness-evaluator] hand card ${cid} not in ${opts.hand.deck}`);
      }
    }
  }

  async evaluate(weights: GraphWeights): Promise<EvaluatorResult> {
    this.graphRanker.setWeights(weights);

    const result = await runFixture(
      this.adapter,
      this.scorer,
      this.baseRanker,
      this.fixture,
      this.hand,
      this.allConfigs,
      this.timeLimitMs,
      this.nodeBudget,
      { dfsRanker: this.graphRanker },
    );

    const novelty = Math.max(0, result.nodesExplored - (result.transpositionHits ?? 0));
    const terminalBonus = result.terminationReason === 'completed' ? 1 : 0;
    const partialGoals = result.breakdown.goalMatchPoints;
    const explorationScore = result.explorationScore;
    const matched = result.matched;

    const fw = this.fitnessWeights;
    const fitness = fw.alphaMatchedSq * matched * matched
      + fw.betaExplorationScore * explorationScore
      + fw.gammaNovelty * novelty
      + fw.epsilonTerminalBonus * terminalBonus;

    return {
      fitness,
      signals: {
        matched,
        matchedTotal: result.matchedTotal,
        partialGoals,
        novelty,
        terminalBonus,
        interruptionScore: result.breakdown.interruptionScore,
        explorationScore,
        nodesExplored: result.nodesExplored,
        wallMs: result.wallMs,
        terminationReason: result.terminationReason,
      },
    };
  }
}
