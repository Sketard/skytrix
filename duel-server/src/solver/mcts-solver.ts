// =============================================================================
// mcts-solver.ts — Single-Player Monte Carlo Tree Search solver strategy
// Uses UCB1 selection, epsilon-greedy rollout with GoldfishChainRanker,
// and max backpropagation for goldfish combo solving.
// =============================================================================

import type { GameOracle, DuelHandle } from './game-oracle.js';
import type { SolverStrategy, ActionRanker } from './solver-strategy.js';
import type {
  Action,
  DecisionNode,
  FieldState,
  ScoreBreakdown,
  SolverAction,
  SolverConfig,
  SolverConfigFile,
  SolverProgress,
  SolverResult,
  SolverStats,
} from './solver-types.js';
import type { InterruptionScorer } from './interruption-scorer.js';
import type { OCGCoreAdapter } from './ocgcore-adapter.js';
import { extractMainPath, ROOT_ACTION } from './dfs-solver.js';

// Bail out of MCTS main loop after this many consecutive iteration failures.
// Protects against WASM corruption / adapter bad state spinning the budget.
const MAX_CONSECUTIVE_FAILURES = 10;

// Frozen zero-breakdown sentinel — avoids per-call allocations.
const EMPTY_BREAKDOWN: Readonly<ScoreBreakdown> = Object.freeze({
  omniNegate: 0, typedNegate: 0, targetedNegate: 0, floodgate: 0,
  controlChange: 0, banish: 0, banishFacedown: 0, attach: 0,
  spin: 0, flipFacedown: 0, destruction: 0, moveToSt: 0,
  bounce: 0, handRip: 0, sendToGy: 0, total: 0,
});

// =============================================================================
// Xoshiro128** PRNG — Seeded, deterministic, period 2^128 - 1
// Consumes the full bigint[] worker seed instead of truncating to 32 bits.
// =============================================================================

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) | 0;
}

class Xoshiro128SS {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: bigint[]) {
    // Mix every 64-bit chunk into 4 × 32-bit lanes via round-robin XOR.
    // Preserves entropy from the full seed array instead of dropping to seed[0].
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let i = 0; i < seed.length; i++) {
      const lo = Number(seed[i] & 0xFFFFFFFFn) | 0;
      const hi = Number((seed[i] >> 32n) & 0xFFFFFFFFn) | 0;
      switch (i & 3) {
        case 0: s0 ^= lo; s1 ^= hi; break;
        case 1: s2 ^= lo; s3 ^= hi; break;
        case 2: s0 ^= hi; s2 ^= lo; break;
        case 3: s1 ^= hi; s3 ^= lo; break;
      }
    }
    // xoshiro128** requires non-zero state.
    if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.s3 = s3;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9);
    const t = (this.s1 << 9) | 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return (result >>> 0) / 4294967296;
  }
}

// =============================================================================
// MCTSNode — Internal tree node (not exported)
// =============================================================================

interface MCTSNode {
  action: Action | null;       // null for root
  parent: MCTSNode | null;
  children: MCTSNode[];
  visits: number;
  totalScore: number;          // sum of backpropagated scores
  bestScore: number;           // max backpropagated score (for max policy)
  score: number;               // current = bestScore (max) or totalScore/visits (mean)
  isTerminal: boolean;
  isExpanded: boolean;
  untriedActions: Action[];    // remaining legal actions not yet expanded
  depth: number;
  cardName: string;            // enriched at expansion time
  actionDescription: string;   // enriched at expansion time
  scoreBreakdown?: ScoreBreakdown;  // terminal nodes only
  // fieldState NOT stored on nodes — tracked globally (Task 5.4)
}

// =============================================================================
// MCTSSolver
// =============================================================================

export class MCTSSolver implements SolverStrategy {
  readonly name = 'mcts';
  readonly supportsAdversarial = true;

  private readonly scorer: InterruptionScorer;
  private readonly adapter: OCGCoreAdapter;
  private readonly ranker: ActionRanker;
  private readonly configFile: SolverConfigFile;

  // Seed for PRNG — set by worker before solve(). Defaults to a single non-zero
  // chunk so a forgotten setSeed() doesn't crash xoshiro128**'s zero-state guard.
  private _seed: bigint[] = [1n];

  // Warm-start floor from DFS probe (Task 8.6).
  // NOTE: probe nodesExplored is intentionally NOT recorded as MCTS visits.
  // DFS node-explorations and MCTS rollouts measure different quantities;
  // mixing them poisons UCB1 exploration and the mean-policy denominator.
  private warmStartBestScore = 0;

  // Best terminal state — tracked globally across all rollouts (Task 5.4)
  private _bestTerminalScore = -Infinity;
  private _bestTerminalFieldState: FieldState | undefined;
  private _bestTerminalScoreBreakdown: ScoreBreakdown | undefined;

  constructor(
    scorer: InterruptionScorer,
    adapter: OCGCoreAdapter,
    ranker: ActionRanker,
    configFile: SolverConfigFile,
  ) {
    this.scorer = scorer;
    this.adapter = adapter;
    this.ranker = ranker;
    this.configFile = configFile;
  }

  // ===========================================================================
  // Warm-Start (from DFS probe — Task 8.6)
  // ===========================================================================

  /** Set the PRNG seed from worker's bigint[] seed. Call before solve(). */
  setSeed(seed: bigint[]): void {
    this._seed = seed.length > 0 ? seed : [1n];
  }

  warmStart(probeResult: { nodesExplored: number; bestScore: number }): void {
    // Only the bestScore is carried over: it acts as a floor on the result so
    // MCTS never reports a worse line than the probe found. nodesExplored is
    // intentionally discarded — see field comment above.
    this.warmStartBestScore = probeResult.bestScore;
  }

  // ===========================================================================
  // Solve — Main MCTS loop
  // ===========================================================================

  solve(
    oracle: GameOracle,
    config: SolverConfig,
    signal: AbortSignal,
    onProgress: (progress: SolverProgress) => void,
    startHandle?: DuelHandle,
  ): SolverResult {
    if (!startHandle) throw new Error('[Solver] MCTSSolver requires startHandle');

    // Seeded PRNG — seed set by worker via setSeed() before calling solve()
    const prng = new Xoshiro128SS(this._seed);

    // Reset per-solve state
    this._bestTerminalScore = -Infinity;
    this._bestTerminalFieldState = undefined;
    this._bestTerminalScoreBreakdown = undefined;

    const root = this.createRootNode();

    // Apply warm-start floor (Task 8.6). The probe and MCTS use the same
    // InterruptionScorer, so probe scores are directly comparable to rollout
    // scores. Seed only the bestScore — visits/totalScore stay zero so UCB1
    // and the mean-policy denominator aren't poisoned by DFS node counts.
    if (this.warmStartBestScore > 0) {
      this._bestTerminalScore = this.warmStartBestScore;
      root.bestScore = this.warmStartBestScore;
      root.score = this.warmStartBestScore;
      this.warmStartBestScore = 0;
    }

    const startTime = Date.now();
    let lastProgressTime = startTime;
    let nodesExplored = 0;
    let maxDepthReached = 0;
    let totalChildren = 0;
    let totalBranchingNodes = 0;
    let consecutiveFailures = 0;
    let abortedDueToFailures: number | undefined;

    // Reserve verification budget
    const solveBudgetMs = config.timeLimitMs * (1 - this.configFile.verificationBudgetRatio);

    while (!signal.aborted && (Date.now() - startTime) < solveBudgetMs) {
      let handle: DuelHandle | undefined;
      try {
        handle = oracle.fork(startHandle);

        // 1. Selection — traverse tree using UCB1, applying actions on handle
        const selected = this.select(root, handle, oracle);

        // 2. Expansion — expand one untried action
        const expanded = this.expand(selected, handle, oracle);

        // Track branching stats
        if (expanded !== selected && expanded.parent) {
          const parent = expanded.parent;
          if (parent.children.length === 1) {
            // First child added to this parent
            totalBranchingNodes++;
          }
          totalChildren++;
        }

        // 3. Simulation — rollout to terminal with epsilon-greedy
        const { rolloutScore, maxDepth } = this.simulate(expanded, handle, oracle, prng);
        if (maxDepth > maxDepthReached) maxDepthReached = maxDepth;

        // 4. Backpropagation — update stats up to root
        this.backpropagate(expanded, rolloutScore);

        nodesExplored++;
        consecutiveFailures = 0;
      } catch (err) {
        // Log every failure (the user has explicit "keep debug logs" guidance —
        // silent failures hide WASM/adapter regressions in prod). Circuit-break
        // after MAX_CONSECUTIVE_FAILURES so a corrupted adapter can't spin the
        // entire time budget on no-ops.
        consecutiveFailures++;
        console.warn(
          `[Solver] MCTS iteration failed (consecutive=${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
          err,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`[Solver] MCTS aborted after ${consecutiveFailures} consecutive failures`);
          abortedDueToFailures = consecutiveFailures;
          break;
        }
        continue;
      } finally {
        if (handle) oracle.destroyDuel(handle);
      }

      // Progress reporting
      const now = Date.now();
      if (nodesExplored % 100 === 0 || now - lastProgressTime > 200) {
        onProgress({
          nodesExplored,
          bestScore: root.bestScore,
          elapsed: now - startTime,
        });
        lastProgressTime = now;
      }
    }

    // NOTE: do NOT destroy startHandle — the worker owns it
    return this.buildResult(
      root, nodesExplored, startTime, maxDepthReached,
      totalChildren, totalBranchingNodes, abortedDueToFailures,
    );
  }

  // ===========================================================================
  // UCB1 Selection (Task 3)
  // ===========================================================================

  private select(node: MCTSNode, handle: DuelHandle, oracle: GameOracle): MCTSNode {
    let current = node;

    while (current.isExpanded && !current.isTerminal && current.children.length > 0) {
      // All actions tried — select child with highest UCB1
      const C = this.configFile.ucb1C;
      const lnParentVisits = Math.log(current.visits);
      let bestUcb = -Infinity;
      let bestChild: MCTSNode | null = null;

      for (const child of current.children) {
        const exploitation = child.score;
        // Defensive guard: today expand() always backpropagates before the next
        // select() pass, so child.visits >= 1 here. The guard makes the
        // "force-visit-unvisited" UCB1 convention explicit and survives any
        // future split between selection and expansion.
        const exploration = child.visits === 0
          ? Infinity
          : C * Math.sqrt(lnParentVisits / child.visits);
        const ucb = exploitation + exploration;
        if (ucb > bestUcb) {
          bestUcb = ucb;
          bestChild = child;
        }
      }

      if (!bestChild) break;

      // Apply selected child's action on the handle to advance game state
      oracle.applyAction(handle, bestChild.action!);
      current = bestChild;
    }

    return current;
  }

  // ===========================================================================
  // Ranker helper — only fetches FieldState for prompts the ranker actually uses
  // ===========================================================================

  private rankIfNeeded(actions: Action[], handle: DuelHandle, oracle: GameOracle): Action[] {
    // The ranker owns the list of prompts it inspects (via needsState). The
    // solver only pays the WASM FieldState read when the ranker would use it.
    if (this.ranker.needsState(actions[0].promptType)) {
      return this.ranker.rank(actions, oracle.getFieldState(handle));
    }
    return actions;
  }

  // ===========================================================================
  // Expansion (Task 4)
  // ===========================================================================

  private expand(node: MCTSNode, handle: DuelHandle, oracle: GameOracle): MCTSNode {
    if (node.isTerminal) return node;

    // First visit: populate untried actions
    if (!node.isExpanded && node.untriedActions.length === 0) {
      const actions = oracle.getLegalActions(handle);
      if (actions.length === 0) {
        node.isTerminal = true;
        node.isExpanded = true;
        return node;
      }
      node.untriedActions = this.rankIfNeeded(actions, handle, oracle);
      if (node.untriedActions.length === 0) {
        node.isTerminal = true;
        node.isExpanded = true;
        return node;
      }
    }

    if (node.untriedActions.length === 0) {
      // Fully expanded
      node.isExpanded = true;
      return node;
    }

    // Pick next untried action
    const action = node.untriedActions.shift()!;

    // Enrich action metadata at expansion time so the tree carries displayable
    // strings without re-fetching card metadata at result-build time.
    const enriched = this.adapter.enrichAction(action);

    // Create child node
    const child: MCTSNode = {
      action,
      parent: node,
      children: [],
      visits: 0,
      totalScore: 0,
      bestScore: 0,
      score: 0,
      isTerminal: false,
      isExpanded: false,
      untriedActions: [],
      depth: node.depth + 1,
      cardName: enriched.cardName,
      actionDescription: enriched.actionDescription,
    };

    node.children.push(child);

    // Mark parent as fully expanded if no more untried actions
    if (node.untriedActions.length === 0) {
      node.isExpanded = true;
    }

    // Apply action on handle
    oracle.applyAction(handle, action);

    return child;
  }

  // ===========================================================================
  // Epsilon-Greedy Rollout Simulation (Task 5)
  // ===========================================================================

  private simulate(
    node: MCTSNode,
    handle: DuelHandle,
    oracle: GameOracle,
    prng: Xoshiro128SS,
  ): { rolloutScore: number; maxDepth: number } {
    let depth = node.depth;
    const maxDepth = this.configFile.maxDepth;
    const epsilon = this.configFile.rolloutEpsilon;

    while (depth < maxDepth) {
      const actions = oracle.getLegalActions(handle);
      if (actions.length === 0) break;

      const ranked = this.rankIfNeeded(actions, handle, oracle);

      // Epsilon-greedy: (1-ε) best, ε random
      const action = prng.next() < epsilon
        ? ranked[Math.floor(prng.next() * ranked.length)]
        : ranked[0];

      oracle.applyAction(handle, action);
      depth++;
    }

    const finalState = oracle.getFieldState(handle);
    const { score, scoreBreakdown } = this.scorer.score(finalState);

    // Track best terminal globally (Task 5.4)
    if (score > this._bestTerminalScore) {
      this._bestTerminalScore = score;
      this._bestTerminalFieldState = finalState;
      this._bestTerminalScoreBreakdown = scoreBreakdown;
    }

    return { rolloutScore: score, maxDepth: depth };
  }

  // ===========================================================================
  // Backpropagation (Task 6)
  // ===========================================================================

  private backpropagate(node: MCTSNode, score: number): void {
    const useMax = this.configFile.backpropPolicy !== 'mean';
    let current: MCTSNode | null = node;

    while (current !== null) {
      current.visits++;
      current.totalScore += score;
      current.bestScore = Math.max(current.bestScore, score);
      current.score = useMax
        ? current.bestScore
        : current.totalScore / current.visits;
      current = current.parent;
    }
  }

  // ===========================================================================
  // Build SolverResult (Task 7)
  // ===========================================================================

  private buildResult(
    root: MCTSNode,
    nodesExplored: number,
    startTime: number,
    maxDepthReached: number,
    totalChildren: number,
    totalBranchingNodes: number,
    abortedDueToFailures?: number,
  ): SolverResult {
    const useMax = this.configFile.backpropPolicy !== 'mean';

    // endBoardCards from best terminal (shared by empty + populated paths)
    let endBoardCards = undefined;
    if (this._bestTerminalFieldState) {
      endBoardCards = this.scorer.scoreWithCards(this._bestTerminalFieldState).endBoardCards;
    }

    // Empty result guard (Task 7.6) — root has no children either because no
    // iteration ever expanded one, or because root itself was terminal and only
    // simulate() ran on it. In the latter case _bestTerminalScore is set; surface
    // it instead of dropping to zero.
    if (root.children.length === 0) {
      const hasBestTerminal = this._bestTerminalScore > -Infinity;
      return {
        tree: {
          action: ROOT_ACTION,
          annotation: '',
          score: hasBestTerminal ? this._bestTerminalScore : 0,
          scoreBreakdown: this._bestTerminalScoreBreakdown ?? EMPTY_BREAKDOWN,
          confidence: 0,
          children: [],
          isTerminal: true,
        },
        mainPath: [],
        score: hasBestTerminal ? this._bestTerminalScore : 0,
        scoreBreakdown: this._bestTerminalScoreBreakdown ?? EMPTY_BREAKDOWN,
        endBoardCards,
        stats: this.buildStats(nodesExplored, startTime, maxDepthReached, 0, 0, abortedDueToFailures),
      };
    }

    const totalVisits = root.visits;
    const topX = this.configFile.treePruningTopX;
    const maxNodes = this.configFile.maxResultNodes;

    // Recommendation policy — must align mainPath ordering with the headline
    // score and backpropPolicy. For 'max' policy we report bestScore and rank
    // by it (with visits as tie-breaker to deprioritize lucky single rollouts);
    // for 'mean' policy we use the robust child criterion (most visits).
    const sortChildren = useMax
      ? (a: MCTSNode, b: MCTSNode) => (b.bestScore - a.bestScore) || (b.visits - a.visits)
      : (a: MCTSNode, b: MCTSNode) => b.visits - a.visits;
    const reportedScore = (n: MCTSNode): number =>
      useMax ? n.bestScore : (n.visits > 0 ? n.totalScore / n.visits : 0);

    // Shallow-create a DecisionNode without touching its children.
    const makeShallow = (mNode: MCTSNode, isRoot: boolean): DecisionNode => {
      const action: SolverAction = isRoot
        ? ROOT_ACTION
        : {
          responseIndex: mNode.action!.responseIndex,
          cardId: mNode.action!.cardId,
          cardName: mNode.cardName,
          actionDescription: mNode.actionDescription,
        };
      return {
        action,
        annotation: isRoot ? '' : `${mNode.cardName} — ${mNode.actionDescription}`,
        score: reportedScore(mNode),
        scoreBreakdown: mNode.scoreBreakdown,
        // Confidence = exploration share (visits / totalVisits). For max policy
        // it's a secondary signal; for mean policy it doubles as the recommendation
        // weight since sortChildren also ranks by visits.
        confidence: totalVisits > 0 ? mNode.visits / totalVisits : 0,
        children: [],
        isTerminal: mNode.isTerminal,
      };
    };

    // BFS tree conversion — every sibling gets a slot before we descend deeper,
    // avoiding the original DFS behavior where the first child's subtree could
    // exhaust the entire budget before later siblings were even visited.
    const tree = makeShallow(root, true);
    let nodeCount = 1;
    const queue: { mNode: MCTSNode; decision: DecisionNode }[] = [{ mNode: root, decision: tree }];

    while (queue.length > 0) {
      const { mNode, decision } = queue.shift()!;

      const sortedChildren = [...mNode.children].sort(sortChildren);
      const pruned = sortedChildren.length > topX ? sortedChildren.slice(0, topX) : sortedChildren;
      const prunedCount = sortedChildren.length - pruned.length;
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
      // siblings behind; matches the original defensive semantics.
      if (decision.children.length > 0) decision.isTerminal = false;
    }
    const mainPath = extractMainPath(tree, this.configFile.maxDepth);

    return {
      tree,
      mainPath,
      score: reportedScore(root),
      scoreBreakdown: this._bestTerminalScoreBreakdown ?? EMPTY_BREAKDOWN,
      endBoardCards,
      stats: this.buildStats(
        nodesExplored, startTime, maxDepthReached,
        totalChildren, totalBranchingNodes, abortedDueToFailures,
      ),
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private createRootNode(): MCTSNode {
    return {
      action: null,
      parent: null,
      children: [],
      visits: 0,
      totalScore: 0,
      bestScore: 0,
      score: 0,
      isTerminal: false,
      isExpanded: false,
      untriedActions: [],
      depth: 0,
      cardName: '',
      actionDescription: 'root',
    };
  }

  private buildStats(
    nodesExplored: number,
    startTime: number,
    maxDepthReached: number,
    totalChildren: number,
    totalBranchingNodes: number,
    abortedDueToFailures?: number,
  ): SolverStats {
    return {
      nodesExplored,
      elapsed: Date.now() - startTime,
      algorithm: 'mcts',
      algorithmUsed: 'mcts',
      maxDepthReached,
      averageBranchingFactor: totalBranchingNodes > 0
        ? totalChildren / totalBranchingNodes
        : 0,
      deckSeed: '',
      ...(abortedDueToFailures !== undefined ? { abortedDueToFailures } : {}),
    };
  }
}
