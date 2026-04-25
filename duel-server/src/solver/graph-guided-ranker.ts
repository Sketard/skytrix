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
// SCALE is tunable in M1. Default 100 lets a trained weight of +3 on a single
// outgoing edge produce a +300 bump — same order as RouteAwareRanker next-step.
// -----------------------------------------------------------------------------
const DEFAULT_GRAPH_SCALE = 100;

export class GraphGuidedRanker implements ActionRanker {
  private readonly base: ActionRanker;
  private weights: GraphWeights | undefined;
  /** Pre-computed `cardId → list of outgoing edgeIds` cache built at setWeights. */
  private outgoingByCard: Map<number, EdgeId[]> = new Map();
  private readonly scale: number;

  constructor(base: ActionRanker, opts: { scale?: number } = {}) {
    this.base = base;
    // SCALE precedence : explicit opts.scale > SOLVER_GRAPH_SCALE env var
    // > DEFAULT_GRAPH_SCALE. Env override lets calibration sweeps run
    // multiple values without rebuilding.
    if (opts.scale !== undefined) {
      this.scale = opts.scale;
    } else {
      const envScale = process.env['SOLVER_GRAPH_SCALE'];
      const parsed = envScale ? Number(envScale) : NaN;
      this.scale = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GRAPH_SCALE;
    }
  }

  /** Replace the active weight map. Clears the outgoing-by-card cache.
   *  Pass `undefined` to disable graph guidance (falls back to base ranker). */
  setWeights(weights: GraphWeights | undefined): void {
    this.weights = weights;
    this.outgoingByCard = buildOutgoingCache(weights);
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

    const keyed = baseRanked.map((a, i) => ({
      a,
      i,
      bonus: this.graphBonus(a),
    }));
    // Sort by bonus desc, base-order asc (stable tie-break preserving base semantics).
    keyed.sort((x, y) => (y.bonus - x.bonus) || (x.i - y.i));
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
    return sum * this.scale;
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
