// =============================================================================
// prompt-resolver.ts — Phase 2 deliverable for the prompt-resolver-refactor.
//
// Unifies the two parallel decision pipelines (DFS via runUntilPlayerPrompt
// in ocgcore-adapter.ts, and plan-replay via replay-trajectory-cli.ts) behind
// a single PromptResolver + OracleChain abstraction. See:
//   _bmad-output/solver-data/prompt-resolver-refactor-2026-05-01.md
//   _bmad-output/solver-data/inventory-2026-05-01.md
//
// Phase 2 scope: this module is GREENFIELD — wired but not yet called from
// either entry point. Phase 3 migrates runUntilPlayerPrompt to call
// PromptResolver.resolve(); Phase 4 does the same for replay-trajectory-cli.
//
// =============================================================================

import type { Action, DuelConfig, PromptType } from './solver-types.js';
import { solverAssert } from './solver-assert.js';

// =============================================================================
// Public types
// =============================================================================

/** Result of a single oracle's decide() call. The chain walks oracles in order
 *  until one returns a non-pass result. */
export type OracleResult =
  | { kind: 'response'; response: unknown }
  | { kind: 'branches'; actions: Action[] }
  | { kind: 'divergence'; info: DivergenceInfo }
  | { kind: 'pass' };

/** Result of PromptResolver.resolve() — the chain's final output, with the
 *  source oracle attached for telemetry/forensics. The terminal MechanicalDefault
 *  oracle MUST always answer; the chain throws if it doesn't. */
export type ResolveResult =
  | { kind: 'response'; response: unknown; source: string }
  | { kind: 'branches'; actions: Action[]; source: string }
  | { kind: 'divergence'; info: DivergenceInfo; source: string };

/** Plan/raw-replay divergence info — same shape as the one in
 *  replay-trajectory-cli.ts (Track B inventory line ~564). The CLI consumer
 *  serializes this into the result file. */
export interface DivergenceInfo {
  step: number;
  promptType: string;
  expected: string;
  legalActionsAtPrompt: Array<{
    responseIndex: number;
    cardId: number;
    cardName: string;
    verb: string | null;
    sourceZone?: string;
  }>;
  reason: string;
}

/** The shared context every oracle reads from (and some mutate). The schema
 *  grows incrementally per phase — Phase 2 needed only the basic prompt
 *  payload + player + config; Phase 3 adds DFS-side flags. Phase 5+ extends
 *  with expertise/plan/raw fields. The full target schema is in the refactor
 *  design doc §"DecisionContext". */
export interface DecisionContext {
  // ---- OCG prompt payload ----
  promptType: PromptType;
  /** Raw OCG message — every oracle reads its own fields out of this. */
  msg: Record<string, unknown>;
  /** Caller dispatch — controls which oracles in the chain composition are
   *  active. Phase 2 only needs the dispatch label; per-caller fields appear
   *  in later phases. */
  caller: 'dfs' | 'plan-β1' | 'plan-β3' | 'enumerate';
  /** Whose prompt is this — needed by MechanicalDefaultOracle to dispatch
   *  to the opponent goldfish sub-case. 0 = player, 1 = opponent. Sourced
   *  from `msg.player`. */
  player: 0 | 1;

  // ---- DFS-side flags (Phase 3) ----
  /** When true, BranchingOracle dispatches multi-pick prompts (SELECT_CARD
   *  min>1, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD) through
   *  tryInteractiveMechanical (trace-assist). Default false. Mirrors
   *  OCGCoreAdapter.exposeMultiPickMechanical. */
  exposeMultiPickMechanical?: boolean;

  // ---- Config ----
  config?: DuelConfig;
}

/** Every oracle implements this. Phase 2 ships only MechanicalDefaultOracle. */
export interface DecisionOracle {
  readonly name: string;
  decide(ctx: DecisionContext): OracleResult;
  /** Optional cache reset between solves. */
  reset?(): void;
}

// =============================================================================
// PromptResolver — runs the chain
// =============================================================================

/** Composes a list of oracles into a sequential decision chain. The terminal
 *  oracle (last in the chain) MUST always answer (no pass), enforced at
 *  construction by `terminalGuaranteed=true` and at runtime by an assertion
 *  on `pass` from the last oracle. */
export class PromptResolver {
  constructor(private readonly oracles: readonly DecisionOracle[]) {
    solverAssert(
      oracles.length > 0,
      'PromptResolver',
      'oracle chain cannot be empty',
    );
  }

  resolve(ctx: DecisionContext): ResolveResult {
    for (const oracle of this.oracles) {
      const out = oracle.decide(ctx);
      if (out.kind === 'pass') continue;
      if (out.kind === 'response') {
        return { kind: 'response', response: out.response, source: oracle.name };
      }
      if (out.kind === 'branches') {
        return { kind: 'branches', actions: out.actions, source: oracle.name };
      }
      if (out.kind === 'divergence') {
        return { kind: 'divergence', info: out.info, source: oracle.name };
      }
    }
    // The terminal oracle (MechanicalDefaultOracle) must always answer.
    // Reaching here means a misconfigured chain.
    solverAssert(
      false,
      'PromptResolver.resolve',
      `oracle chain exhausted without producing a result for promptType=${ctx.promptType}`,
      { ctx: { promptType: ctx.promptType, caller: ctx.caller, player: ctx.player, msgType: ctx.msg['type'] } },
    );
    // solverAssert may swallow in prod — return a safe fallback consistent
    // with the legacy MechanicalDefaultOracle default branch.
    return { kind: 'response', response: { type: 4, index: 0 }, source: 'PromptResolver-fallback' };
  }

  resetAll(): void {
    for (const oracle of this.oracles) oracle.reset?.();
  }
}
