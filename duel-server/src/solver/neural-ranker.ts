// =============================================================================
// neural-ranker.ts — Phase B (graph-ml-v2) ActionRanker.
//
// Wraps a base ActionRanker (typically RouteAwareRanker → GoldfishChainRanker)
// and adds a soft-bias additive bonus from a small linear/MLP forward pass over
// the deck-agnostic feature vector built by `state-feature-extractor.ts`.
//
// Soft-bias contract (audit 2026-04-25 F8 — same shape as graph-ml-v1):
//
//   final_score(action_i) = (N − i) × baseRankScale + bonusScale × forward(features)
//
// where `i` is the action's position in the base ranker's output. Tie-break
// = stable sort by original index.
//
// Pre-flight scope (Day 1.5):
// - Linear forward pass only (no hidden layer): `score = W1 · features + b1`.
// - 95 weight params + 1 bonusScale + 1 bias = 97 evolved params total.
// - MLP `[95 → 32 → 1]` (3105 weights + 1 bonusScale = 3106) is Day 2+ if GO.
//
// `setNeuralWeights(undefined)` makes `rank()` delegate to base — same fallback
// contract as graph-guided-ranker.ts.
// =============================================================================

import type { ActionRanker } from './solver-strategy.js';
import type { Action, FieldState, PromptType, InterruptionTag, InterruptionType } from './solver-types.js';
import type { CardMetadataMap } from './card-metadata.js';
import {
  STATE_DIM,
  ACTION_DIM,
  FEATURE_DIM,
  STATE_FEATURE_NAMES,
  ACTION_FEATURE_NAMES,
  computeFeatureSpecHash,
  extractStateFeatures,
  extractActionFeatures,
  buildFeatureContext,
  type FeatureContext,
} from './state-feature-extractor.js';

// =============================================================================
// Config defaults — env-overridable
// =============================================================================

const DEFAULT_BASE_RANK_SCALE = 30;
const DEFAULT_BONUS_SCALE = 100;

function readNumberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// =============================================================================
// Weights schema
// =============================================================================

/** Linear pre-flight weights. Day 2 MLP variant adds W2/b2 (and changes
 *  inputDim shape on W1) — gated by `arch.hidden.length`. */
export interface NeuralWeights {
  version: 'neural-v1';
  tier: string;
  arch: {
    inputDim: number;            // = FEATURE_DIM (95)
    hidden: number[];            // [] for linear; [32] for Day-2 MLP
    activation: 'relu';
  };
  featureSpec: {
    stateFeatures: readonly string[];
    actionFeatures: readonly string[];
  };
  /** sha256 of the ordered concat of state + action feature names. Loader
   *  hard-fails on mismatch to prevent silent feature-spec drift between
   *  training and runtime. */
  featureSpecHash: string;
  params: {
    /** Pre-flight (linear): shape [95]. Day-2 MLP: shape [95 × 32]. */
    W1: number[] | number[][];
    /** Pre-flight: scalar [1]. Day-2: shape [32]. */
    b1: number[];
    /** Day-2 only. */
    W2?: number[][];
    b2?: number[];
    /** Evolved scalar (init=100, min=30, σ_init=30). */
    bonusScale: number;
  };
  metadata?: {
    trainedAt?: string;
    generations?: number;
    fixturesUsed?: string[];
    seed?: number;
    fitness?: unknown;
    notes?: string;
  };
}

/** Validate that the weights JSON's featureSpecHash matches the current
 *  extractor's hash. Mismatch = explicit error with both hashes printed.
 *  Migration mechanism deferred to Phase 5; for Phase B's single weight-
 *  version, hard-fail is the safest contract. */
export function validateFeatureSpec(weights: NeuralWeights): void {
  const expected = computeFeatureSpecHash();
  if (weights.featureSpecHash !== expected) {
    throw new Error(
      `[NeuralFeatureRanker] featureSpecHash mismatch:\n` +
      `  weights JSON: ${weights.featureSpecHash}\n` +
      `  current code: ${expected}\n` +
      `  Feature names drifted between training and runtime — retrain or check ` +
      `state-feature-extractor.ts STATE_FEATURE_NAMES / ACTION_FEATURE_NAMES.`,
    );
  }
  if (weights.arch.inputDim !== FEATURE_DIM) {
    throw new Error(
      `[NeuralFeatureRanker] inputDim mismatch: weights ${weights.arch.inputDim}, ` +
      `expected ${FEATURE_DIM}.`,
    );
  }
}

// =============================================================================
// Tracking (Phase 3 trajectory hooks)
// =============================================================================

export interface NeuralRankerTrackingDump {
  weightsTier: string | null;
  /** Number of forward passes computed during the run. */
  forwardPasses: number;
  /** Distinct cardIds the ranker scored (= cards encountered as Action.cardId). */
  cardsTouched: number[];
}

// =============================================================================
// NeuralFeatureRanker
// =============================================================================

export class NeuralFeatureRanker implements ActionRanker {
  private readonly base: ActionRanker;
  private readonly baseRankScale: number;
  private readonly defaultBonusScale: number;

  private weights: NeuralWeights | undefined;
  private metadata: CardMetadataMap | undefined;
  private interruptionTags: Record<string, InterruptionTag> | undefined;
  private interruptionWeights: Record<InterruptionType, number> | undefined;
  private mainDeck: readonly number[] = [];
  private extraDeck: readonly number[] = [];
  private context: FeatureContext | undefined;

  // Forward-pass caches. `hiddenDim === 0` ⇒ linear path
  // (linearW × FEATURE_DIM dot product). `hiddenDim > 0` ⇒ MLP path
  // (W1 × hidden×input → ReLU → W2 × output×hidden). Caches are rebuilt at
  // every `setNeuralWeights` call.
  private hiddenDim = 0;
  // Linear (hidden=[]): linearW is FEATURE_DIM, linearB is the scalar bias.
  private linearW: Float64Array | undefined;
  private linearB = 0;
  // MLP (hidden=[H]): row-major flattened W1 (H × FEATURE_DIM),
  //                   b1 (H),
  //                   W2 (H — single output unit so W2 collapses to a vector),
  //                   b2 (scalar).
  private mlpW1: Float64Array | undefined;
  private mlpB1: Float64Array | undefined;
  private mlpW2: Float64Array | undefined;
  private mlpB2 = 0;
  // Reusable hidden activation buffer; allocated once per setNeuralWeights call.
  private mlpHiddenBuf: Float64Array | undefined;

  // Tracking
  private tracking: { forwardPasses: number; cardsTouched: Set<number> } | undefined;

  constructor(
    base: ActionRanker,
    opts: { baseRankScale?: number; bonusScale?: number } = {},
  ) {
    this.base = base;
    this.baseRankScale = opts.baseRankScale !== undefined
      ? opts.baseRankScale
      : readNumberEnv('SOLVER_BASE_RANK_SCALE', DEFAULT_BASE_RANK_SCALE);
    this.defaultBonusScale = opts.bonusScale !== undefined
      ? opts.bonusScale
      : readNumberEnv('SOLVER_NEURAL_BONUS_SCALE', DEFAULT_BONUS_SCALE);
  }

  // ---- Configuration setters (called per-fixture by the worker) -------------

  setMetadata(metadata: CardMetadataMap): void {
    this.metadata = metadata;
    this.rebuildContext();
  }

  setInterruptionTags(tags: Record<string, InterruptionTag>): void {
    this.interruptionTags = tags;
    this.rebuildContext();
  }

  setInterruptionWeights(weights: Record<InterruptionType, number>): void {
    this.interruptionWeights = weights;
    this.rebuildContext();
  }

  setMainDeck(ids: readonly number[]): void {
    this.mainDeck = ids;
    this.rebuildContext();
  }

  setExtraDeck(ids: readonly number[]): void {
    this.extraDeck = ids;
    this.rebuildContext();
  }

  setNeuralWeights(weights: NeuralWeights | undefined): void {
    if (!weights) {
      this.weights = undefined;
      this.hiddenDim = 0;
      this.linearW = undefined;
      this.linearB = 0;
      this.mlpW1 = undefined;
      this.mlpB1 = undefined;
      this.mlpW2 = undefined;
      this.mlpB2 = 0;
      this.mlpHiddenBuf = undefined;
      return;
    }
    validateFeatureSpec(weights);
    this.weights = weights;

    if (weights.arch.hidden.length === 0) {
      // Linear: W1 is FEATURE_DIM weights, b1 is a 1-entry bias.
      const w1 = weights.params.W1;
      const flat = new Float64Array(FEATURE_DIM);
      // W1 accepts number[] or number[][] (single-row outer wrap) for
      // forward-compat with hand-authored JSONs.
      if (Array.isArray(w1[0])) {
        const row = (w1 as number[][])[0];
        for (let i = 0; i < FEATURE_DIM; i++) flat[i] = row[i] ?? 0;
      } else {
        const flatArr = w1 as number[];
        for (let i = 0; i < FEATURE_DIM; i++) flat[i] = flatArr[i] ?? 0;
      }
      this.hiddenDim = 0;
      this.linearW = flat;
      this.linearB = weights.params.b1[0] ?? 0;
      this.mlpW1 = undefined;
      this.mlpB1 = undefined;
      this.mlpW2 = undefined;
      this.mlpB2 = 0;
      this.mlpHiddenBuf = undefined;
      return;
    }

    if (weights.arch.hidden.length !== 1) {
      throw new Error(
        `[NeuralFeatureRanker] Only 1-hidden-layer MLPs supported (arch.hidden=${JSON.stringify(weights.arch.hidden)}). ` +
        `Multi-hidden architectures are deferred — see design doc §6 ablation #3.`,
      );
    }
    const H = weights.arch.hidden[0];
    if (!Number.isInteger(H) || H <= 0) {
      throw new Error(`[NeuralFeatureRanker] Invalid hidden dim ${H} (must be positive integer)`);
    }
    if (weights.arch.activation !== 'relu') {
      throw new Error(`[NeuralFeatureRanker] Only ReLU activation supported (got '${weights.arch.activation}')`);
    }

    // MLP shape: W1 [H × FEATURE_DIM], b1 [H], W2 [1 × H], b2 [1].
    const w1Raw = weights.params.W1;
    const b1Raw = weights.params.b1;
    const w2Raw = weights.params.W2;
    const b2Raw = weights.params.b2;
    if (!Array.isArray(w1Raw) || !Array.isArray(b1Raw)) {
      throw new Error(`[NeuralFeatureRanker] MLP requires W1 and b1 in params`);
    }
    if (!Array.isArray(w2Raw) || !Array.isArray(b2Raw)) {
      throw new Error(`[NeuralFeatureRanker] MLP requires W2 and b2 in params`);
    }
    if (b1Raw.length !== H) {
      throw new Error(`[NeuralFeatureRanker] b1 length ${b1Raw.length} != hidden ${H}`);
    }
    if (b2Raw.length !== 1) {
      throw new Error(`[NeuralFeatureRanker] b2 length ${b2Raw.length} != 1`);
    }

    const w1Flat = new Float64Array(H * FEATURE_DIM);
    if (!Array.isArray(w1Raw[0])) {
      throw new Error(`[NeuralFeatureRanker] MLP W1 must be 2D ([H × FEATURE_DIM]); got 1D length ${w1Raw.length}`);
    }
    const w1Rows = w1Raw as number[][];
    if (w1Rows.length !== H) {
      throw new Error(`[NeuralFeatureRanker] W1 row count ${w1Rows.length} != hidden ${H}`);
    }
    for (let h = 0; h < H; h++) {
      const row = w1Rows[h];
      if (!Array.isArray(row) || row.length !== FEATURE_DIM) {
        throw new Error(`[NeuralFeatureRanker] W1[${h}] length ${row?.length ?? 'NA'} != FEATURE_DIM ${FEATURE_DIM}`);
      }
      for (let i = 0; i < FEATURE_DIM; i++) {
        w1Flat[h * FEATURE_DIM + i] = row[i] ?? 0;
      }
    }

    const w2Flat = new Float64Array(H);
    // W2 shape [1 × H] — accept either [[...H values...]] or [H...] for simplicity.
    const w2Source: number[] = Array.isArray(w2Raw[0])
      ? ((w2Raw as unknown) as number[][])[0]
      : ((w2Raw as unknown) as number[]);
    if (w2Source.length !== H) {
      throw new Error(`[NeuralFeatureRanker] W2 length ${w2Source.length} != hidden ${H}`);
    }
    for (let h = 0; h < H; h++) w2Flat[h] = w2Source[h] ?? 0;

    const b1Flat = new Float64Array(H);
    for (let h = 0; h < H; h++) b1Flat[h] = b1Raw[h] ?? 0;

    this.hiddenDim = H;
    this.linearW = undefined;
    this.linearB = 0;
    this.mlpW1 = w1Flat;
    this.mlpB1 = b1Flat;
    this.mlpW2 = w2Flat;
    this.mlpB2 = b2Raw[0] ?? 0;
    this.mlpHiddenBuf = new Float64Array(H);
  }

  enableTracking(): void {
    this.tracking = { forwardPasses: 0, cardsTouched: new Set() };
  }

  disableTracking(): void {
    this.tracking = undefined;
  }

  getTracking(): NeuralRankerTrackingDump | undefined {
    if (!this.tracking) return undefined;
    return {
      weightsTier: this.weights?.tier ?? null,
      forwardPasses: this.tracking.forwardPasses,
      cardsTouched: Array.from(this.tracking.cardsTouched).sort((a, b) => a - b),
    };
  }

  // ---- ActionRanker interface ----------------------------------------------

  needsState(promptType: PromptType): boolean {
    if (this.base.needsState(promptType)) return true;
    // We need state for any exploratory prompt where neural bonus could
    // matter — i.e., the ones the base ranker also touches. Mirrors
    // RouteAwareRanker's "expand if expertise loaded" semantics.
    return this.weights !== undefined;
  }

  rank(actions: Action[], state: FieldState): Action[] {
    const baseRanked = this.base.rank(actions, state);
    if (baseRanked.length === 0 || !this.weights || !this.context) return baseRanked;
    // Both linear (linearW set) and MLP (mlpW1 set) paths are valid.
    if (!this.linearW && !this.mlpW1) return baseRanked;

    const stateVec = extractStateFeatures(state, this.context);
    const bonusScale = this.weights.params.bonusScale ?? this.defaultBonusScale;
    const N = baseRanked.length;

    const keyed = baseRanked.map((a, i) => {
      const actionVec = extractActionFeatures(a, state, this.context!);
      // Override is_self_turn with action-derived value.
      const stateVecForAction = stateVec.slice();
      stateVecForAction[4] = a.team === 1 ? 0 : 1;
      const score = this.forward(stateVecForAction, actionVec);
      if (this.tracking) {
        this.tracking.forwardPasses++;
        if (a.cardId !== 0) this.tracking.cardsTouched.add(a.cardId);
      }
      return {
        a,
        i,
        score: (N - i) * this.baseRankScale + bonusScale * score,
      };
    });
    keyed.sort((x, y) => (y.score - x.score) || (x.i - y.i));
    return keyed.map(k => k.a);
  }

  // ---- Internal -------------------------------------------------------------

  private forward(stateVec: number[], actionVec: number[]): number {
    return this.hiddenDim === 0
      ? this.linearForward(stateVec, actionVec)
      : this.mlpForward(stateVec, actionVec);
  }

  private linearForward(stateVec: number[], actionVec: number[]): number {
    const w = this.linearW!;
    let sum = this.linearB;
    for (let i = 0; i < STATE_DIM; i++) sum += w[i] * stateVec[i];
    for (let j = 0; j < ACTION_DIM; j++) sum += w[STATE_DIM + j] * actionVec[j];
    return sum;
  }

  /** MLP forward pass: `y = W2 · ReLU(W1·x + b1) + b2`. Hot-path inlined,
   *  no allocations beyond the persistent `mlpHiddenBuf`. ~3 K multiplies
   *  per call at H=32 — negligible vs the WASM duel step. */
  private mlpForward(stateVec: number[], actionVec: number[]): number {
    const H = this.hiddenDim;
    const W1 = this.mlpW1!;
    const b1 = this.mlpB1!;
    const W2 = this.mlpW2!;
    const hidden = this.mlpHiddenBuf!;

    // Hidden layer: h_j = ReLU(sum_i W1[j*FD + i] * x[i] + b1[j]).
    for (let h = 0; h < H; h++) {
      const rowBase = h * FEATURE_DIM;
      let pre = b1[h];
      for (let i = 0; i < STATE_DIM; i++) {
        pre += W1[rowBase + i] * stateVec[i];
      }
      for (let j = 0; j < ACTION_DIM; j++) {
        pre += W1[rowBase + STATE_DIM + j] * actionVec[j];
      }
      hidden[h] = pre > 0 ? pre : 0;  // ReLU
    }

    // Output: y = sum_h W2[h] * hidden[h] + b2.
    let out = this.mlpB2;
    for (let h = 0; h < H; h++) out += W2[h] * hidden[h];
    return out;
  }

  private rebuildContext(): void {
    if (!this.metadata || !this.interruptionTags || !this.interruptionWeights) {
      this.context = undefined;
      return;
    }
    this.context = buildFeatureContext({
      metadata: this.metadata,
      interruptionTags: this.interruptionTags,
      interruptionWeights: this.interruptionWeights,
      mainDeck: this.mainDeck,
      extraDeck: this.extraDeck,
    });
  }
}

// =============================================================================
// Re-exports — convenience for trainers / loaders
// =============================================================================

export { STATE_FEATURE_NAMES, ACTION_FEATURE_NAMES, FEATURE_DIM, computeFeatureSpecHash };
