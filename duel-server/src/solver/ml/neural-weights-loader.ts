// =============================================================================
// neural-weights-loader.ts — Phase B (graph-ml-v2) trained weights loader.
//
// Mutually exclusive with `SOLVER_USE_TUNED_WEIGHTS=1` (graph-ml-v1) — the
// harness picks neural over graph when both are set.
// =============================================================================

import { createWeightLoader } from './weight-loader-base.js';
import { validateFeatureSpec, type NeuralWeights } from './neural-ranker.js';

export const loadNeuralWeightsIfEnabled = createWeightLoader<NeuralWeights>({
  loaderName: 'neural',
  envEnableVar: 'SOLVER_USE_NEURAL_WEIGHTS',
  envFileVar: 'SOLVER_NEURAL_WEIGHTS_FILE',
  defaultBasename: 'neural-tier-a-latest',
  weightsSubdir: 'trained-weights',
  validate: (raw) => {
    const w = raw as NeuralWeights;
    validateFeatureSpec(w);
    return w;
  },
  summarize: (w) => {
    const arch = w.arch.hidden.length === 0 ? 'linear' : `mlp[${w.arch.hidden.join(',')}]`;
    return `loaded ${arch} weights (tier=${w.tier}, bonusScale=${w.params.bonusScale}, ` +
      `seed=${w.metadata?.seed ?? '?'}, gens=${w.metadata?.generations ?? '?'})`;
  },
  traceMetadata: (w) => ({
    arch: w.arch.hidden.length === 0 ? 'linear' : `mlp[${w.arch.hidden.join(',')}]`,
    bonusScale: w.params.bonusScale,
  }),
});
