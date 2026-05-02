// =============================================================================
// plan-replay-oracles.ts — Phase 4 deliverable for the prompt-resolver-refactor.
//
// Four oracles for the CLI chain compositions:
//   β-1 plan-replay:  [PlanStepOracle, PlanTargetOracle, EndPhasePolicyOracle, MechanicalDefault]
//   β-3 raw-replay:   [RawTrajectoryOracle, EndPhasePolicyOracle, MechanicalDefault]
//
//   - PlanStepOracle:        β-1 SELECT_IDLECMD plan match
//                            (verbatim of replay-trajectory-cli.ts:580-636)
//   - PlanTargetOracle:      β-1 sub-prompt target consumption
//                            (verbatim of replay-trajectory-cli.ts:443-507, 636-670)
//   - RawTrajectoryOracle:   β-3 raw step exact match
//                            (verbatim of replay-trajectory-cli.ts:522-578)
//   - EndPhasePolicyOracle:  plan/raw exhaustion + aggressive cascade
//                            (verbatim of replay-trajectory-cli.ts:557-578, 607-635)
//
// Phase 5 will add CardExpertiseOracle in front of the chain. The schema in
// DecisionContext is forward-compatible — its expertise fields are unused
// here. Phase 6 will plumb sourceCardId.
// =============================================================================

import type { Action } from './solver-types.js';
import type { DecisionContext, DecisionOracle, OracleResult, DivergenceInfo } from './prompt-resolver.js';
import { solverAssert } from './solver-assert.js';

// =============================================================================
// Shared utilities (previously in scripts/replay-trajectory-cli.ts)
// =============================================================================

/** Normalize a card name for case-insensitive substring matching. Handles
 *  smart-quote variants and whitespace collapse — critical for plans
 *  authored from copy-paste. Verbatim of CLI:289-295. */
export function normalizeName(s: string): string {
  return s.toLowerCase()
    .replace(/[‘’‚‛'`]/g, "'")  // smart quotes → '
    .replace(/[“”„‟"]/g, '"')   // smart double quotes
    .replace(/\s+/g, ' ')
    .trim();
}

/** β-1 plan step matcher. Action matches when its normalized name equals OR
 *  bidirectionally substring-contains the step's normalized name; if the step
 *  has a verb, action.actionVerb must equal it exactly. The `sourceZone`
 *  field disambiguates same-cardName same-verb actions that differ by source
 *  zone (e.g., King's Sarcophagus copy in HAND vs S1 — both surface as
 *  "activate" at IDLECMD but represent distinct actions). Optional. The
 *  `responseIndex` field bypasses cardName matching entirely — use it when
 *  cardName is undefined or ambiguous. */
export function actionMatchesPlanStep(
  action: Action,
  step: { cardName?: string; verb?: string; sourceZone?: string; responseIndex?: number },
  getName: (id: number) => string,
): boolean {
  // responseIndex bypass: when set, match on responseIndex only, ignoring all
  // other fields. Avoids the cardName-undefined crash on responseIndex-only
  // steps and allows pinning a specific legal-action index when cardName
  // matching is insufficient.
  if (step.responseIndex !== undefined) {
    return action.responseIndex === step.responseIndex;
  }
  // cardName is required in non-responseIndex mode
  if (step.cardName === undefined || step.cardName === '') return false;
  const targetName = normalizeName(step.cardName);
  const actionName = normalizeName((action as Action & { cardName?: string }).cardName || getName(action.cardId));
  if (actionName !== targetName) {
    if (!actionName.includes(targetName) && !targetName.includes(actionName)) return false;
  }
  if (step.verb && step.verb.length > 0) {
    if (action.actionVerb !== step.verb) return false;
  }
  // sourceZone disambiguation: when set on the step, action.sourceZone must
  // equal it. Prefix match for zone families ('SZONE' matches 'S1'..'S5',
  // 'MZONE' matches 'M1'..'M5'). Non-prefix matches require exact equality.
  if (step.sourceZone && step.sourceZone.length > 0) {
    const actSrc = action.sourceZone;
    if (!actSrc) return false;
    if (step.sourceZone === 'SZONE') {
      if (!/^S[1-5]$|^FZONE$|^PZONE$/.test(actSrc)) return false;
    } else if (step.sourceZone === 'MZONE') {
      if (!/^M[1-5]$|^EMZ_[LR]$/.test(actSrc)) return false;
    } else if (actSrc !== step.sourceZone) {
      return false;
    }
  }
  return true;
}

/** Per-CLI summarizer for divergence info — extracts just the fields needed
 *  for the divergence object's legalActionsAtPrompt list. */
function summarizeAction(a: Action, getName: (id: number) => string): DivergenceInfo['legalActionsAtPrompt'][number] {
  return {
    responseIndex: a.responseIndex,
    cardId: a.cardId,
    cardName: (a as Action & { cardName?: string }).cardName || getName(a.cardId),
    verb: a.actionVerb ?? null,
    sourceZone: a.sourceZone,
  };
}

const SUB_PROMPT_PICKABLE = new Set([
  'SELECT_CARD', 'SELECT_OPTION', 'SELECT_PLACE', 'SELECT_UNSELECT_CARD',
  'SELECT_TRIBUTE', 'SELECT_SUM', 'SELECT_POSITION',
  // SELECT_YESNO + SELECT_EFFECTYN are pickable so plans can override the
  // default policy via `targets: [{responseIndex: 0|1}]`. See CLI:454-464.
  'SELECT_YESNO', 'SELECT_EFFECTYN',
]);

// =============================================================================
// PlanStepOracle (β-1 SELECT_IDLECMD)
// =============================================================================

/** Activates only at SELECT_IDLECMD prompts in β-1 mode. Matches the next
 *  plan step against `legal` (via actionMatchesPlanStep), loads its targets/
 *  chainTargets into the pending queues, and increments planIdx. Returns
 *  divergence on no-match. Verbatim of CLI:580-606 + the no-match divergence
 *  block at CLI:586-597.
 *
 *  Plan-exhausted at SELECT_IDLECMD: returns pass — EndPhasePolicyOracle
 *  takes over (or the caller breaks the loop if endTurn=false). */
export class PlanStepOracle implements DecisionOracle {
  readonly name = 'PlanStepOracle';

  decide(ctx: DecisionContext): OracleResult {
    if (ctx.caller !== 'plan-β1') return { kind: 'pass' };
    if (ctx.promptType !== 'SELECT_IDLECMD') return { kind: 'pass' };
    const planSteps = ctx.planSteps;
    const planIdx = ctx.planIdx;
    const legal = ctx.legal;
    const getName = ctx.getName;
    if (!planSteps || !planIdx || !legal || !getName) return { kind: 'pass' };

    if (planIdx.value >= planSteps.length) {
      // Plan exhausted; EndPhasePolicyOracle decides next.
      return { kind: 'pass' };
    }

    const step = planSteps[planIdx.value];
    const chosen = legal.find(a => actionMatchesPlanStep(a, step, getName));
    if (!chosen) {
      const info: DivergenceInfo = {
        step: ctx.stepCount ?? 0,
        promptType: ctx.promptType,
        expected: `${step.cardName}${step.verb ? ' (' + step.verb + ')' : ''}`,
        legalActionsAtPrompt: legal.slice(0, 30).map(a => summarizeAction(a, getName)),
        reason: `No legal action matches "${step.cardName}"${step.verb ? ' verb=' + step.verb : ''} at this prompt. Plan step ${planIdx.value} of ${planSteps.length}.`,
      };
      return { kind: 'divergence', info };
    }

    // Match — commit state mutations:
    //   1. Stamp lastConsumedStepIndex (replayLog) and lastCommittedPlanStepIndex (corpus)
    //   2. Load targets/chainTargets into pending queues
    //   3. Bump planIdx
    if (ctx.lastConsumedStepIndex) ctx.lastConsumedStepIndex.value = planIdx.value;
    if (ctx.lastCommittedPlanStepIndex) ctx.lastCommittedPlanStepIndex.value = planIdx.value;

    const newTargets = (step.targets ?? []).slice();
    const newChainTargets = (step.chainTargets ?? []).slice();
    if (ctx.pendingTargets) {
      ctx.pendingTargets.length = 0;
      ctx.pendingTargets.push(...newTargets);
    }
    if (ctx.pendingChainTargets) {
      ctx.pendingChainTargets.length = 0;
      ctx.pendingChainTargets.push(...newChainTargets);
    }
    planIdx.value++;
    if (ctx.lastPickSource) ctx.lastPickSource.value = 'plan';

    // Build the OcgResponse from the chosen action's cached `_response`.
    const response = (chosen as Action & { _response?: unknown })._response;
    solverAssert(
      response !== undefined,
      'PlanStepOracle',
      `chosen Action lacks _response cache (cardId=${chosen.cardId} promptType=${ctx.promptType})`,
    );
    return { kind: 'response', response, chosenAction: chosen };
  }
}

// =============================================================================
// PlanTargetOracle (β-1 sub-prompts)
// =============================================================================

/** Activates only at sub-prompts in β-1 mode (SELECT_CHAIN, SELECT_EFFECTYN,
 *  SELECT_YESNO, SELECT_CARD, SELECT_OPTION, SELECT_PLACE, SELECT_TRIBUTE,
 *  SELECT_SUM, SELECT_UNSELECT_CARD, SELECT_POSITION).
 *
 *  Resolution order (verbatim of CLI:636-670):
 *    SELECT_CHAIN: tryConsumeChainTarget → if matched → response, else auto-pass
 *    SELECT_EFFECTYN: tryConsumeTarget → if matched → response, else default-YES (responseIndex 1)
 *    SELECT_YESNO + others: tryConsumeTarget → if matched → response, else legal[0]
 *
 *  Passes if no auto-pick is appropriate (i.e. a non-pickable mechanical prompt
 *  like SELECT_PLACE without targets — the chain falls through to the
 *  MechanicalDefaultOracle for the default behavior). */
export class PlanTargetOracle implements DecisionOracle {
  readonly name = 'PlanTargetOracle';

  decide(ctx: DecisionContext): OracleResult {
    if (ctx.caller !== 'plan-β1') return { kind: 'pass' };
    if (ctx.promptType === 'SELECT_IDLECMD') return { kind: 'pass' };

    const legal = ctx.legal;
    const getName = ctx.getName;
    if (!legal || !getName) return { kind: 'pass' };

    let chosen: Action | null = null;
    let pickSource: 'target' | 'auto' = 'auto';

    if (ctx.promptType === 'SELECT_CHAIN') {
      // SELECT_CHAIN: chainTargets queue
      const consumed = tryConsumeChainTarget(legal, ctx);
      if (consumed) {
        chosen = consumed;
        pickSource = 'target';
      } else {
        chosen = legal.find(a => a.responseIndex === -1) ?? legal[0];
        pickSource = 'auto';
      }
    } else if (ctx.promptType === 'SELECT_EFFECTYN') {
      const consumed = tryConsumeTarget(legal, ctx);
      if (consumed) {
        chosen = consumed;
        pickSource = 'target';
      } else {
        chosen = legal.find(a => a.responseIndex === 1) ?? legal[0];
        pickSource = 'auto';
      }
    } else if (SUB_PROMPT_PICKABLE.has(ctx.promptType)) {
      const consumed = tryConsumeTarget(legal, ctx);
      if (consumed) {
        chosen = consumed;
        pickSource = 'target';
      } else {
        chosen = legal[0];
        pickSource = 'auto';
      }
    } else {
      // Not in pickable set — let MechanicalDefaultOracle handle it.
      return { kind: 'pass' };
    }

    if (!chosen) return { kind: 'pass' };
    const response = (chosen as Action & { _response?: unknown })._response;
    solverAssert(
      response !== undefined,
      'PlanTargetOracle',
      `chosen Action lacks _response cache (cardId=${chosen.cardId} promptType=${ctx.promptType})`,
    );
    if (ctx.lastPickSource) ctx.lastPickSource.value = pickSource;
    return { kind: 'response', response, chosenAction: chosen };
  }
}

/** Consume the next pendingTargets[0] if it matches any legal action. Verbatim
 *  of CLI:466-484. Mutates ctx.pendingTargets via shift() on match. */
function tryConsumeTarget(legal: readonly Action[], ctx: DecisionContext): Action | null {
  if (!ctx.pendingTargets || ctx.pendingTargets.length === 0) return null;
  if (!SUB_PROMPT_PICKABLE.has(ctx.promptType)) return null;
  const t = ctx.pendingTargets[0];
  let match: Action | null = null;
  if (t.responseIndex !== undefined) {
    match = legal.find(a => a.responseIndex === t.responseIndex) ?? null;
  } else {
    const wanted = (t.cardNames ?? (t.cardName ? [t.cardName] : [])).map(normalizeName);
    if (wanted.length > 0) {
      match = legal.find(a => {
        const n = normalizeName((a as Action & { cardName?: string }).cardName || ctx.getName!(a.cardId));
        return wanted.some(w => n === w || n.includes(w) || w.includes(n));
      }) ?? null;
    }
  }
  if (match) ctx.pendingTargets.shift();
  return match;
}

/** Consume the next pendingChainTargets[0] at SELECT_CHAIN. Verbatim of CLI:490-507. */
function tryConsumeChainTarget(legal: readonly Action[], ctx: DecisionContext): Action | null {
  if (!ctx.pendingChainTargets || ctx.pendingChainTargets.length === 0) return null;
  const t = ctx.pendingChainTargets[0];
  let match: Action | null = null;
  if (t.responseIndex !== undefined) {
    match = legal.find(a => a.responseIndex === t.responseIndex) ?? null;
  } else {
    const wanted = (t.cardNames ?? (t.cardName ? [t.cardName] : [])).map(normalizeName);
    if (wanted.length > 0) {
      match = legal.find(a => {
        const n = normalizeName((a as Action & { cardName?: string }).cardName || ctx.getName!(a.cardId));
        return wanted.some(w => n === w || n.includes(w) || w.includes(n));
      }) ?? null;
    }
  }
  if (match) ctx.pendingChainTargets.shift();
  return match;
}

// =============================================================================
// RawTrajectoryOracle (β-3 raw step matching)
// =============================================================================

/** Activates in β-3 mode at any prompt. Matches `rawSteps[rawIdx]` exactly on
 *  responseIndex AND cardId. On match: increments rawIdx, returns response.
 *  On non-strategic (non-IDLECMD) mismatch: auto-resolves and DOES NOT consume
 *  the raw step. On strategic (IDLECMD) mismatch: returns divergence.
 *  Verbatim of CLI:522-555 (excluding the `endTurn` branch which lives in
 *  EndPhasePolicyOracle).
 *
 *  Raw exhausted: returns pass — EndPhasePolicyOracle takes over (or caller
 *  breaks if endTurn=false). */
export class RawTrajectoryOracle implements DecisionOracle {
  readonly name = 'RawTrajectoryOracle';

  decide(ctx: DecisionContext): OracleResult {
    if (ctx.caller !== 'plan-β3') return { kind: 'pass' };

    const rawSteps = ctx.rawSteps;
    const rawIdx = ctx.rawIdx;
    const legal = ctx.legal;
    const getName = ctx.getName;
    if (!rawSteps || !rawIdx || !legal || !getName) return { kind: 'pass' };

    if (rawIdx.value >= rawSteps.length) {
      // Raw exhausted; EndPhasePolicyOracle / caller takes over.
      return { kind: 'pass' };
    }

    const step = rawSteps[rawIdx.value];
    const chosen = legal.find(a => a.responseIndex === step.responseIndex && a.cardId === step.cardId);

    if (chosen) {
      if (ctx.lastConsumedStepIndex) ctx.lastConsumedStepIndex.value = rawIdx.value;
      rawIdx.value++;
      if (ctx.lastPickSource) ctx.lastPickSource.value = 'raw';
      const response = (chosen as Action & { _response?: unknown })._response;
      solverAssert(
        response !== undefined,
        'RawTrajectoryOracle',
        `chosen Action lacks _response cache (cardId=${chosen.cardId} promptType=${ctx.promptType})`,
      );
      return { kind: 'response', response, chosenAction: chosen };
    }

    if (ctx.promptType !== 'SELECT_IDLECMD') {
      // Sub-prompt mismatch — auto-resolve, don't consume the raw step.
      // Verbatim of CLI:531-544.
      let auto: Action | null;
      if (ctx.promptType === 'SELECT_CHAIN') {
        auto = legal.find(a => a.responseIndex === -1) ?? legal[0];
      } else if (ctx.promptType === 'SELECT_EFFECTYN') {
        auto = legal.find(a => a.responseIndex === 1) ?? legal[0];
      } else {
        auto = legal[0];
      }
      if (!auto) return { kind: 'pass' };
      if (ctx.lastPickSource) ctx.lastPickSource.value = 'auto';
      const response = (auto as Action & { _response?: unknown })._response;
      solverAssert(
        response !== undefined,
        'RawTrajectoryOracle',
        `auto-resolve Action lacks _response cache (cardId=${auto.cardId} promptType=${ctx.promptType})`,
      );
      return { kind: 'response', response, chosenAction: auto };
    }

    // Strategic mismatch at SELECT_IDLECMD → divergence. CLI:546-555.
    const info: DivergenceInfo = {
      step: ctx.stepCount ?? 0,
      promptType: ctx.promptType,
      expected: `${step.cardName ?? getName(step.cardId) ?? '(pass)'} (responseIndex=${step.responseIndex} cardId=${step.cardId})`,
      legalActionsAtPrompt: legal.slice(0, 30).map(a => summarizeAction(a, getName)),
      reason: `Raw trajectory step ${rawIdx.value} of ${rawSteps.length}: no legal action at SELECT_IDLECMD matches responseIndex=${step.responseIndex} cardId=${step.cardId}. Trajectory has drifted from engine state at a strategic decision.`,
    };
    return { kind: 'divergence', info };
  }
}

// =============================================================================
// EndPhasePolicyOracle (plan/raw exhaustion)
// =============================================================================

/** Activates after plan/raw is exhausted, only when endTurn=true. Picks
 *  productive verb (β-1 aggressive) or end-phase action; increments the
 *  appropriate counter. Returns divergence via stoppedReason='ceiling' when
 *  endPhaseAttempts exceeds MAX_END_PHASE_ATTEMPTS (50).
 *
 *  Note: 'ceiling' isn't a true divergence in the existing DivergenceInfo
 *  shape — the legacy CLI tracks it via separate fields (stoppedReason +
 *  errorMessage). The oracle returns pass here so the caller can detect the
 *  exhaustion + ceiling separately via the boxed counter and stoppedReason
 *  attribution. Verbatim of CLI:534-555 (β-3 path) + 607-635 (β-1 path).
 *
 *  Aggressive cascade is β-1 only (β-3 trajectories are exhaustive by
 *  construction; design doc decision §"Aggressive continuation"). */
export class EndPhasePolicyOracle implements DecisionOracle {
  readonly name = 'EndPhasePolicyOracle';
  private static readonly MAX_END_PHASE_ATTEMPTS = 50;
  private static readonly PRODUCTIVE_VERBS = [
    'summon-procedure', 'activate', 'pendulum-summon',
    'normal-summon', 'set-st', 'set-monster',
  ] as const;

  decide(ctx: DecisionContext): OracleResult {
    if (ctx.caller !== 'plan-β1' && ctx.caller !== 'plan-β3') return { kind: 'pass' };
    if (!ctx.endTurn) return { kind: 'pass' };

    // Only fire when plan/raw is exhausted (the upstream oracle returned pass
    // because index >= length). For non-IDLECMD prompts, the plan/raw oracles
    // have already auto-resolved or mechanical-default will handle it.
    const isPlanExhausted = ctx.caller === 'plan-β1'
      && ctx.planSteps !== undefined
      && ctx.planIdx !== undefined
      && ctx.planIdx.value >= ctx.planSteps.length;
    const isRawExhausted = ctx.caller === 'plan-β3'
      && ctx.rawSteps !== undefined
      && ctx.rawIdx !== undefined
      && ctx.rawIdx.value >= ctx.rawSteps.length;
    if (!isPlanExhausted && !isRawExhausted) return { kind: 'pass' };

    const legal = ctx.legal;
    if (!legal || legal.length === 0) return { kind: 'pass' };

    if (ctx.promptType === 'SELECT_IDLECMD') {
      // β-1 aggressive cascade — find a productive verb if enabled and under cap.
      // β-3 has no aggressive (per refactor design doc).
      if (ctx.caller === 'plan-β1'
        && ctx.continueMode === 'aggressive'
        && ctx.aggressiveActions
        && (ctx.maxAggressiveActions === undefined
          || ctx.aggressiveActions.value < ctx.maxAggressiveActions)
      ) {
        const productive = legal.find(a =>
          (EndPhasePolicyOracle.PRODUCTIVE_VERBS as readonly string[]).includes(a.actionVerb ?? ''),
        );
        if (productive) {
          ctx.aggressiveActions.value++;
          if (ctx.lastPickSource) ctx.lastPickSource.value = 'auto-end-phase';
          const response = (productive as Action & { _response?: unknown })._response;
          solverAssert(
            response !== undefined,
            'EndPhasePolicyOracle (aggressive)',
            `productive Action lacks _response cache (cardId=${productive.cardId})`,
          );
          return { kind: 'response', response, chosenAction: productive };
        }
      }
      // Default: pick end-phase action.
      const endPhase = legal.find(a => a.actionVerb === 'end-phase') ?? legal[legal.length - 1];
      if (ctx.endPhaseAttempts) {
        ctx.endPhaseAttempts.value++;
        if (ctx.endPhaseAttempts.value > EndPhasePolicyOracle.MAX_END_PHASE_ATTEMPTS) {
          // Caller detects this via the boxed counter and sets
          // stoppedReason='ceiling'. We still return the response so the
          // engine doesn't stall on this iteration.
        }
      }
      if (ctx.lastPickSource) ctx.lastPickSource.value = 'auto-end-phase';
      const response = (endPhase as Action & { _response?: unknown })._response;
      solverAssert(
        response !== undefined,
        'EndPhasePolicyOracle (end-phase)',
        `end-phase Action lacks _response cache (cardId=${endPhase.cardId})`,
      );
      return { kind: 'response', response, chosenAction: endPhase };
    }

    if (ctx.promptType === 'SELECT_CHAIN') {
      const auto = legal.find(a => a.responseIndex === -1) ?? legal[0];
      if (ctx.lastPickSource) ctx.lastPickSource.value = 'auto-end-phase';
      const response = (auto as Action & { _response?: unknown })._response;
      solverAssert(
        response !== undefined,
        'EndPhasePolicyOracle (chain)',
        `auto-pass Action lacks _response cache`,
      );
      return { kind: 'response', response, chosenAction: auto };
    }

    if (ctx.promptType === 'SELECT_EFFECTYN') {
      const auto = legal.find(a => a.responseIndex === 1) ?? legal[0];
      if (ctx.lastPickSource) ctx.lastPickSource.value = 'auto-end-phase';
      const response = (auto as Action & { _response?: unknown })._response;
      solverAssert(
        response !== undefined,
        'EndPhasePolicyOracle (effectyn)',
        `default-yes Action lacks _response cache`,
      );
      return { kind: 'response', response, chosenAction: auto };
    }

    // Other prompts — first legal.
    const auto = legal[0];
    if (ctx.lastPickSource) ctx.lastPickSource.value = 'auto-end-phase';
    const response = (auto as Action & { _response?: unknown })._response;
    solverAssert(
      response !== undefined,
      'EndPhasePolicyOracle (other)',
      `auto Action lacks _response cache (promptType=${ctx.promptType})`,
    );
    return { kind: 'response', response, chosenAction: auto };
  }
}
