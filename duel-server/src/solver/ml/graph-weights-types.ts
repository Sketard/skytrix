// =============================================================================
// graph-weights-types.ts — schema for graph-guided ranker weights.
//
// Pure types only — no I/O, no fs dependency. Shared by:
//   - src/solver/graph-guided-ranker.ts (runtime consumer)
//   - src/solver/graph-weights-loader.ts (boot-time loader)
//   - scripts/lib/weight-persistor.ts (training-time persistor + checkpoint I/O)
//
// Part of graph-ml-v1. See memory roadmap
// `project_graph_ml_v1_roadmap_2026_04_24.md`.
// =============================================================================

/** Canonical, deterministic edge id: "<fromCard>.<fromEffect>-><toCard>.<toEffect>".
 *  Stable across regenerations because cardId + effectId are stable in catalogs.
 *  The format is parsed by `GraphGuidedRanker` via string split. */
export type EdgeId = string;

/** An edge endpoint (card + specific effect within it). */
export interface EdgeEndpoint {
  cardId: number;
  name: string;
  effectId: string;
}

/** One edge in the mechanical dependency graph.
 *  Matches the output of `scripts/enumerate-edges.ts --json=<path>`. */
export interface Edge {
  from: EdgeEndpoint;
  to: EdgeEndpoint;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: readonly string[];
}

/** Top-level structure of the edges JSON produced by `enumerate-edges.ts`. */
export interface EdgesFile {
  generatedAt: string;
  cardCount: number;
  cardProperties: Record<string, unknown>;
  edges: readonly Edge[];
}

/** Weight tier bands — matches bridge-validator tier naming. */
export type Tier = 'A' | 'B' | 'C' | 'A+B' | 'A+B+C' | 'full';

export interface WeightsMetadata {
  /** ISO timestamp of the run that produced these weights. */
  trainedAt: string;
  /** Generations completed. 0 means "initial/untrained". */
  generations: number;
  /** Best fitness observed during training (per the fitness-evaluator's composite reward). */
  bestFitness: number;
  /** Fixtures used during training (fixture IDs). */
  fixturesUsed: readonly string[];
  /** Archetypes represented (for MAP-Elites cell bookkeeping; empty in M1). */
  archetypes: readonly string[];
  /** Evolution-strategy step-size σ at convergence. */
  sigmaFinal: number;
  /** Free-form notes / findings from this run. */
  notes?: string;
}

/** Learned weight vector over graph edges. Missing edges imply weight = 0
 *  (neutral at runtime). This tolerance makes the schema ROBUST to graph
 *  evolution: regenerating `edges-all.json` with added cards / new patterns
 *  simply adds fresh EdgeIds that default to 0 until training picks them up. */
export interface GraphWeights {
  /** Schema version — bump on breaking changes. */
  version: string;
  /** Tier band this weight vector covers. */
  tier: Tier;
  /** Edge id → weight. */
  edges: Record<EdgeId, number>;
  metadata: WeightsMetadata;
}

export const WEIGHTS_SCHEMA_VERSION = 'v1';

/** Build a deterministic EdgeId from an Edge. Two edges with identical
 *  endpoints produce the same id, regardless of their order of emission. */
export function edgeIdFromEdge(edge: Edge): EdgeId {
  return `${edge.from.cardId}.${edge.from.effectId}->${edge.to.cardId}.${edge.to.effectId}`;
}

/** Extract the "from card id" from a canonical EdgeId. Used by the runtime
 *  ranker to index outgoing edges per-card. Returns `undefined` for malformed ids. */
export function parseFromCardId(edgeId: EdgeId): number | undefined {
  const arrow = edgeId.indexOf('->');
  if (arrow < 0) return undefined;
  const fromPart = edgeId.slice(0, arrow);
  const dot = fromPart.indexOf('.');
  if (dot < 0) return undefined;
  const n = Number(fromPart.slice(0, dot));
  return Number.isFinite(n) ? n : undefined;
}
