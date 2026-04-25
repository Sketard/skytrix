// =============================================================================
// graph-guided-ranker.ts — graph-ml-v1 ActionRanker (M1).
//
// Plug-in ranker that biases action ordering using a learned weight map over
// effect-level edges of the mechanical dependency graph (see
// `_bmad-output/solver-data/card-effects-catalog/` and `enumerate-edges.ts`).
//
// M1 scope: coarse card-level action matching (action.cardId → outgoing edges
// of that card, summed). Effect-level matching (cardId.effectId → specific
// outgoing edges) is an M2/M3 refinement.
//
// When no weights are configured (e.g., production boot without a trained
// weights.json), behaves identically to the wrapped base ranker. This lets
// `solver-worker.ts` swap RouteAwareRanker → GraphGuidedRanker without
// regression while the research pipeline matures.
//
// Roadmap context: memory `project_graph_ml_v1_roadmap_2026_04_24.md`.
// =============================================================================

import type { ActionRanker } from './solver-strategy.js';
import type { Action, FieldState, PromptType } from './solver-types.js';
import { parseFromCardId, type EdgeId, type GraphWeights } from './graph-weights-types.js';

// -----------------------------------------------------------------------------
// Bonus scale — determines how strongly graph weights influence ranking.
//
// Base ranker (GoldfishChainRanker) produces scores in [0, ~100] range.
// RouteAwareRanker adds up to +540 (goal baseline 18 × 30 next-step bonus).
// Graph weights can be any real number (learned by evolution strategy), but
// we normalize the sum-of-edges contribution so a fully-aligned action gets
// a comparable bump to RouteAwareRanker's +300-500 range.
//
// SCALE is tunable. Default 100 lets a trained weight of +3 on a single
// outgoing edge produce a +300 bump — same order as RouteAwareRanker next-step.
// -----------------------------------------------------------------------------
const DEFAULT_GRAPH_SCALE = 100;

// -----------------------------------------------------------------------------
// Base-rank scale — soft-bias additive (audit 2026-04-25 F8).
//
// Prior `rank()` implementation hard-flipped: sorted by `graphBonus desc` with
// base order as tie-break, so ANY non-zero bonus completely overrode the base
// ranker's carefully-tuned scoring. This is empirically catastrophic when the
// trained weights are sub-optimal — we observed branded-dracotail trained
// weights regressing the same fixture from 4/8 to 0/8 matched in eval-prod
// because the trained ordering was systematically worse than the base ranker.
//
// Soft-bias additive replaces the hard sort with:
//   final_score = (N - i) × baseRankScale + graphBonus(action)
// where i is the action's position in the base ranker's output. This means
// the base ranker's order is preserved unless the graph bonus exceeds the
// per-position cost — small bonuses become nudges instead of vetoes.
//
// Default 30 means: 1-position swap costs 30 score units, while a typical
// trained-weight bonus (one edge × weight 0.3 × scale 100 = 30) buys roughly
// 1 swap. Calibrated so weights need to be confidently positive to reorder.
//
// Set baseRankScale = 0 (or `SOLVER_BASE_RANK_SCALE=0`) to recover the prior
// hard-flip behavior — useful for A/B comparison. Set very large (e.g. 1000)
// to make the graph bonus near-no-op; useful for sanity checks during retraining.
// -----------------------------------------------------------------------------
const DEFAULT_BASE_RANK_SCALE = 30;

function readNumberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Per-edge usage record collected when tracking is enabled.
 *  - `hits` counts how many times this edge contributed to a `graphBonus`
 *    computation (i.e., how many ranking decisions touched it).
 *  - `cumulativeContribution` sums `weight * scale` across those hits — the
 *    total score the edge injected into ranking. Use to surface "edges that
 *    actually mattered" for a given fixture's DFS run. */
export interface EdgeUsageRecord {
  hits: number;
  cumulativeContribution: number;
}

export interface RankerTrackingDump {
  scale: number;
  weightsTier: string | null;
  edgesEvaluated: number;
  /** Distinct cardIds the ranker scored a graphBonus for (= cards encountered
   *  as Action.cardId during the run). Useful to know which subgraph DFS
   *  actually touched. */
  cardsTouched: number[];
  byEdgeId: Record<EdgeId, EdgeUsageRecord & { weight: number }>;
}

export class GraphGuidedRanker implements ActionRanker {
  private readonly base: ActionRanker;
  private weights: GraphWeights | undefined;
  /** Pre-computed `cardId → list of outgoing edgeIds` cache built at setWeights. */
  private outgoingByCard: Map<number, EdgeId[]> = new Map();
  private readonly scale: number;
  /** Per-position score for the base ranker's output. See DEFAULT_BASE_RANK_SCALE. */
  private readonly baseRankScale: number;
  /** When non-undefined, every `graphBonus` call accumulates per-edge usage
   *  here. Set via `enableTracking()`; cleared via `disableTracking()`. */
  private tracking: Map<EdgeId, EdgeUsageRecord> | undefined;
  private cardsTouched: Set<number> | undefined;

  constructor(base: ActionRanker, opts: { scale?: number; baseRankScale?: number } = {}) {
    this.base = base;
    // SCALE precedence : explicit opts > env var > default. Env overrides let
    // calibration sweeps run multiple values without rebuilding.
    if (opts.scale !== undefined) {
      this.scale = opts.scale;
    } else {
      const envScale = process.env['SOLVER_GRAPH_SCALE'];
      const parsed = envScale ? Number(envScale) : NaN;
      this.scale = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GRAPH_SCALE;
    }
    this.baseRankScale = opts.baseRankScale !== undefined
      ? opts.baseRankScale
      : readNumberEnv('SOLVER_BASE_RANK_SCALE', DEFAULT_BASE_RANK_SCALE);
  }

  /** Replace the active weight map. Clears the outgoing-by-card cache.
   *  Pass `undefined` to disable graph guidance (falls back to base ranker). */
  setWeights(weights: GraphWeights | undefined): void {
    this.weights = weights;
    this.outgoingByCard = buildOutgoingCache(weights);
  }

  /** Begin recording per-edge usage. Call before a fixture's DFS run; pair
   *  with `getTracking()` + `disableTracking()` afterwards. Idempotent: a
   *  second call clears prior state and starts fresh. */
  enableTracking(): void {
    this.tracking = new Map();
    this.cardsTouched = new Set();
  }

  disableTracking(): void {
    this.tracking = undefined;
    this.cardsTouched = undefined;
  }

  /** Snapshot of the current tracking state. Returns `undefined` if tracking
   *  was never enabled. The returned object is safe to JSON-serialize. */
  getTracking(): RankerTrackingDump | undefined {
    if (!this.tracking || !this.cardsTouched) return undefined;
    const byEdgeId: Record<EdgeId, EdgeUsageRecord & { weight: number }> = {};
    for (const [edgeId, rec] of this.tracking) {
      const w = this.weights?.edges[edgeId] ?? 0;
      byEdgeId[edgeId] = { hits: rec.hits, cumulativeContribution: rec.cumulativeContribution, weight: w };
    }
    return {
      scale: this.scale,
      weightsTier: this.weights?.tier ?? null,
      edgesEvaluated: this.tracking.size,
      cardsTouched: Array.from(this.cardsTouched).sort((a, b) => a - b),
      byEdgeId,
    };
  }

  needsState(promptType: PromptType): boolean {
    // Graph bonus is per-action (independent of state). We still require state
    // whenever the base ranker does.
    return this.base.needsState(promptType);
  }

  rank(actions: Action[], state: FieldState): Action[] {
    const baseRanked = this.base.rank(actions, state);
    if (baseRanked.length === 0 || !this.weights || this.outgoingByCard.size === 0) {
      return baseRanked;
    }

    // Soft-bias additive (audit 2026-04-25 F8): preserve base ordering unless
    // graph bonus exceeds the per-position cost. With baseRankScale=0 this
    // degenerates to the prior hard-flip behavior (kept available for A/B).
    const N = baseRanked.length;
    const keyed = baseRanked.map((a, i) => ({
      a,
      i,
      score: (N - i) * this.baseRankScale + this.graphBonus(a),
    }));
    keyed.sort((x, y) => (y.score - x.score) || (x.i - y.i));
    return keyed.map(k => k.a);
  }

  /** Bonus for a given action = sum of weights on outgoing edges from the
   *  action's cardId, times the scale factor. M1 uses card-level aggregation
   *  (all effects of the card lumped). Refine to effectId-level in M2/M3. */
  private graphBonus(action: Action): number {
    if (!this.weights || action.cardId === 0) return 0;
    const outgoing = this.outgoingByCard.get(action.cardId);
    if (!outgoing || outgoing.length === 0) return 0;
    let sum = 0;
    for (const edgeId of outgoing) sum += this.weights.edges[edgeId] ?? 0;
    const total = sum * this.scale;
    if (this.tracking) {
      this.cardsTouched!.add(action.cardId);
      for (const edgeId of outgoing) {
        const w = this.weights.edges[edgeId] ?? 0;
        const rec = this.tracking.get(edgeId);
        if (rec) {
          rec.hits += 1;
          rec.cumulativeContribution += w * this.scale;
        } else {
          this.tracking.set(edgeId, { hits: 1, cumulativeContribution: w * this.scale });
        }
      }
    }
    return total;
  }
}

// -----------------------------------------------------------------------------
// Cache builder — one pass over the weight map keys (edgeIds) at setWeights time.
// EdgeId format (from weight-persistor.edgeIdFromEdge): "<fromCard>.<fromEffect>-><toCard>.<toEffect>"
// Parse the fromCard id for the outgoing index.
// -----------------------------------------------------------------------------

function buildOutgoingCache(weights: GraphWeights | undefined): Map<number, EdgeId[]> {
  const cache = new Map<number, EdgeId[]>();
  if (!weights) return cache;
  for (const edgeId of Object.keys(weights.edges)) {
    const fromCard = parseFromCardId(edgeId);
    if (fromCard === undefined) continue;
    const list = cache.get(fromCard) ?? [];
    list.push(edgeId);
    cache.set(fromCard, list);
  }
  return cache;
}

// `parseFromCardId` is shared via `graph-weights-types.ts` — imported above.
