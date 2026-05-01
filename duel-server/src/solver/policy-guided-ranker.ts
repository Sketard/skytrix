// =============================================================================
// policy-guided-ranker.ts — Phase 3 Stage 3b (Phase 4 policy MVP).
//
// ActionRanker that wraps an inner ranker (typically `NeuralFeatureRanker`
// or `RouteAwareRanker`) and re-orders the inner's output at SELECT_IDLECMD
// using a verb-class policy distribution. Soft-bias contract:
//
//   final_score(action_i) = (N − i) × baseRankScale + biasScale × P(verb_i)
//
// where `i` is the action's position in the inner's ranking and
// `P(verb_i)` is the policy's softmax probability for that action's
// `actionVerb`. Tie-break = stable sort by original index.
//
// Composition over extension: `NeuralFeatureRanker` continues to provide
// value estimation (forward-pass bonus). `PolicyGuidedRanker` adds the
// move-ordering prior on top. Setting `setVerbPolicyWeights(undefined)`
// makes the wrapper a no-op (pure delegation to inner).
//
// Trained offline by `scripts/train-verb-policy.ts` from the Stage 1
// corpus. Loaded at runtime via `loadVerbPolicyIfEnabled` (env-gated).
// =============================================================================

import type { ActionRanker } from './solver-strategy.js';
import type { Action, FieldState, PromptType, InterruptionTag, InterruptionType } from './solver-types.js';
import type { CardMetadataMap } from './card-metadata.js';
import {
  buildFeatureContext,
  extractStateFeatures,
  type FeatureContext,
} from './state-feature-extractor.js';
import { VerbPolicy, type VerbPolicyWeights } from './verb-policy.js';

// =============================================================================
// Config defaults — env-overridable
// =============================================================================

const DEFAULT_BASE_RANK_SCALE = 30;
const DEFAULT_BIAS_SCALE = 100;

function readNumberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// =============================================================================
// PolicyGuidedRanker
// =============================================================================

export class PolicyGuidedRanker implements ActionRanker {
  private readonly inner: ActionRanker;
  private readonly baseRankScale: number;
  private readonly biasScale: number;

  private readonly policy = new VerbPolicy();
  private metadata: CardMetadataMap | undefined;
  private interruptionTags: Record<string, InterruptionTag> | undefined;
  private interruptionWeights: Record<InterruptionType, number> | undefined;
  private mainDeck: readonly number[] = [];
  private extraDeck: readonly number[] = [];
  private context: FeatureContext | undefined;

  /** Cached lookup map verbName → labelIdx, rebuilt on `setVerbPolicyWeights`. */
  private verbToIdx: Map<string, number> = new Map();

  // Tracking — Phase 3 trajectory hooks. Counts forward passes + verb-match
  // distribution to audit "is the policy actually firing on the prompts we
  // expect, and how often does the action set include a known verb?"
  private tracking: {
    forwardPasses: number;
    selectIdleCmdCount: number;
    actionsWithKnownVerb: number;
    actionsWithUnknownVerb: number;
  } | undefined;

  constructor(
    inner: ActionRanker,
    opts: { baseRankScale?: number; biasScale?: number } = {},
  ) {
    this.inner = inner;
    this.baseRankScale = opts.baseRankScale !== undefined
      ? opts.baseRankScale
      : readNumberEnv('SOLVER_POLICY_BASE_RANK_SCALE', DEFAULT_BASE_RANK_SCALE);
    this.biasScale = opts.biasScale !== undefined
      ? opts.biasScale
      : readNumberEnv('SOLVER_POLICY_BIAS_SCALE', DEFAULT_BIAS_SCALE);
  }

  // ---- Configuration setters --------------------------------------------------

  setMetadata(metadata: CardMetadataMap): void {
    this.metadata = metadata;
    this.rebuildContext();
    this.delegateToInner('setMetadata', metadata);
  }

  setInterruptionTags(tags: Record<string, InterruptionTag>): void {
    this.interruptionTags = tags;
    this.rebuildContext();
    this.delegateToInner('setInterruptionTags', tags);
  }

  setInterruptionWeights(weights: Record<InterruptionType, number>): void {
    this.interruptionWeights = weights;
    this.rebuildContext();
    this.delegateToInner('setInterruptionWeights', weights);
  }

  setMainDeck(ids: readonly number[]): void {
    this.mainDeck = ids;
    this.rebuildContext();
    this.delegateToInner('setMainDeck', ids);
  }

  setExtraDeck(ids: readonly number[]): void {
    this.extraDeck = ids;
    this.rebuildContext();
    this.delegateToInner('setExtraDeck', ids);
  }

  /** Forward a setter call to the inner ranker if it has the same method.
   *  Lets PolicyGuidedRanker stand in for NeuralFeatureRanker as the
   *  per-fixture configuration target — callers don't need to know whether
   *  a wrapper is in place. */
  private delegateToInner<T>(method: string, value: T): void {
    const innerAny = this.inner as unknown as Record<string, (v: T) => void>;
    const fn = innerAny[method];
    if (typeof fn === 'function') {
      fn.call(this.inner, value);
    }
  }

  setVerbPolicyWeights(weights: VerbPolicyWeights | undefined): void {
    this.policy.setWeights(weights);
    this.verbToIdx = new Map(
      this.policy.labelClasses().map((c, i) => [c, i]),
    );
  }

  enableTracking(): void {
    this.tracking = {
      forwardPasses: 0,
      selectIdleCmdCount: 0,
      actionsWithKnownVerb: 0,
      actionsWithUnknownVerb: 0,
    };
  }

  disableTracking(): void {
    this.tracking = undefined;
  }

  getTracking(): {
    forwardPasses: number;
    selectIdleCmdCount: number;
    actionsWithKnownVerb: number;
    actionsWithUnknownVerb: number;
  } | undefined {
    return this.tracking ? { ...this.tracking } : undefined;
  }

  // ---- ActionRanker interface ------------------------------------------------

  needsState(promptType: PromptType): boolean {
    if (this.inner.needsState(promptType)) return true;
    // Policy only fires at SELECT_IDLECMD; for other prompts we delegate
    // identity to the inner.
    return promptType === 'SELECT_IDLECMD' && this.policy.isLoaded();
  }

  rank(actions: Action[], state: FieldState): Action[] {
    const baseRanked = this.inner.rank(actions, state);
    if (baseRanked.length === 0) return baseRanked;

    // Soft-bias only at SELECT_IDLECMD — the only prompt the policy was
    // trained on. Other prompts → identity delegation to inner.
    const promptType = baseRanked[0].promptType;
    if (
      promptType !== 'SELECT_IDLECMD' ||
      !this.policy.isLoaded() ||
      !this.context
    ) {
      return baseRanked;
    }

    const stateVec = extractStateFeatures(state, this.context);
    const probs = this.policy.predict(stateVec);

    const N = baseRanked.length;
    if (this.tracking) {
      this.tracking.selectIdleCmdCount++;
      this.tracking.forwardPasses++;
    }

    const keyed = baseRanked.map((a, i) => {
      const verb = a.actionVerb;
      const verbIdx = verb ? this.verbToIdx.get(verb) : undefined;
      const policyProb = verbIdx !== undefined ? probs[verbIdx] : 0;
      if (this.tracking) {
        if (verbIdx !== undefined) this.tracking.actionsWithKnownVerb++;
        else this.tracking.actionsWithUnknownVerb++;
      }
      return {
        a,
        i,
        score: (N - i) * this.baseRankScale + this.biasScale * policyProb,
      };
    });
    keyed.sort((x, y) => (y.score - x.score) || (x.i - y.i));
    return keyed.map(k => k.a);
  }

  // ---- Internal ---------------------------------------------------------------

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
