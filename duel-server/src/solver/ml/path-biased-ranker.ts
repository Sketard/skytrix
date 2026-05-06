// =============================================================================
// path-biased-ranker.ts — Levier B (ranker-side path bias) ActionRanker decorator.
//
// Wraps a base ActionRanker (typically RouteAwareRanker or GraphGuidedRanker).
// At each call to `rank()`, boosts actions whose `cardId` is in `pathCardsSet`
// AND whose `cardId` is NOT yet in the current `distinctActivations` set
// (i.e., the action would push the activation journey forward).
//
// Why this differs from path scoring (Levier 3, terminal-side, NULL on
// 2026-05-02): the bonus is applied PER DECISION at rank time, not at the
// terminal. Each SELECT_IDLECMD prompt sees a different `distinctActivations`
// set; the ranker reorders actions every time. The DFS therefore explores
// branches where the path coverage actually grows, instead of being stuck at
// the same locally-best 4-activation terminal regardless of W_path.
//
// Soft-bias additive (same discipline as GraphGuidedRanker, audit 2026-04-25
// F8): `final_score = (N - i) × baseRankScale + pathBonus(action)`. Default
// scale is calibrated so a path-progressing action wins over a non-progressing
// action at the same base position.
//
// Setter pattern: DFS calls `setDistinctActivations(set)` before each rank.
// The set is read-only during the rank call; no per-call mutation. Piscina
// serialises tasks so no concurrency concern.
//
// Default-OFF: `SOLVER_USE_PATH_RANKER=1` to enable. When disabled (or when
// `pathCardsSet` is empty / `distinctActivations` is undefined), behaves
// identically to the wrapped base ranker.
//
// Memo: `_bmad-output/solver-data/path-scoring-pilot-2026-05-02.md` Option B.
// =============================================================================

import type { ActionRanker } from '../solver-strategy.js';
import type { Action, FieldState, PromptType } from '../solver-types.js';
import type { ArchetypeExpertise } from '../strategic-grammar.js';

// Per-position cost for the base ranker's output. Same convention as
// GraphGuidedRanker.DEFAULT_BASE_RANK_SCALE: a 1-position swap costs this
// much, so `pathBonus > baseRankScale` buys roughly 1 swap.
const DEFAULT_BASE_RANK_SCALE = 30;

// Path bonus magnitude. With baseRankScale=30, a path-progressing action
// at base position N+1 outranks a non-path action at position N when
// W_RANK > 30 (baseline). Default 50 leaves a clear margin.
const DEFAULT_W_RANK = 50;

function readNumberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export class PathBiasedRanker implements ActionRanker {
  private readonly base: ActionRanker;
  private pathCardsSet: ReadonlySet<number> = new Set();
  private distinctActivations: ReadonlySet<number> | undefined;
  private readonly baseRankScale: number;
  private readonly wRank: number;

  constructor(base: ActionRanker, opts: { baseRankScale?: number; wRank?: number } = {}) {
    this.base = base;
    this.baseRankScale = opts.baseRankScale !== undefined
      ? opts.baseRankScale
      : readNumberEnv('SOLVER_BASE_RANK_SCALE', DEFAULT_BASE_RANK_SCALE);
    this.wRank = opts.wRank !== undefined
      ? opts.wRank
      : readNumberEnv('SOLVER_PATH_RANKER_W', DEFAULT_W_RANK);
  }

  /** Inject the union of `pathCards` across all loaded archetype expertise.
   *  Called by solver-worker / evaluate-structural after expertise filter. */
  setArchetypeExpertise(list: readonly ArchetypeExpertise[]): void {
    const set = new Set<number>();
    for (const exp of list) {
      if (exp.pathCards) {
        for (const id of exp.pathCards) set.add(id);
      }
    }
    this.pathCardsSet = set;
    // Delegate to inner: when this wrapper is composed over
    // RouteAwareRanker / PolicyGuidedRanker / NeuralFeatureRanker, the
    // inner ranker(s) also need the expertise list for their own logic.
    this.delegateToInner('setArchetypeExpertise', list);
  }

  /** Forward arbitrary per-fixture / per-task setters to the wrapped base
   *  ranker. Critical for composition: instance-of dispatch in callers
   *  (e.g. `evaluate-structural.runFixture` calls `setMainDeck` /
   *  `setExtraDeck` only when `dfsRanker instanceof NeuralFeatureRanker`)
   *  cannot reach an inner ranker through this wrapper. We expose the
   *  inner setters as pass-through methods so the outer wrapper looks
   *  identical to the inner from a setter point of view.
   *
   *  Same pattern as `PolicyGuidedRanker.delegateToInner()`. */
  setMainDeck(ids: readonly number[]): void {
    this.delegateToInner('setMainDeck', ids);
  }
  setExtraDeck(ids: readonly number[]): void {
    this.delegateToInner('setExtraDeck', ids);
  }
  setMetadata(value: unknown): void {
    this.delegateToInner('setMetadata', value);
  }
  setInterruptionTags(value: unknown): void {
    this.delegateToInner('setInterruptionTags', value);
  }
  setInterruptionWeights(value: unknown): void {
    this.delegateToInner('setInterruptionWeights', value);
  }
  setNeuralWeights(value: unknown): void {
    this.delegateToInner('setNeuralWeights', value);
  }
  setVerbPolicyWeights(value: unknown): void {
    this.delegateToInner('setVerbPolicyWeights', value);
  }

  private delegateToInner<T>(method: string, value: T): void {
    const innerAny = this.base as unknown as Record<string, (v: T) => void>;
    const fn = innerAny[method];
    if (typeof fn === 'function') {
      fn.call(this.base, value);
    }
  }

  /** Inject the per-handle live distinct-activations set. DFS calls this
   *  immediately before each `rank()` so the ranker sees the current
   *  cardIds-already-activated context. Pass `undefined` to disable bias
   *  (e.g. when the flag is OFF). */
  setDistinctActivations(set: ReadonlySet<number> | undefined): void {
    this.distinctActivations = set;
  }

  needsState(promptType: PromptType): boolean {
    return this.base.needsState(promptType);
  }

  rank(actions: Action[], state: FieldState): Action[] {
    const baseRanked = this.base.rank(actions, state);
    if (
      baseRanked.length === 0
      || this.pathCardsSet.size === 0
      || this.distinctActivations === undefined
    ) {
      return baseRanked;
    }

    const N = baseRanked.length;
    const keyed = baseRanked.map((a, i) => ({
      a,
      i,
      score: (N - i) * this.baseRankScale + this.pathBonus(a),
    }));
    keyed.sort((x, y) => (y.score - x.score) || (x.i - y.i));
    return keyed.map(k => k.a);
  }

  /** Bonus = wRank if action.cardId ∈ pathCardsSet AND ∉ distinctActivations
   *  AND action would be an effect activation (not a pure summon procedure
   *  / set / attack). Otherwise 0.
   *
   *  Rationale for the `_isEffectActivation` gate: only effect activations
   *  add the cardId to `distinctEffectCardsThisTurn` (see ocgcore-adapter.ts
   *  recordActivation()). Boosting a Normal Summon of a path-card is wrong —
   *  the NS itself doesn't activate the card's effect, so post-action the
   *  path coverage is unchanged. The next-prompt activation IS what should
   *  be biased. Subject to verification via empirical sweep. */
  private pathBonus(action: Action): number {
    if (action.cardId === 0) return 0;
    if (!this.pathCardsSet.has(action.cardId)) return 0;
    if (this.distinctActivations!.has(action.cardId)) return 0;
    if (action._isEffectActivation !== true) return 0;
    return this.wRank;
  }
}
