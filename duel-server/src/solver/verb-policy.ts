// =============================================================================
// verb-policy.ts — Phase 3 Stage 3a (Phase 4 policy MVP).
//
// Pure forward pass for the verb-class policy network. Trained offline by
// `scripts/train-verb-policy.ts` on the Stage 1 trajectory corpus; consumed
// at runtime by `policy-guided-ranker.ts` (Stage 3b) to bias DFS move ordering
// at SELECT_IDLECMD.
//
// Architecture (Stage 3a baseline): logistic regression
//   logits[c] = b[c] + sum_i W[c][i] * stateVec[i]
//   probs     = softmax(logits)
//
// 58 state features → 5 verb classes (or however many the trainer detected).
// 295 weight params + 5 biases = 300 total. Training set = 35 SELECT_IDLECMD
// samples from MLP-v3-sd7 corpus.
//
// Hard constraints (mirrors neural-ranker.ts):
// - `featureSpecHash` validated at load time. Mismatch = explicit error,
//   prevents silent feature-spec drift between trainer and runtime.
// - `stateDim` validated against current `STATE_DIM`.
// - `setWeights(undefined)` makes `predict()` return uniform — same fallback
//   contract as neural-ranker.
// =============================================================================

import {
  STATE_DIM,
  STATE_FEATURE_NAMES,
  computeFeatureSpecHash,
} from './state-feature-extractor.js';

// =============================================================================
// Weights schema
// =============================================================================

export interface VerbPolicyWeights {
  version: 'verb-policy-v1';
  /** 'lr' = logistic regression (Stage 3a baseline). Future: 'mlp:H'. */
  arch: 'lr';
  /** sha256 of state feature names — must match runtime extractor. */
  featureSpecHash: string;
  stateDim: number;
  /** Verb names IN OUTPUT ORDER. Index = output-row index. Stable across
   *  training runs for the same training-set composition. */
  labelClasses: string[];
  params: {
    /** [K × stateDim] row-major. */
    W: number[][];
    /** [K] biases. */
    b: number[];
  };
  metadata?: {
    trainedAt?: string;
    trainingSamples?: number;
    perClassTrainingCounts?: Record<string, number>;
    cvMeanAccuracy?: number;
    cvFolds?: number;
    notes?: string;
  };
}

// =============================================================================
// Validation
// =============================================================================

export function validateVerbPolicyWeights(w: VerbPolicyWeights): void {
  if (w.version !== 'verb-policy-v1') {
    throw new Error(`[VerbPolicy] unsupported version: ${w.version}`);
  }
  if (w.arch !== 'lr') {
    throw new Error(`[VerbPolicy] unsupported arch: ${w.arch}`);
  }
  const expected = computeFeatureSpecHash();
  if (w.featureSpecHash !== expected) {
    throw new Error(
      `[VerbPolicy] featureSpecHash mismatch:\n` +
      `  weights JSON: ${w.featureSpecHash}\n` +
      `  current code: ${expected}\n` +
      `Retrain policy or check STATE_FEATURE_NAMES.`,
    );
  }
  if (w.stateDim !== STATE_DIM) {
    throw new Error(`[VerbPolicy] stateDim mismatch: weights ${w.stateDim}, code ${STATE_DIM}`);
  }
  if (!Array.isArray(w.params.W) || !Array.isArray(w.params.b)) {
    throw new Error('[VerbPolicy] params.W and params.b must be arrays');
  }
  const K = w.labelClasses.length;
  if (w.params.W.length !== K) {
    throw new Error(`[VerbPolicy] W rows ${w.params.W.length} != K ${K}`);
  }
  if (w.params.b.length !== K) {
    throw new Error(`[VerbPolicy] b length ${w.params.b.length} != K ${K}`);
  }
  for (let c = 0; c < K; c++) {
    const row = w.params.W[c];
    if (!Array.isArray(row) || row.length !== STATE_DIM) {
      throw new Error(`[VerbPolicy] W[${c}] length ${row?.length ?? 'NA'} != STATE_DIM ${STATE_DIM}`);
    }
  }
}

// =============================================================================
// VerbPolicy
// =============================================================================

export class VerbPolicy {
  private weights: VerbPolicyWeights | undefined;
  /** Flattened W [K × STATE_DIM] for cache-friendly forward pass. */
  private wFlat: Float64Array | undefined;
  private bFlat: Float64Array | undefined;
  private K = 0;

  setWeights(w: VerbPolicyWeights | undefined): void {
    if (!w) {
      this.weights = undefined;
      this.wFlat = undefined;
      this.bFlat = undefined;
      this.K = 0;
      return;
    }
    validateVerbPolicyWeights(w);
    const K = w.labelClasses.length;
    const flat = new Float64Array(K * STATE_DIM);
    for (let c = 0; c < K; c++) {
      for (let i = 0; i < STATE_DIM; i++) {
        flat[c * STATE_DIM + i] = w.params.W[c][i];
      }
    }
    const bFlat = new Float64Array(K);
    for (let c = 0; c < K; c++) bFlat[c] = w.params.b[c];
    this.weights = w;
    this.wFlat = flat;
    this.bFlat = bFlat;
    this.K = K;
  }

  isLoaded(): boolean {
    return this.weights !== undefined;
  }

  /** Verb class names in output order. Empty if no weights loaded. */
  labelClasses(): readonly string[] {
    return this.weights?.labelClasses ?? [];
  }

  /** Returns softmax probabilities over `labelClasses()` for the given state.
   *  When no weights are loaded, returns an empty array — caller MUST gate
   *  on `isLoaded()` first. */
  predict(stateVec: readonly number[]): Float64Array {
    if (!this.wFlat || !this.bFlat) return new Float64Array(0);
    if (stateVec.length !== STATE_DIM) {
      throw new Error(`[VerbPolicy] stateVec length ${stateVec.length} != STATE_DIM ${STATE_DIM}`);
    }
    const K = this.K;
    const W = this.wFlat;
    const b = this.bFlat;
    const logits = new Float64Array(K);

    let maxLogit = -Infinity;
    for (let c = 0; c < K; c++) {
      let sum = b[c];
      const rowBase = c * STATE_DIM;
      for (let i = 0; i < STATE_DIM; i++) {
        sum += W[rowBase + i] * stateVec[i];
      }
      logits[c] = sum;
      if (sum > maxLogit) maxLogit = sum;
    }

    // Numerically stable softmax: subtract max before exp.
    let denom = 0;
    for (let c = 0; c < K; c++) {
      const e = Math.exp(logits[c] - maxLogit);
      logits[c] = e;
      denom += e;
    }
    if (denom === 0) {
      // All zero — fall back to uniform.
      const uniform = 1 / K;
      for (let c = 0; c < K; c++) logits[c] = uniform;
      return logits;
    }
    for (let c = 0; c < K; c++) logits[c] /= denom;
    return logits;
  }

  /** Convenience: returns the verb name with the highest probability, or
   *  undefined if no weights loaded. */
  predictTopVerb(stateVec: readonly number[]): { verb: string; prob: number } | undefined {
    if (!this.weights) return undefined;
    const probs = this.predict(stateVec);
    let bestC = 0;
    for (let c = 1; c < probs.length; c++) {
      if (probs[c] > probs[bestC]) bestC = c;
    }
    return { verb: this.weights.labelClasses[bestC], prob: probs[bestC] };
  }
}

// Re-export for trainer consumers (single import point).
export { STATE_DIM, STATE_FEATURE_NAMES, computeFeatureSpecHash };
