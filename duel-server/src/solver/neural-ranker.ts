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

  // Pre-flight linear cache: flatten W1 to a Float64Array(95) for hot-path
  // dot-product. Rebuilt at setNeuralWeights time.
  private linearW: Float64Array | undefined;
  private linearB: number = 0;

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
      this.linearW = undefined;
      this.linearB = 0;
      return;
    }
    validateFeatureSpec(weights);
    this.weights = weights;
    // Pre-flight linear path: flatten W1 to Float64Array. Day 2 MLP would
    // take a different shape — branch on arch.hidden.length when adding.
    if (weights.arch.hidden.length === 0) {
      const w1 = weights.params.W1;
      const flat = new Float64Array(FEATURE_DIM);
      // W1 may be stored as number[] (linear) or number[][] (MLP). Linear
      // accepts both shapes for forward-compat: number[] = direct, number[][]
      // = [[w0,w1,...]] single-row outer wrap.
      if (Array.isArray(w1[0])) {
        const row = (w1 as number[][])[0];
        for (let i = 0; i < FEATURE_DIM; i++) flat[i] = row[i] ?? 0;
      } else {
        const flatArr = w1 as number[];
        for (let i = 0; i < FEATURE_DIM; i++) flat[i] = flatArr[i] ?? 0;
      }
      this.linearW = flat;
      this.linearB = weights.params.b1[0] ?? 0;
    } else {
      // Day 2 MLP: not implemented in Day 1.5 pre-flight. Fail loud.
      throw new Error(
        `[NeuralFeatureRanker] MLP path not implemented in pre-flight (arch.hidden=${JSON.stringify(weights.arch.hidden)}). ` +
        `Day 2 task if pre-flight GO.`,
      );
    }
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
    if (baseRanked.length === 0 || !this.weights || !this.linearW || !this.context) {
      return baseRanked;
    }

    const stateVec = extractStateFeatures(state, this.context);
    const bonusScale = this.weights.params.bonusScale ?? this.defaultBonusScale;
    const N = baseRanked.length;

    const keyed = baseRanked.map((a, i) => {
      const actionVec = extractActionFeatures(a, state, this.context!);
      // Override is_self_turn with action-derived value.
      const stateVecForAction = stateVec.slice();
      stateVecForAction[4] = a.team === 1 ? 0 : 1;
      const score = this.linearForward(stateVecForAction, actionVec);
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

  private linearForward(stateVec: number[], actionVec: number[]): number {
    const w = this.linearW!;
    let sum = this.linearB;
    for (let i = 0; i < STATE_DIM; i++) sum += w[i] * stateVec[i];
    for (let j = 0; j < ACTION_DIM; j++) sum += w[STATE_DIM + j] * actionVec[j];
    return sum;
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
