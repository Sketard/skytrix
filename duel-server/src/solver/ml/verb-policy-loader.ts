// =============================================================================
// verb-policy-loader.ts — Phase 3 Stage 3b verb-class policy loader.
//
// Compatible with neural weights — they fill different roles (value bonus
// vs move-ordering prior) and can stack.
// =============================================================================

import { createWeightLoader } from './weight-loader-base.js';
import { validateVerbPolicyWeights, type VerbPolicyWeights } from './verb-policy.js';

export const loadVerbPolicyIfEnabled = createWeightLoader<VerbPolicyWeights>({
  loaderName: 'verb-policy',
  envEnableVar: 'SOLVER_USE_VERB_POLICY',
  envFileVar: 'SOLVER_VERB_POLICY_FILE',
  defaultBasename: 'verb-policy-latest',
  weightsSubdir: 'policy-weights',
  validate: (raw) => {
    const w = raw as VerbPolicyWeights;
    validateVerbPolicyWeights(w);
    return w;
  },
  summarize: (w) =>
    `loaded ${w.arch} policy (classes=[${w.labelClasses.join(',')}], ` +
    `samples=${w.metadata?.trainingSamples ?? '?'}, ` +
    `cv=${w.metadata?.cvMeanAccuracy?.toFixed(3) ?? '?'})`,
  traceMetadata: (w) => ({
    arch: w.arch,
    classes: w.labelClasses,
  }),
});
