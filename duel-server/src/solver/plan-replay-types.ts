// =============================================================================
// plan-replay-types.ts — shared types for the plan-replay (β-1) and
// raw-trajectory (β-3) modes consumed by both the CLI and the resolver
// oracles created in Phase 4 of the prompt-resolver-refactor.
//
// These types were previously co-located in scripts/replay-trajectory-cli.ts.
// Phase 4 moves them here so the oracles in plan-replay-oracles.ts can reuse
// them without duplication. The CLI re-exports nothing new — it just imports
// from this module.
// =============================================================================

/** A single sub-prompt override consumed at SELECT_CARD/OPTION/PLACE/etc. */
export interface TargetSpec {
  /** Card name to match against legal actions' card names at the next
   *  matching sub-prompt. Case-insensitive. */
  cardName?: string;
  /** Multiple acceptable card names (matches any). */
  cardNames?: string[];
  /** OR force a specific responseIndex (for prompts where card name doesn't
   *  apply, e.g. SELECT_OPTION effect-choice). */
  responseIndex?: number;
  /** Optional human note (no semantic effect; for plan readability). */
  promptHint?: string;
}

/** A β-1 plan step — one entry per SELECT_IDLECMD decision. */
export interface PlanStep {
  cardName: string;
  verb?: string;
  /** Sub-prompt overrides for the resolution chain triggered by this
   *  IDLECMD step. Consumed in order at SELECT_CARD / SELECT_OPTION /
   *  SELECT_UNSELECT_CARD / SELECT_PLACE prompts encountered before the
   *  next SELECT_IDLECMD. */
  targets?: TargetSpec[];
  /** Chain-trigger overrides. Consumed in order at SELECT_CHAIN prompts
   *  encountered after this step's IDLECMD action triggers them. */
  chainTargets?: TargetSpec[];
}

/** A β-3 raw trajectory step — one entry per OCG decision. */
export interface RawTrajectoryStep {
  responseIndex: number;
  cardId: number;
  cardName?: string;
  actionDescription?: string;
}
