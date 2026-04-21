// =============================================================================
// mcts-solver.ts — Single-Player Monte Carlo Tree Search solver strategy
// Uses UCB1 selection, epsilon-greedy rollout with GoldfishChainRanker,
// and max backpropagation for goldfish combo solving.
// =============================================================================

import type { GameOracle, DuelHandle } from './game-oracle.js';
import type { SolverStrategy, ActionRanker } from './solver-strategy.js';
import type {
  ActivationLog,
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
import { cloneActivationLog, EMPTY_BREAKDOWN } from './solver-types.js';
import { MAX_CONSECUTIVE_FAILURES, buildMctsStats, bfsPruneAndTruncate, type MctsMetrics } from './mcts-core.js';
import { solverAssert } from './solver-assert.js';
import type { InterruptionScorer } from './interruption-scorer.js';
import type { OCGCoreAdapter } from './ocgcore-adapter.js';
import { extractMainPath, ROOT_ACTION } from './tree-utils.js';
import { Xoshiro128SS } from './prng.js';

// MAX_CONSECUTIVE_FAILURES is shared via mcts-core.ts

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
  // Story 1.8: snapshot of the activation log at the best terminal so the
  // result builder can render the same OPT-aware end board the rollout saw.
  private _bestTerminalActivationLog: ActivationLog | undefined;

  constructor(
    scorer: InterruptionScorer,
    adapter: OCGCoreAdapter,
    ranker: ActionRanker,
    configFile: SolverConfigFile,
  ) {
    if (!scorer) throw new Error('[Solver] MCTSSolver requires InterruptionScorer');
    if (!adapter) throw new Error('[Solver] MCTSSolver requires OCGCoreAdapter');
    if (!ranker) throw new Error('[Solver] MCTSSolver requires ActionRanker');
    if (!configFile) throw new Error('[Solver] MCTSSolver requires SolverConfigFile');
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
    this._bestTerminalActivationLog = undefined;

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
    const metrics: MctsMetrics = {
      maxBranchingFactor: 0,
      depthHistogram: new Array(this.configFile.maxDepth + 1).fill(0),
      depthCapHit: false,
    };
    let consecutiveFailures = 0;
    let abortedDueToFailures: number | undefined;

    if (process.env['LOG_LEVEL'] === 'debug') {
      console.log('[Solver:mcts] solve-start', {
        seed: this._seed.map(String),
        timeLimitMs: config.timeLimitMs,
        warmStart: root.bestScore,
      });
    }

    // Reserve verification budget
    const solveBudgetMs = config.timeLimitMs * (1 - this.configFile.verificationBudgetRatio);

    while (!signal.aborted && (Date.now() - startTime) < solveBudgetMs) {
      let handle: DuelHandle | undefined;
      try {
        handle = oracle.fork(startHandle);

        // 1. Selection — traverse tree using UCB1, applying actions on handle
        const selected = this.select(root, handle, oracle);

        // 2. Expansion — expand one untried action
        const expanded = this.expand(selected, handle, oracle, metrics);

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
        const { rolloutScore, maxDepth } = this.simulate(expanded, handle, oracle, prng, metrics);
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

    // Termination reason precedence: depth_cap > failures > timeout > aborted > completed.
    // depth_cap dominates because hitting the cap is a structural signal even
    // if other budgets also expired — the user needs to know maxDepth is too low.
    const elapsed = Date.now() - startTime;
    const terminationReason: SolverStats['terminationReason'] = metrics.depthCapHit
      ? 'depth_cap'
      : abortedDueToFailures !== undefined
        ? 'failures'
        : elapsed >= solveBudgetMs
          ? 'timeout'
          : signal.aborted
            ? 'aborted'
            : 'completed';
    const truncated = metrics.depthCapHit
      || abortedDueToFailures !== undefined
      || elapsed >= solveBudgetMs
      || signal.aborted;

    // NOTE: do NOT destroy startHandle — the worker owns it
    return this.buildResult(
      root, nodesExplored, startTime, maxDepthReached,
      totalChildren, totalBranchingNodes, metrics, solveBudgetMs,
      truncated, terminationReason, abortedDueToFailures,
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

      // Invariant: selected child must have been visited at least once.
      // Unvisited children force-select via Infinity UCB and always
      // backpropagate before the next select pass, so visits >= 1 when
      // we reach here. A failure means expand() returned a child without
      // calling simulate/backpropagate — C5-class regression.
      solverAssert(
        bestChild.visits >= 1,
        'MCTSSolver.select',
        'selected child has zero visits — expand/simulate/backprop cycle broken',
        { cardName: bestChild.cardName, depth: bestChild.depth },
      );

      // Drain the duel to its next WAITING state BEFORE applying the next
      // response. OCGCore requires the strict pattern
      // `duelProcess → WAITING → setResponse → duelProcess → WAITING → ...`.
      // Calling two `setResponse` in a row without an intervening `duelProcess`
      // overwrites the buffered response — only the last one survives, and
      // the tree-walk position diverges from the actual game state. The fix
      // is to call `getLegalActions` (which internally drives `duelProcess`
      // to the next prompt) between consecutive applies. The returned actions
      // array is intentionally discarded — we already know which child to
      // descend into, we just need the side effect of the duel advancing.
      oracle.getLegalActions(handle);
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

  private expand(node: MCTSNode, handle: DuelHandle, oracle: GameOracle, metrics: MctsMetrics): MCTSNode {
    if (node.isTerminal) return node;

    // First visit: populate untried actions
    if (!node.isExpanded && node.untriedActions.length === 0) {
      const actions = oracle.getLegalActions(handle);
      if (actions.length === 0) {
        node.isTerminal = true;
        node.isExpanded = true;
        return node;
      }
      // Worst-case BF observed pre-ranking — rank can reorder but not add legal
      // actions, so the raw count is the truthful explosion-point signal.
      if (actions.length > metrics.maxBranchingFactor) metrics.maxBranchingFactor = actions.length;
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

    // Histogram bookkeeping: a new child = a new node visited at child.depth.
    // Defensive bucket clamp; child.depth should never exceed maxDepth here
    // because expansion only fires from non-terminal nodes < maxDepth.
    const bucket = child.depth < metrics.depthHistogram.length
      ? child.depth
      : metrics.depthHistogram.length - 1;
    metrics.depthHistogram[bucket]++;

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
    metrics: MctsMetrics,
  ): { rolloutScore: number; maxDepth: number } {
    let depth = node.depth;
    const maxDepth = this.configFile.maxDepth;
    const epsilon = this.configFile.rolloutEpsilon;
    let lastActionsLen = 0;

    // Turn-1 gate (2026-04-21): mirror DFS's virtual-terminal-at-turn-2
    // semantics. Without this, rollouts continue into opponent's turn 2
    // where Mitsurugi quick-effects + opp-turn triggers inflate weighted/
    // fallback scores vs the turn-1 endboard DFS caps at. Fixture
    // validation measures turn-1 only; MCTS must match that scope.
    //
    // Strategy: snapshot the last turn-1 state observed during the rollout.
    // When turn flips to 2, break and score the snapshot instead of the
    // turn-2 state. If rollout never observes a turn-1 state (pathological
    // case — root already at turn 2), fall back to final state.
    let lastTurn1State: FieldState | undefined;
    let lastTurn1Log: ActivationLog | undefined;

    while (depth < maxDepth) {
      const actions = oracle.getLegalActions(handle);
      lastActionsLen = actions.length;
      if (actions.length === 0) break;

      const fieldState = oracle.getFieldState(handle);
      if (fieldState.turn >= 2) {
        // Opponent's turn entered — stop rollout; score the captured turn-1 state.
        break;
      }
      lastTurn1State = fieldState;
      lastTurn1Log = oracle.getActivationLog(handle);

      const ranked = this.ranker.needsState(actions[0].promptType)
        ? this.ranker.rank(actions, fieldState)
        : actions;

      // Epsilon-greedy: (1-ε) best, ε random
      const action = prng.next() < epsilon
        ? ranked[Math.floor(prng.next() * ranked.length)]
        : ranked[0];

      oracle.applyAction(handle, action);
      depth++;
    }

    // depth_cap signal: rollout exited because we hit `maxDepth` while there
    // were still legal actions to play. A natural exit (actions.length === 0)
    // is normal terminal — only the gated case is truncation.
    if (depth >= maxDepth && lastActionsLen > 0) metrics.depthCapHit = true;

    // Turn-1 gate: use the snapshotted turn-1 state when available;
    // otherwise fall back to the current handle state (rollout never saw
    // turn-1, either because root was already turn-2 or because oracle
    // failed to emit actions at the root). Log is cloned only for the
    // chosen state — avoids cloning on every rollout step.
    const stateForScoring = lastTurn1State ?? oracle.getFieldState(handle);
    const logForScoring = cloneActivationLog(lastTurn1Log ?? oracle.getActivationLog(handle));
    const { score, scoreBreakdown } = this.scorer.score(stateForScoring, logForScoring);

    // Track best terminal globally (Task 5.4)
    if (score > this._bestTerminalScore) {
      this._bestTerminalScore = score;
      this._bestTerminalFieldState = stateForScoring;
      this._bestTerminalScoreBreakdown = scoreBreakdown;
      this._bestTerminalActivationLog = logForScoring;
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
    metrics: MctsMetrics,
    budgetMs: number,
    truncated: boolean,
    terminationReason: SolverStats['terminationReason'],
    abortedDueToFailures?: number,
  ): SolverResult {
    const useMax = this.configFile.backpropPolicy !== 'mean';

    // endBoardCards from best terminal (shared by empty + populated paths)
    // Story 1.8: pass the snapshotted activation log so consumed-uses badges
    // appear on the rendered end board.
    let endBoardCards = undefined;
    if (this._bestTerminalFieldState) {
      endBoardCards = this.scorer.scoreWithCards(
        this._bestTerminalFieldState,
        this._bestTerminalActivationLog,
      ).endBoardCards;
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
        stats: this.buildStats(
          nodesExplored, startTime, maxDepthReached, 0, 0,
          metrics, budgetMs, truncated, terminationReason, abortedDueToFailures,
        ),
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

    // BFS tree conversion via shared helper — every sibling gets a slot before
    // we descend, avoiding the original DFS behavior where the first child's
    // subtree could exhaust the budget before siblings were visited.
    const tree = makeShallow(root, true);
    bfsPruneAndTruncate<MCTSNode>({
      root,
      tree,
      getChildren: n => n.children,
      sortChildren: () => sortChildren,
      makeShallow,
      maxNodes,
      topX,
    });

    const mainPath = extractMainPath(tree, this.configFile.maxDepth);

    if (process.env['LOG_LEVEL'] === 'debug') {
      console.log('[Solver:mcts] solve-end', {
        nodesExplored,
        elapsedMs: Date.now() - startTime,
        bestScore: reportedScore(root),
        mainPathLen: mainPath.length,
        maxDepthReached,
        abortedDueToFailures,
      });
    }

    return {
      tree,
      mainPath,
      score: reportedScore(root),
      scoreBreakdown: this._bestTerminalScoreBreakdown ?? EMPTY_BREAKDOWN,
      endBoardCards,
      stats: this.buildStats(
        nodesExplored, startTime, maxDepthReached,
        totalChildren, totalBranchingNodes,
        metrics, budgetMs, truncated, terminationReason, abortedDueToFailures,
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
    metrics: MctsMetrics,
    budgetMs: number,
    truncated: boolean,
    terminationReason: SolverStats['terminationReason'],
    abortedDueToFailures?: number,
  ): SolverStats {
    return buildMctsStats({
      algorithm: 'mcts',
      algorithmUsed: 'mcts',
      nodesExplored, startTime, maxDepthReached,
      totalChildren, totalBranchingNodes,
      maxBranchingFactor: metrics.maxBranchingFactor,
      depthHistogram: metrics.depthHistogram,
      budgetMs, truncated, terminationReason,
      abortedDueToFailures,
    });
  }
}
