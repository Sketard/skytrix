// =============================================================================
// solver-strategy.ts — SolverStrategy & ActionRanker interfaces
// =============================================================================

import type { GameOracle } from './game-oracle.js';
import type { Action, FieldState, SolverConfig, SolverProgress, SolverResult } from './solver-types.js';

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
}
