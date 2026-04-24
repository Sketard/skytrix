// =============================================================================
// graph-weights-loader.ts — boot-time loader for graph-ml-v1 trained weights.
//
// Reads `data/trained-weights/<basename>.json` at worker startup, gated on the
// `SOLVER_USE_TUNED_WEIGHTS` env var. Returns `undefined` when disabled or when
// the weights file is missing — the caller (`solver-worker.ts`) then skips
// the `GraphGuidedRanker` wrap and production runs identically to before.
//
// Keep this module free of training-time deps: no fs-heavy persistor import,
// no evolution-strategy code. It is a thin runtime read — schema types come
// from `graph-weights-types.ts` (pure), I/O is stdlib fs.
//
// Roadmap: memory `project_graph_ml_v1_roadmap_2026_04_24.md`.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WEIGHTS_SCHEMA_VERSION,
  type GraphWeights,
} from './graph-weights-types.js';

export interface WeightsLoadOptions {
  /** Absolute `data/` dir (resolved by the worker from its own dirname). */
  dataDir: string;
  /** Filename (without extension) under `data/trained-weights/`.
   *  Default: whatever `SOLVER_TUNED_WEIGHTS_FILE` env var is, else `tier-a-latest`. */
  basename?: string;
}

/** Load trained weights IFF `SOLVER_USE_TUNED_WEIGHTS=1`. Logs a one-liner
 *  on hit / miss so ops can tell at a glance which mode the worker booted in. */
export function loadTunedWeightsIfEnabled(opts: WeightsLoadOptions): GraphWeights | undefined {
  if (process.env['SOLVER_USE_TUNED_WEIGHTS'] !== '1') return undefined;

  const basename = opts.basename
    ?? process.env['SOLVER_TUNED_WEIGHTS_FILE']
    ?? 'tier-a-latest';
  const path = join(opts.dataDir, 'trained-weights', `${basename}.json`);

  if (!existsSync(path)) {
    console.warn(`[graph-weights-loader] SOLVER_USE_TUNED_WEIGHTS=1 but ${path} missing — falling back to untuned`);
    return undefined;
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as GraphWeights;
    if (raw.version !== WEIGHTS_SCHEMA_VERSION) {
      console.warn(`[graph-weights-loader] version mismatch at ${path}: expected ${WEIGHTS_SCHEMA_VERSION}, got ${raw.version} — ignoring`);
      return undefined;
    }
    const edgeCount = Object.keys(raw.edges).length;
    console.warn(`[graph-weights-loader] loaded ${edgeCount} edge weights (tier=${raw.tier}, generations=${raw.metadata.generations}, bestFitness=${raw.metadata.bestFitness.toFixed(3)})`);
    return raw;
  } catch (err) {
    console.warn(`[graph-weights-loader] failed to parse ${path}: ${String(err)} — falling back to untuned`);
    return undefined;
  }
}
