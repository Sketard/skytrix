// =============================================================================
// branching-oracles.ts — Phase 3 deliverable for the prompt-resolver-refactor.
//
// Two oracles for the DFS chain composition:
//   [OpponentBranchingOracle, BranchingOracle, MechanicalDefaultOracle]
//
//   - OpponentBranchingOracle: opponent SELECT_CHAIN with handtraps configured
//     → enumerate as team:1 actions for minimax exploration
//     (verbatim of ocgcore-adapter.ts:806-816, Track A §"Adversarial branching")
//
//   - BranchingOracle: player exploratory enumeration + multi-pick interactive
//     trace-assist + small/large pool SELECT_CARD branching
//     (verbatim of ocgcore-adapter.ts:825-876, Track A §"Branching layer L2/L3")
//
// Both oracles delegate to enumeration helpers exposed by the adapter via the
// BranchingDelegate interface — passed as a closure bundle on construction
// so the oracles stay decoupled from the adapter type. Phase 7 may extract
// these helpers if a cleaner home emerges.
//
// F14 plumbing (lastIdlecmdActivatableHandCount): NOT here — done by the
// caller after `resolver.resolve()` returns, because that counter lives on
// `InternalHandle` which is private to the adapter. The post-resolve hook is
// documented in the refactor design doc §"BranchingOracle / F14 plumbing".
// =============================================================================

import type { Action, DuelConfig, PromptType } from './solver-types.js';
import { EXPLORATORY_PROMPTS } from './solver-types.js';
import type { DecisionContext, DecisionOracle, OracleResult } from './prompt-resolver.js';

/** Helpers the adapter exposes to the branching oracles. Each method mirrors
 *  a private adapter helper at the same signature; the adapter binds these
 *  to itself when constructing the oracles. */
export interface BranchingDelegate {
  enumerateActionsWithResponses(
    msg: Record<string, unknown>,
    promptType: PromptType,
    config: DuelConfig,
  ): Action[];
  selectCardIsExploratory(msg: Record<string, unknown>): boolean;
  selectCardIsPreferredExploratory(msg: Record<string, unknown>, config: DuelConfig): boolean;
  enumeratePreferredSelectCard(msg: Record<string, unknown>, config: DuelConfig): Action[];
  /** Returns the multi-pick enumeration if the prompt qualifies, else null.
   *  The adapter version takes its `internal` handle for state mutation
   *  (pendingMultiPick) — that's wrapped into a closure by the adapter when
   *  binding the delegate, so the oracle just sees the (msg, promptType)
   *  signature. */
  tryInteractiveMechanical(msg: Record<string, unknown>, promptType: PromptType): Action[] | null;
}

// =============================================================================
// OpponentBranchingOracle
// =============================================================================

export class OpponentBranchingOracle implements DecisionOracle {
  readonly name = 'OpponentBranchingOracle';

  constructor(private readonly delegate: BranchingDelegate) {}

  decide(ctx: DecisionContext): OracleResult {
    if (ctx.player !== 1) return { kind: 'pass' };

    // Adversarial mode gate: handtraps configured AND prompt is SELECT_CHAIN.
    // Verbatim of ocgcore-adapter.ts:810-816.
    const isAdversarial = (ctx.config?.handtraps?.length ?? 0) > 0;
    if (!isAdversarial) return { kind: 'pass' };
    if (ctx.promptType !== 'SELECT_CHAIN') return { kind: 'pass' };

    const actions = this.delegate.enumerateActionsWithResponses(
      ctx.msg,
      ctx.promptType,
      ctx.config!,
    );
    // Tag all actions as opponent (team: 1)
    for (const a of actions) a.team = 1;
    return { kind: 'branches', actions };
  }
}

// =============================================================================
// BranchingOracle
// =============================================================================

export class BranchingOracle implements DecisionOracle {
  readonly name = 'BranchingOracle';

  constructor(private readonly delegate: BranchingDelegate) {}

  decide(ctx: DecisionContext): OracleResult {
    // BranchingOracle is for the player only — opponent prompts are handled
    // either by OpponentBranchingOracle (adversarial) or MechanicalDefaultOracle
    // (goldfish) downstream.
    if (ctx.player !== 0) return { kind: 'pass' };

    const config = ctx.config;
    if (!config) return { kind: 'pass' };

    // ---- Mechanical prompts ----
    // promptType is set AND not in EXPLORATORY_PROMPTS → mechanical.
    // Verbatim of ocgcore-adapter.ts:825-861.
    if (ctx.promptType && !EXPLORATORY_PROMPTS.has(ctx.promptType)) {
      // Phase 5-lite trace-assist: expose multi-pick mechanical prompts as
      // interactive branches. Covers SELECT_CARD min>1, SELECT_TRIBUTE,
      // SELECT_SUM, SELECT_UNSELECT_CARD. Default false in production.
      if (ctx.exposeMultiPickMechanical) {
        const interactive = this.delegate.tryInteractiveMechanical(ctx.msg, ctx.promptType);
        if (interactive !== null) {
          return { kind: 'branches', actions: interactive };
        }
      }
      // Small-pool SELECT_CARD exploratory branch (≤ SELECT_CARD_EXPLORATORY_MAX).
      if (ctx.promptType === 'SELECT_CARD' && this.delegate.selectCardIsExploratory(ctx.msg)) {
        const actions = this.delegate.enumerateActionsWithResponses(ctx.msg, ctx.promptType, config);
        return { kind: 'branches', actions };
      }
      // Large-pool SELECT_CARD with preferred matches.
      if (ctx.promptType === 'SELECT_CARD' && this.delegate.selectCardIsPreferredExploratory(ctx.msg, config)) {
        const actions = this.delegate.enumeratePreferredSelectCard(ctx.msg, config);
        return { kind: 'branches', actions };
      }
      // Otherwise fall through to MechanicalDefaultOracle.
      return { kind: 'pass' };
    }

    // ---- Exploratory prompts ----
    // SELECT_IDLECMD, SELECT_BATTLECMD, SELECT_CHAIN, SELECT_EFFECTYN,
    // SELECT_YESNO, SELECT_OPTION → enumerate. Verbatim of ocgcore-adapter.ts:864-876.
    if (ctx.promptType) {
      const actions = this.delegate.enumerateActionsWithResponses(ctx.msg, ctx.promptType, config);
      return { kind: 'branches', actions };
    }

    return { kind: 'pass' };
  }
}
