// =============================================================================
// graph-weights-loader.ts — boot-time loader for graph-ml-v1 trained weights.
//
// Roadmap: memory `project_graph_ml_v1_roadmap_2026_04_24.md`.
// =============================================================================

import { createWeightLoader } from './weight-loader-base.js';
import { WEIGHTS_SCHEMA_VERSION, type GraphWeights } from './graph-weights-types.js';

export const loadTunedWeightsIfEnabled = createWeightLoader<GraphWeights>({
  loaderName: 'graph',
  envEnableVar: 'SOLVER_USE_TUNED_WEIGHTS',
  envFileVar: 'SOLVER_TUNED_WEIGHTS_FILE',
  defaultBasename: 'tier-a-latest',
  weightsSubdir: 'trained-weights',
  validate: (raw) => {
    const w = raw as GraphWeights;
    if (w.version !== WEIGHTS_SCHEMA_VERSION) {
      throw new Error(
        `[graph-weights-loader] version mismatch: expected ${WEIGHTS_SCHEMA_VERSION}, got ${w.version}`,
      );
    }
    return w;
  },
  summarize: (w) => {
    const edgeCount = Object.keys(w.edges).length;
    return `loaded ${edgeCount} edge weights (tier=${w.tier}, ` +
      `generations=${w.metadata.generations}, bestFitness=${w.metadata.bestFitness.toFixed(3)})`;
  },
  traceMetadata: (w) => ({
    edgeCount: Object.keys(w.edges).length,
    tier: w.tier,
    bestFitness: w.metadata.bestFitness,
  }),
});

// Re-export the options type for back-compat with callers that import it.
export type { WeightsLoadOptions } from './weight-loader-base.js';
