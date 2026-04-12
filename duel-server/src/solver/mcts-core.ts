// =============================================================================
// mcts-core.ts — Shared helpers for MCTS-family solvers (SP-MCTS goldfish,
// Minimax-MCTS adversarial). Holds the pieces that are genuinely identical
// between the two: constants, stats construction, BFS tree pruning/truncation.
//
// What's NOT here:
//  - The main iteration loop (subtly different error handling + progress)
//  - select/expand/simulate/backpropagate (each has different min/max semantics)
//  - buildResult end-to-end (different sort policies + extra fields)
//
// These stay in each solver because extracting them would require generics
// over the node type + several abstract hooks, adding complexity without
// proportional payoff. The ~80 lines of shared BFS walk + stats are the
// high-value targets; everything else is fine to live in place.
// =============================================================================

import type { DecisionNode, SolverStats } from './solver-types.js';

// =============================================================================
// Constants
// =============================================================================

/** Bail out of any MCTS main loop after this many consecutive iteration
 *  failures. Protects against WASM corruption / adapter bad state spinning
 *  the budget. Shared by SP-MCTS and Minimax-MCTS. */
export const MAX_CONSECUTIVE_FAILURES = 10;

// =============================================================================
// buildMctsStats — Shared SolverStats builder
// =============================================================================

/** Build a SolverStats entry from MCTS iteration bookkeeping. Both SP-MCTS
 *  and Minimax-MCTS call this at end-of-solve. The only differences between
 *  them are the `algorithm` / `algorithmUsed` strings and (optionally) the
 *  abortedDueToFailures counter. */
export function buildMctsStats(params: {
  algorithm: string;
  algorithmUsed: string;
  nodesExplored: number;
  startTime: number;
  maxDepthReached: number;
  totalChildren: number;
  totalBranchingNodes: number;
  abortedDueToFailures?: number;
}): SolverStats {
  const { algorithm, algorithmUsed, nodesExplored, startTime,
    maxDepthReached, totalChildren, totalBranchingNodes, abortedDueToFailures } = params;
  return {
    nodesExplored,
    elapsed: Date.now() - startTime,
    algorithm,
    algorithmUsed,
    maxDepthReached,
    averageBranchingFactor: totalBranchingNodes > 0
      ? totalChildren / totalBranchingNodes
      : 0,
    deckSeed: '',
    ...(abortedDueToFailures !== undefined ? { abortedDueToFailures } : {}),
  };
}

// =============================================================================
// bfsPruneAndTruncate — Shared BFS tree conversion with per-level topX pruning
// and global maxNodes cap
// =============================================================================

/** Walk an internal MCTS node tree breadth-first, creating DecisionNode
 *  shadows via `makeShallow`. Prunes each level to `topX` children using
 *  `sortChildren`, and globally caps the output at `maxNodes` DecisionNodes
 *  (marking overflow nodes as `truncated: true`).
 *
 *  Parameters:
 *  - `root` / `tree` — both the internal root and its already-created
 *    DecisionNode shadow. The walk descends from root using the callers'
 *    `mNode.children` field, and populates `decision.children` on the
 *    corresponding shadows.
 *  - `getChildren(mNode)` — reads the internal children array. Kept as a
 *    callback so we don't require a specific field name (MCTSNode and
 *    MinimaxNode both have `children: TNode[]` but the generic bound can't
 *    see it without a constraint, so the callback is simpler).
 *  - `sortChildren(parent)` — returns a comparator for `parent`'s children.
 *    Callers embed min/max / sort-by-visits logic here.
 *  - `makeShallow(mNode, isRoot)` — creates a new DecisionNode representing
 *    `mNode`. Must NOT populate `.children` (this function owns that).
 *  - `maxNodes` / `topX` — pruning thresholds from SolverConfigFile.
 *
 *  Mutates `tree.children` and each shadow's `children` + `prunedChildren` +
 *  `truncated` fields. Returns nothing — the tree is modified in place.
 */
export function bfsPruneAndTruncate<TNode>(params: {
  root: TNode;
  tree: DecisionNode;
  getChildren: (mNode: TNode) => TNode[];
  sortChildren: (parent: TNode) => (a: TNode, b: TNode) => number;
  makeShallow: (mNode: TNode, isRoot: boolean) => DecisionNode;
  maxNodes: number;
  topX: number;
}): void {
  const { root, tree, getChildren, sortChildren, makeShallow, maxNodes, topX } = params;

  let nodeCount = 1;
  const queue: { mNode: TNode; decision: DecisionNode }[] = [{ mNode: root, decision: tree }];

  while (queue.length > 0) {
    const { mNode, decision } = queue.shift()!;

    const sorted = [...getChildren(mNode)].sort(sortChildren(mNode));
    const pruned = sorted.length > topX ? sorted.slice(0, topX) : sorted;
    const prunedCount = sorted.length - pruned.length;
    if (prunedCount > 0) decision.prunedChildren = prunedCount;

    for (const mChild of pruned) {
      if (nodeCount >= maxNodes) {
        decision.truncated = true;
        break;
      }
      const childDecision = makeShallow(mChild, false);
      decision.children.push(childDecision);
      queue.push({ mNode: mChild, decision: childDecision });
      nodeCount++;
    }

    // A node with output children is not terminal even if pruning left some
    // siblings behind; matches the original defensive semantics in both
    // MCTS solvers.
    if (decision.children.length > 0) decision.isTerminal = false;
  }
}
