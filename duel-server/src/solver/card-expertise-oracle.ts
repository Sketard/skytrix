// =============================================================================
// card-expertise-oracle.ts — Phase 5 deliverable for the prompt-resolver-refactor.
//
// Per-card, per-prompt-type override oracle. Sits at the head of all chain
// compositions (DFS, β-1, β-3) and produces a response when a hint matches
// (sourceCardId, promptType). Otherwise passes — the chain continues to the
// next oracle.
//
// Phase 5 ships the dispatch logic + schema. Phase 6 plumbs sourceCardId
// reliably across prompt types (coverage matrix). Phase 7 populates hints
// for the audited fixtures. Default: `decisionHints` absent → 100% pass-through,
// preserving the bit-exact gate against phase-1-baselines/.
//
// Pass-through guard (refactor design doc §2): if `pendingTargets` /
// `pendingChainTargets` contains an entry that would match the legal pool,
// PASS — the explicit plan target should win over a card hint. This keeps the
// priority order: explicit plan > expertise > mechanical.
// =============================================================================

import { OcgPosition } from '@n1xx1/ocgcore-wasm';
import type { Action, PromptType } from './solver-types.js';
import { EXPLORATORY_PROMPTS } from './solver-types.js';
import type { ArchetypeExpertise, ExpertiseHint } from './strategic-grammar.js';
import { normalizeName } from './plan-replay-oracles.js';
import type { DecisionContext, DecisionOracle, OracleResult } from './prompt-resolver.js';

export class CardExpertiseOracle implements DecisionOracle {
  readonly name = 'CardExpertiseOracle';

  decide(ctx: DecisionContext): OracleResult {
    if (!ctx.expertise || ctx.expertise.length === 0) return { kind: 'pass' };
    if (ctx.sourceCardId === undefined || ctx.sourceCardId === 0) return { kind: 'pass' };

    // DFS exploratory prompts must yield branches, not a card-hint response —
    // the DFS scorer picks among the branches, not the oracle. Skip exploratory
    // prompts on the DFS side. (CLI side has no exploratory branches; β-1's
    // SELECT_IDLECMD goes through PlanStepOracle which is positioned AFTER
    // this oracle, so we let CardExpertise short-circuit only on sub-prompts
    // — the SELECT_IDLECMD path is plan-driven anyway.)
    if (ctx.caller === 'dfs' && EXPLORATORY_PROMPTS.has(ctx.promptType as PromptType)) {
      return { kind: 'pass' };
    }
    if (ctx.caller === 'plan-β1' && ctx.promptType === 'SELECT_IDLECMD') {
      return { kind: 'pass' };
    }
    if (ctx.caller === 'plan-β3' && ctx.promptType === 'SELECT_IDLECMD') {
      // β-3 IDLECMD is raw-driven; let RawTrajectoryOracle win.
      return { kind: 'pass' };
    }

    // Pass-through guard: when a plan target would match, let PlanTargetOracle
    // win. Only relevant for plan-β1 sub-prompts. CHAIN/sub-pickable.
    if (ctx.caller === 'plan-β1' && ctx.legal && ctx.getName) {
      if (pendingTargetWouldMatch(ctx)) return { kind: 'pass' };
    }

    const hint = lookupHint(ctx.expertise, ctx.sourceCardId, ctx.promptType);
    if (!hint) return { kind: 'pass' };

    const result = applyHint(hint, ctx);
    if (!result) return { kind: 'pass' };
    return result;
  }
}

/** Look up `decisionHints[sourceCardId][promptType]` across all loaded
 *  expertise files. Returns the first match; if multiple files have a hint
 *  for the same (cardId, promptType), the first wins (alphabetic file order
 *  per loader). */
function lookupHint(
  expertise: readonly ArchetypeExpertise[],
  sourceCardId: number,
  promptType: string,
): ExpertiseHint | null {
  const key = String(sourceCardId);
  for (const e of expertise) {
    const hintsForCard = e.decisionHints?.[key];
    if (hintsForCard) {
      const hint = hintsForCard[promptType];
      if (hint) return hint;
    }
  }
  return null;
}

function pendingTargetWouldMatch(ctx: DecisionContext): boolean {
  const queue = ctx.promptType === 'SELECT_CHAIN'
    ? ctx.pendingChainTargets
    : ctx.pendingTargets;
  if (!queue || queue.length === 0) return false;
  const t = queue[0];
  const legal = ctx.legal!;
  if (t.responseIndex !== undefined) {
    return legal.some(a => a.responseIndex === t.responseIndex);
  }
  const wanted = (t.cardNames ?? (t.cardName ? [t.cardName] : [])).map(normalizeName);
  if (wanted.length === 0) return false;
  return legal.some(a => {
    const n = normalizeName((a as Action & { cardName?: string }).cardName || ctx.getName!(a.cardId));
    return wanted.some(w => n === w || n.includes(w) || w.includes(n));
  });
}

/** Convert a hint to an OracleResult. Returns null on unknown policy or when
 *  the policy can't apply (e.g. 'preferred' with no matches in legal). */
function applyHint(hint: ExpertiseHint, ctx: DecisionContext): OracleResult | null {
  // Most policies need legal[] to construct the response (we want to return
  // both the response payload AND the chosenAction). If legal is missing,
  // we can still emit the OCG response for caller=DFS (which uses `branches`
  // post-resolve) but the CLI side needs chosenAction.
  const legal = ctx.legal;

  switch (hint.policy) {
    case 'max':
    case 'last': {
      // ANNOUNCE_NUMBER / SELECT_OPTION: pick last index. For SELECT_OPTION,
      // we can use legal[N-1]. For ANNOUNCE_NUMBER (msg-only, no legal entries),
      // we fall back to msg.options.
      if (legal && legal.length > 0) {
        const action = legal[legal.length - 1];
        return responseFromAction(action, ctx);
      }
      const opts = (ctx.msg['options'] as Array<bigint | number> | undefined) ?? [];
      const value = opts.length > 0 ? opts.length - 1 : 0;
      return { kind: 'response', response: { type: 19, value } };
    }
    case 'min':
    case 'first': {
      if (legal && legal.length > 0) {
        const action = legal[0];
        return responseFromAction(action, ctx);
      }
      return { kind: 'response', response: { type: 19, value: 0 } };
    }
    case 'yes': {
      if (legal && legal.length > 0) {
        const action = legal.find(a => a.responseIndex === 1) ?? legal[legal.length - 1];
        return responseFromAction(action, ctx);
      }
      return null;
    }
    case 'no': {
      if (legal && legal.length > 0) {
        const action = legal.find(a => a.responseIndex === 0) ?? legal[0];
        return responseFromAction(action, ctx);
      }
      return null;
    }
    case 'preferred': {
      if (!legal || legal.length === 0 || !hint.preferredCardIds) return null;
      for (const cid of hint.preferredCardIds) {
        const action = legal.find(a => a.cardId === cid);
        if (action) return responseFromAction(action, ctx);
      }
      // No preferred match — pass so a downstream oracle decides (e.g.
      // PlanTargetOracle, MechanicalDefaultOracle).
      return null;
    }
    case 'face-down':
      return { kind: 'response', response: { type: 11, position: OcgPosition.FACEDOWN_DEFENSE } };
    case 'face-up-attack':
      return { kind: 'response', response: { type: 11, position: OcgPosition.FACEUP_ATTACK } };
    case 'face-up-defense':
      return { kind: 'response', response: { type: 11, position: OcgPosition.FACEUP_DEFENSE } };
    case 'all': {
      // SELECT_PLACE / SELECT_DISFIELD — let mechanical default produce all
      // available places. Pass through.
      return null;
    }
    default: {
      // Unknown policy — log + pass (graceful fallback per design doc §2
      // "Unknown policies → log + return `pass`").
      console.warn(`[CardExpertiseOracle] unknown policy '${(hint as { policy: string }).policy}' for promptType=${ctx.promptType} sourceCardId=${ctx.sourceCardId}`);
      return null;
    }
  }
}

function responseFromAction(action: Action, ctx: DecisionContext): OracleResult | null {
  const response = (action as Action & { _response?: unknown })._response;
  if (response === undefined) {
    // No cached response — adapter-side enumerator hasn't built _response
    // (e.g. raw msg-only path). Pass.
    if (ctx.lastPickSource) ctx.lastPickSource.value = 'auto';
    return null;
  }
  if (ctx.lastPickSource) ctx.lastPickSource.value = 'target';
  return { kind: 'response', response, chosenAction: action };
}
