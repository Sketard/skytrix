// =============================================================================
// weight-persistor.ts — JSON I/O for graph-guided ranker weights.
//
// Part of graph-ml-v1 research pipeline (M1). See memory roadmap
// `project_graph_ml_v1_roadmap_2026_04_24.md`.
//
// Schema types live in `src/solver/graph-weights-types.ts` (importable by the
// runtime ranker without violating tsc rootDir). This file adds fs-dependent
// I/O on top — training-time persistor + checkpoint save + vector pack/unpack
// for evolution-strategy consumption.
// =============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  WEIGHTS_SCHEMA_VERSION,
  type EdgeId,
  type EdgesFile,
  type GraphWeights,
  type Tier,
} from '../../src/solver/graph-weights-types.js';

// Re-export schema types so training-side callers have one import path.
export {
  WEIGHTS_SCHEMA_VERSION,
  edgeIdFromEdge,
  parseFromCardId,
} from '../../src/solver/graph-weights-types.js';
export type {
  EdgeId,
  EdgeEndpoint,
  Edge,
  EdgesFile,
  Tier,
  WeightsMetadata,
  GraphWeights,
} from '../../src/solver/graph-weights-types.js';

// -----------------------------------------------------------------------------
// Edges file loader
// -----------------------------------------------------------------------------

export function loadEdges(path: string): EdgesFile {
  const data = JSON.parse(readFileSync(path, 'utf-8')) as EdgesFile;
  if (!Array.isArray(data.edges)) throw new Error(`[weight-persistor] malformed edges file at ${path}`);
  return data;
}

// -----------------------------------------------------------------------------
// Factories
// -----------------------------------------------------------------------------

/** Build an untrained GraphWeights with every edge initialized to `initValue`. */
export function initWeights(
  edgeIds: readonly EdgeId[],
  tier: Tier,
  initValue = 0,
  fixturesUsed: readonly string[] = [],
): GraphWeights {
  const edges: Record<EdgeId, number> = {};
  for (const id of edgeIds) edges[id] = initValue;
  return {
    version: WEIGHTS_SCHEMA_VERSION,
    tier,
    edges,
    metadata: {
      trainedAt: new Date().toISOString(),
      generations: 0,
      bestFitness: 0,
      fixturesUsed,
      archetypes: [],
      sigmaFinal: 0,
    },
  };
}

// -----------------------------------------------------------------------------
// I/O
// -----------------------------------------------------------------------------

export function saveWeights(path: string, weights: GraphWeights): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(weights, null, 2), 'utf-8');
}

export function loadWeights(path: string): GraphWeights {
  if (!existsSync(path)) throw new Error(`[weight-persistor] no weights at ${path}`);
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as GraphWeights;
  if (raw.version !== WEIGHTS_SCHEMA_VERSION) {
    throw new Error(`[weight-persistor] version mismatch at ${path}: expected ${WEIGHTS_SCHEMA_VERSION}, got ${raw.version}`);
  }
  return raw;
}

export function tryLoadWeights(path: string): GraphWeights | undefined {
  if (!existsSync(path)) return undefined;
  return loadWeights(path);
}

/** Save a timestamped checkpoint next to the "latest" weights file. Keeps the
 *  training history traceable without re-training. */
export function saveCheckpoint(weightsDir: string, weights: GraphWeights): string {
  const stamp = weights.metadata.trainedAt.replace(/[:.]/g, '-');
  const path = join(weightsDir, 'checkpoints', `${weights.tier}-${stamp}.json`);
  saveWeights(path, weights);
  return path;
}

// -----------------------------------------------------------------------------
// Vector <-> weights conversion (for use by evolution-strategy)
// -----------------------------------------------------------------------------

/** Stable ordering of edge ids. Use consistently across pack/unpack so the
 *  vector[i] ↔ edgeIds[i] mapping is deterministic between runs.
 *
 *  Robust to graph evolution: if edges-all.json regenerates with new EdgeIds,
 *  existing weights for surviving EdgeIds are preserved (via initFromWeights
 *  below). New EdgeIds initialize at 0 and start training from neutral. */
export function orderedEdgeIds(weights: GraphWeights): EdgeId[] {
  return Object.keys(weights.edges).sort();
}

export function packToVector(weights: GraphWeights): number[] {
  return orderedEdgeIds(weights).map(id => weights.edges[id]);
}

export function unpackFromVector(
  template: GraphWeights,
  vector: readonly number[],
): GraphWeights {
  const ids = orderedEdgeIds(template);
  if (ids.length !== vector.length) {
    throw new Error(`[weight-persistor] vector length ${vector.length} ≠ edges ${ids.length}`);
  }
  const edges: Record<EdgeId, number> = {};
  for (let i = 0; i < ids.length; i++) edges[ids[i]] = vector[i];
  return { ...template, edges };
}

/** Merge an existing weights file with a fresh edges set — preserves learned
 *  weights for surviving EdgeIds, initializes new EdgeIds to 0, drops orphan
 *  weights for edges that no longer exist. This is the graph-evolution
 *  migration helper: run it after regenerating `edges-all.json` to carry
 *  over prior training safely. */
export function migrateWeightsToEdgeSet(
  prior: GraphWeights,
  currentEdgeIds: readonly EdgeId[],
): GraphWeights {
  const edges: Record<EdgeId, number> = {};
  let carriedOver = 0;
  let newlyAdded = 0;
  for (const id of currentEdgeIds) {
    if (id in prior.edges) {
      edges[id] = prior.edges[id];
      carriedOver++;
    } else {
      edges[id] = 0;
      newlyAdded++;
    }
  }
  const droppedOrphans = Object.keys(prior.edges).filter(id => !currentEdgeIds.includes(id)).length;
  return {
    ...prior,
    edges,
    metadata: {
      ...prior.metadata,
      notes: [
        prior.metadata.notes ?? '',
        `migration ${new Date().toISOString()}: carried=${carriedOver} added=${newlyAdded} dropped=${droppedOrphans}`,
      ].filter(Boolean).join(' | '),
    },
  };
}
