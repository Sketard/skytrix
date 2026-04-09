// =============================================================================
// solver-strategy.ts — SolverStrategy & ActionRanker interfaces
// =============================================================================

import type { GameOracle } from './game-oracle.js';
import type { Action, FieldState, PromptType, SolverConfig, SolverProgress, SolverResult } from './solver-types.js';

// =============================================================================
// SolverStrategy — Pluggable algorithm interface (DFS, MCTS, etc.)
// =============================================================================

export interface SolverStrategy {
  readonly name: string;
  readonly supportsAdversarial: boolean;
  solve(
    oracle: GameOracle,
    config: SolverConfig,
    signal: AbortSignal,
    onProgress: (progress: SolverProgress) => void,
  ): SolverResult;
}

// =============================================================================
// ActionRanker — Orders/filters legal actions for tree exploration
// =============================================================================

export interface ActionRanker {
  rank(actions: Action[], state: FieldState): Action[];
  /**
   * Returns true if rank() actually consults FieldState for the given prompt.
   * Solvers use this to skip the WASM getFieldState() read for prompts the
   * ranker would no-op on. Lets each ranker own the list of "interesting"
   * prompts instead of duplicating it across DFS/MCTS call sites.
   */
  needsState(promptType: PromptType): boolean;
}
