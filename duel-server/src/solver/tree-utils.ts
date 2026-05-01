// =============================================================================
// tree-utils.ts — Pure tree-walking helpers + canonical ROOT_ACTION sentinel.
// Shared by DfsSolver, MCTSSolver, MinimaxMctsSolver, and solver-worker top-K
// extraction. Lives here (not in dfs-solver.ts) because nothing about it is
// DFS-specific — it's just a tree walk.
// =============================================================================

import type { DecisionNode, SolverAction } from './solver-types.js';

/** Sentinel action planted on every solver root DecisionNode. Consumers
 *  identify the root by `action.actionDescription === ROOT_ACTION.actionDescription`
 *  (the responseIndex is reused for real actions so can't be used as a tag). */
export const ROOT_ACTION: SolverAction = {
  responseIndex: -1,
  cardId: 0,
  cardName: '',
  actionDescription: 'root',
};

/** Walk the DecisionNode tree following `children[0]` at each level. Returns
 *  the ordered list of SolverActions along that chain, skipping the ROOT_ACTION
 *  placeholder. Uses `maxDepth` as a guard against pathological cycles.
 *
 *  NOTE for adversarial solvers: the walk is blind to player vs opponent —
 *  it descends `children[0]` regardless. For adversarial results, callers
 *  must build the player-only mainPath themselves (see
 *  `MinimaxMctsSolver.walkRecommendedPath`). This helper stays non-adversarial
 *  aware on purpose so DFS and goldfish MCTS can share it unchanged. */
export function extractMainPath(root: DecisionNode, maxDepth = 50): SolverAction[] {
  if (root.children.length === 0) return [];

  const path: SolverAction[] = [];
  let current = root;
  let guard = maxDepth;

  while (current.children.length > 0 && guard-- > 0) {
    const next = current.children[0];
    if (next.action.actionDescription !== ROOT_ACTION.actionDescription) {
      path.push(next.action);
    }
    current = next;
  }

  return path;
}
