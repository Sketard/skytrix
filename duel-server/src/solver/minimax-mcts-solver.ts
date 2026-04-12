// =============================================================================
// minimax-mcts-solver.ts — Minimax MCTS for adversarial mode. Assumes the
// opponent has ALL selected handtraps in hand and always activates optimally.
// No determinization, no subset sampling: a deterministic stress-test where
// the minimax score is the guaranteed worst-case against the configured
// handtraps. Two-player minimax backpropagation (player=max, opponent=min),
// epsilon-greedy rollouts with random-uniform opponent activation.
// =============================================================================

import type { GameOracle, DuelHandle } from './game-oracle.js';
import type { SolverStrategy, ActionRanker } from './solver-strategy.js';
import type {
  ActivationLog,
  Action,
  AdversarialTiming,
  DecisionNode,
  FieldState,
  HandtrapConfig,
  ScoreBreakdown,
  SolverAction,
  SolverConfig,
  SolverConfigFile,
  SolverProgress,
  SolverResult,
  SolverStats,
} from './solver-types.js';
import { cloneActivationLog, EMPTY_BREAKDOWN } from './solver-types.js';
import { MAX_CONSECUTIVE_FAILURES, buildMctsStats, bfsPruneAndTruncate } from './mcts-core.js';
import { solverAssert } from './solver-assert.js';
import type { InterruptionScorer } from './interruption-scorer.js';
import type { OCGCoreAdapter } from './ocgcore-adapter.js';
import { ROOT_ACTION } from './tree-utils.js';
import { Xoshiro128SS } from './prng.js';

// MAX_CONSECUTIVE_FAILURES is shared via mcts-core.ts

// =============================================================================
// MinimaxNode — Internal tree node with player tagging
// =============================================================================

interface MinimaxNode {
  action: Action | null;
  parent: MinimaxNode | null;
  children: MinimaxNode[];
  visits: number;
  totalScore: number;
  bestScore: number;
  worstScore: number;
  score: number;
  isTerminal: boolean;
  isExpanded: boolean;
  untriedActions: Action[];
  depth: number;
  cardName: string;
  actionDescription: string;
  scoreBreakdown?: ScoreBreakdown;
  /** 0 = player (maximizer), 1 = opponent (minimizer). Root defaults to 0. */
  player: 0 | 1;
  /** On opponent nodes only: total number of legal actions (activations + pass)
   *  the opponent could choose from at this window. Surfaced to the UI so the
   *  user can see "chose among N" when more than 1. */
  alternativeCount?: number;
  /** Set on a parent node when its next expansion enumerated an opponent
   *  SELECT_CHAIN — counts how many options the opponent was offered. Each
   *  child created from this enumeration inherits it as `alternativeCount`. */
  childrenAlternativeCount?: number;
}

// =============================================================================
// MinimaxMctsSolver
// =============================================================================

export class MinimaxMctsSolver implements SolverStrategy {
  readonly name = 'minimax-mcts';
  readonly supportsAdversarial = true;

  private readonly scorer: InterruptionScorer;
  private readonly adapter: OCGCoreAdapter;
  private readonly ranker: ActionRanker;
  private readonly configFile: SolverConfigFile;

  private _seed: bigint[] = [1n];

  // Best terminal state tracking
  private _bestTerminalScore = -Infinity;
  private _bestTerminalFieldState: FieldState | undefined;
  private _bestTerminalScoreBreakdown: ScoreBreakdown | undefined;
  private _bestTerminalActivationLog: ActivationLog | undefined;

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

  setSeed(seed: bigint[]): void {
    this._seed = seed.length > 0 ? seed : [1n];
  }

  // ===========================================================================
  // Solve — Minimax MCTS main loop (no determinization)
  // ===========================================================================

  solve(
    oracle: GameOracle,
    config: SolverConfig,
    signal: AbortSignal,
    onProgress: (progress: SolverProgress) => void,
    startHandle?: DuelHandle,
  ): SolverResult {
    if (!startHandle) throw new Error('[Solver] MinimaxMctsSolver requires startHandle');

    const prng = new Xoshiro128SS(this._seed);
    const handtraps = config.handtraps ?? [];

    // Reset per-solve state
    this._bestTerminalScore = -Infinity;
    this._bestTerminalFieldState = undefined;
    this._bestTerminalScoreBreakdown = undefined;
    this._bestTerminalActivationLog = undefined;

    const root = this.createRootNode();

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

        // 1. Selection
        const selected = this.select(root, handle, oracle);

        // 2. Expansion
        const expanded = this.expand(selected, handle, oracle);

        if (expanded !== selected && expanded.parent) {
          const parent = expanded.parent;
          if (parent.children.length === 1) totalBranchingNodes++;
          totalChildren++;
        }

        // 3. Simulation
        const { rolloutScore, maxDepth } = this.simulate(expanded, handle, oracle, prng);
        if (maxDepth > maxDepthReached) maxDepthReached = maxDepth;

        // 4. Backpropagation (minimax)
        this.backpropagate(expanded, rolloutScore);

        nodesExplored++;
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        console.warn(
          `[Solver] Minimax MCTS iteration failed (consecutive=${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
          err,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`[Solver] Minimax MCTS aborted after ${consecutiveFailures} consecutive failures`);
          abortedDueToFailures = consecutiveFailures;
          break;
        }
        continue;
      } finally {
        if (handle) oracle.destroyDuel(handle);
      }

      // Progress
      const now = Date.now();
      if (nodesExplored % 100 === 0 || now - lastProgressTime > 200) {
        onProgress({
          nodesExplored,
          bestScore: root.bestScore,
          elapsed: now - startTime,
        });
        lastProgressTime = now;
      }

      if (abortedDueToFailures !== undefined) break;
    }

    return this.buildResult(
      root, nodesExplored, startTime, maxDepthReached,
      totalChildren, totalBranchingNodes, handtraps, abortedDueToFailures,
    );
  }

  // ===========================================================================
  // UCB1 Selection — minimax-aware
  // ===========================================================================

  private select(node: MinimaxNode, handle: DuelHandle, oracle: GameOracle): MinimaxNode {
    let current = node;

    while (current.isExpanded && !current.isTerminal && current.children.length > 0) {
      const C = this.configFile.ucb1C;
      const lnParentVisits = Math.log(current.visits);
      let bestUcb = -Infinity;
      let bestChild: MinimaxNode | null = null;

      for (const child of current.children) {
        // UCB1 exploitation uses average reward for stable convergence.
        // Minimax (bestScore/worstScore) is kept for backprop & result only.
        const exploitation = child.visits === 0
          ? 0
          : child.totalScore / child.visits;
        const exploration = child.visits === 0
          ? Infinity
          : C * Math.sqrt(lnParentVisits / child.visits);

        // Minimax level is determined by the CHILDREN's player, not the
        // parent's. current.player = who acted to REACH this node, but we
        // need to know who acts FROM here (= children's player).
        const isMinLevel = child.player === 1;
        const ucb = isMinLevel
          ? -exploitation + exploration
          : exploitation + exploration;

        if (ucb > bestUcb) {
          bestUcb = ucb;
          bestChild = child;
        }
      }

      if (!bestChild) break;

      oracle.getLegalActions(handle);
      oracle.applyAction(handle, bestChild.action!);
      current = bestChild;
    }

    return current;
  }

  // ===========================================================================
  // Ranker helper
  // ===========================================================================

  private rankIfNeeded(actions: Action[], handle: DuelHandle, oracle: GameOracle): Action[] {
    if (this.ranker.needsState(actions[0].promptType)) {
      return this.ranker.rank(actions, oracle.getFieldState(handle));
    }
    return actions;
  }

  // ===========================================================================
  // Expansion
  // ===========================================================================

  private expand(node: MinimaxNode, handle: DuelHandle, oracle: GameOracle): MinimaxNode {
    if (node.isTerminal) return node;

    if (!node.isExpanded && node.untriedActions.length === 0) {
      const actions = oracle.getLegalActions(handle);
      if (actions.length === 0) {
        node.isTerminal = true;
        node.isExpanded = true;
        return node;
      }

      // Determine if these are opponent actions
      const isOpponent = actions[0].team === 1;

      // Player actions get ranked; opponent actions are kept as-is (all
      // handtraps are always available — no subset filtering).
      const ranked: Action[] = isOpponent
        ? actions
        : this.rankIfNeeded(actions, handle, oracle);

      if (ranked.length === 0) {
        node.isTerminal = true;
        node.isExpanded = true;
        return node;
      }

      node.untriedActions = ranked;
      // Remember opponent branching size so every child expanded from this
      // enumeration carries the same alternativeCount (surfaced to the UI).
      if (isOpponent) node.childrenAlternativeCount = ranked.length;
    }

    if (node.untriedActions.length === 0) {
      node.isExpanded = true;
      return node;
    }

    const action = node.untriedActions.shift()!;
    const enriched = this.adapter.enrichAction(action);
    const player = action.team ?? 0;

    const child: MinimaxNode = {
      action,
      parent: node,
      children: [],
      visits: 0,
      totalScore: 0,
      bestScore: 0,
      worstScore: Infinity,
      score: 0,
      isTerminal: false,
      isExpanded: false,
      untriedActions: [],
      depth: node.depth + 1,
      cardName: enriched.cardName,
      actionDescription: enriched.actionDescription,
      player,
      ...(player === 1 && node.childrenAlternativeCount !== undefined
        ? { alternativeCount: node.childrenAlternativeCount }
        : {}),
    };

    node.children.push(child);

    if (node.untriedActions.length === 0) {
      node.isExpanded = true;
    }

    oracle.applyAction(handle, action);
    return child;
  }

  // ===========================================================================
  // Epsilon-Greedy Rollout — random-uniform opponent activation
  // ===========================================================================

  private simulate(
    node: MinimaxNode,
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

      const isOpponent = actions[0].team === 1;

      let action: Action;
      if (isOpponent) {
        // Random-uniform among activations (unbiased w.r.t. OCGCore's internal
        // ordering of the opponent's hand). If no activation is legal, pass.
        // The true minimax still emerges from MCTS selection + backprop; the
        // rollout policy just needs to be unbiased and cheap.
        const activations = actions.filter(a => a.actionTag !== 'pass');
        if (activations.length > 0) {
          action = activations[Math.floor(prng.next() * activations.length)];
        } else {
          action = actions.find(a => a.actionTag === 'pass') ?? actions[0];
        }
      } else {
        // Player: epsilon-greedy with ranker
        const ranked = this.rankIfNeeded(actions, handle, oracle);
        action = prng.next() < epsilon
          ? ranked[Math.floor(prng.next() * ranked.length)]
          : ranked[0];
      }

      oracle.applyAction(handle, action);
      depth++;
    }

    const finalState = oracle.getFieldState(handle);
    const finalLog = cloneActivationLog(oracle.getActivationLog(handle));
    const { score, scoreBreakdown } = this.scorer.score(finalState, finalLog);

    if (score > this._bestTerminalScore) {
      this._bestTerminalScore = score;
      this._bestTerminalFieldState = finalState;
      this._bestTerminalScoreBreakdown = scoreBreakdown;
      this._bestTerminalActivationLog = finalLog;
    }

    return { rolloutScore: score, maxDepth: depth };
  }

  // ===========================================================================
  // Minimax Backpropagation
  // ===========================================================================

  private backpropagate(node: MinimaxNode, score: number): void {
    let current: MinimaxNode | null = node;

    while (current !== null) {
      current.visits++;
      current.totalScore += score;
      current.bestScore = Math.max(current.bestScore, score);
      current.worstScore = Math.min(current.worstScore, score);

      // Player nodes: max. Opponent nodes: min.
      current.score = current.player === 1
        ? current.worstScore
        : current.bestScore;

      current = current.parent;
    }
  }

  // ===========================================================================
  // Build Result
  // ===========================================================================

  private buildResult(
    root: MinimaxNode,
    nodesExplored: number,
    startTime: number,
    maxDepthReached: number,
    totalChildren: number,
    totalBranchingNodes: number,
    handtraps: HandtrapConfig[],
    abortedDueToFailures?: number,
  ): SolverResult {
    let endBoardCards = undefined;
    if (this._bestTerminalFieldState) {
      endBoardCards = this.scorer.scoreWithCards(
        this._bestTerminalFieldState,
        this._bestTerminalActivationLog,
      ).endBoardCards;
    }

    // Empty result guard
    if (root.children.length === 0) {
      const hasBest = this._bestTerminalScore > -Infinity;
      return {
        tree: {
          action: ROOT_ACTION,
          annotation: '',
          score: hasBest ? this._bestTerminalScore : 0,
          scoreBreakdown: this._bestTerminalScoreBreakdown ?? EMPTY_BREAKDOWN,
          confidence: 0,
          children: [],
          isTerminal: true,
        },
        mainPath: [],
        score: hasBest ? this._bestTerminalScore : 0,
        scoreBreakdown: this._bestTerminalScoreBreakdown ?? EMPTY_BREAKDOWN,
        endBoardCards,
        minimax: hasBest ? this._bestTerminalScore : 0,
        stats: this.buildStats(nodesExplored, startTime, maxDepthReached, 0, 0, abortedDueToFailures),
      };
    }

    const totalVisits = root.visits;
    const maxNodes = this.configFile.maxResultNodes;
    const topX = this.configFile.treePruningTopX;

    // Build handtrap name lookup
    const handtrapNames = new Map<number, string>();
    for (const h of handtraps) handtrapNames.set(h.cardId, h.cardName);

    // Sort: player nodes DESC by bestScore, opponent nodes ASC by worstScore
    const sortChildren = (parent: MinimaxNode) =>
      (a: MinimaxNode, b: MinimaxNode) => {
        if (parent.player === 1) {
          // Opponent's children are player nodes — sort DESC
          return (b.bestScore - a.bestScore) || (b.visits - a.visits);
        }
        // Player's children: if opponent nodes, sort ASC (worst-case first)
        if (a.player === 1 && b.player === 1) {
          return (a.worstScore - b.worstScore) || (b.visits - a.visits);
        }
        // Default: DESC by bestScore
        return (b.bestScore - a.bestScore) || (b.visits - a.visits);
      };

    const makeShallow = (mNode: MinimaxNode, isRoot: boolean): DecisionNode => {
      const action: SolverAction = isRoot
        ? ROOT_ACTION
        : {
          responseIndex: mNode.action!.responseIndex,
          cardId: mNode.action!.cardId,
          cardName: mNode.cardName,
          actionDescription: mNode.actionDescription,
        };

      // Generate handtrapLabel for opponent activations
      let handtrapLabel: string | undefined;
      if (!isRoot && mNode.player === 1 && mNode.action && mNode.action.actionTag !== 'pass') {
        const htName = handtrapNames.get(mNode.action.cardId) ?? mNode.cardName;
        const parentDesc = mNode.parent?.action
          ? `${mNode.parent.cardName} — ${mNode.parent.actionDescription}`
          : 'unknown';
        handtrapLabel = `${htName} — chains to ${parentDesc}`;
      }

      return {
        action,
        annotation: isRoot ? '' : `${mNode.cardName} — ${mNode.actionDescription}`,
        score: mNode.player === 1 ? mNode.worstScore : mNode.bestScore,
        scoreBreakdown: mNode.scoreBreakdown,
        confidence: totalVisits > 0 ? mNode.visits / totalVisits : 0,
        children: [],
        isTerminal: mNode.isTerminal,
        ...(handtrapLabel ? { handtrapLabel } : {}),
        ...(mNode.alternativeCount !== undefined ? { alternativeCount: mNode.alternativeCount } : {}),
      };
    };

    // BFS tree conversion via shared helper (same one SP-MCTS uses).
    // Opponent-parent nodes get ASC sort via sortChildren(parent); everything
    // else DESC. Walker preserves the minimax sort invariant.
    const tree = makeShallow(root, true);
    bfsPruneAndTruncate<MinimaxNode>({
      root,
      tree,
      getChildren: n => n.children,
      sortChildren,
      makeShallow,
      maxNodes,
      topX,
    });

    // Single walk produces BOTH mainPath (player-only) AND adversarialTimings,
    // using the same min/max direction as `buildResult`'s sortChildren. The
    // previous implementation used `extractMainPath(tree)` (which included
    // opponent nodes, breaking verify) + a separate `extractAdversarialTimings`
    // walk that inverted min/max via `current.player` instead of
    // `children[0].player`. Both bugs collapsed into one correct walk here.
    const { mainPath, adversarialTimings } = this.walkRecommendedPath(root, handtrapNames);

    // Minimax score is the root's score (minimax emerges from backpropagation)
    const minimax = root.score;

    return {
      tree,
      mainPath,
      score: root.bestScore,
      scoreBreakdown: this._bestTerminalScoreBreakdown ?? EMPTY_BREAKDOWN,
      endBoardCards,
      minimax,
      adversarialTimings: adversarialTimings.length > 0 ? adversarialTimings : undefined,
      stats: this.buildStats(
        nodesExplored, startTime, maxDepthReached,
        totalChildren, totalBranchingNodes, abortedDueToFailures,
      ),
    };
  }

  // ===========================================================================
  // Walk the recommended (children[0]-after-sort) chain once, producing BOTH
  // the player-only mainPath AND the adversarialTimings parallel structure.
  //
  // Direction rule (mirrors buildResult sortChildren): the chooser FROM current
  // is determined by children[0].player (all children share one actor). When
  // children are opponent-reached (player=1) the opponent minimizes worstScore;
  // when they are player-reached (player=0) the player maximizes bestScore.
  //
  // Output contract:
  // - mainPath contains player actions ONLY (opponent activations AND opponent
  //   passes are omitted). The verifier at `solver-worker.ts verifyAdversarialPath`
  //   expects this — it advances pathIndex exclusively on player prompts.
  // - adversarialTimings records opponent activations with stepIndex = number
  //   of player actions already applied when the opponent fires. Matches the
  //   verifier's playerStepIndex counter.
  // ===========================================================================

  private walkRecommendedPath(
    root: MinimaxNode,
    handtrapNames: Map<number, string>,
  ): { mainPath: SolverAction[]; adversarialTimings: AdversarialTiming[] } {
    const mainPath: SolverAction[] = [];
    const adversarialTimings: AdversarialTiming[] = [];
    let playerStepIndex = 0;
    let current: MinimaxNode = root;
    let guard = this.configFile.maxDepth;

    while (current.children.length > 0 && guard-- > 0) {
      // All siblings at one level share the same actor (one getLegalActions
      // call, one team). Read from children[0] — not from current.player.
      const childrenPlayer = current.children[0].player;

      // Invariant: all children MUST share the same player. Fires if
      // expand() somehow mixed player and opponent actions at one node
      // (would only happen if getLegalActions returned mixed-team actions
      // for a single prompt, which is structurally impossible — but if
      // it ever does, the min/max walk is wrong and timings corrupt).
      solverAssert(
        current.children.every(c => c.player === childrenPlayer),
        'MinimaxMctsSolver.walkRecommendedPath',
        'mixed-team children at one node — expand/getLegalActions contract broken',
        { depth: current.depth, childCount: current.children.length },
      );

      let best: MinimaxNode;
      if (childrenPlayer === 1) {
        // Opponent chooses: minimize worstScore (matches buildResult ASC sort).
        // Tie-break on visits (more visits = more confidence).
        best = current.children.reduce((a, b) => {
          if (a.worstScore !== b.worstScore) return a.worstScore < b.worstScore ? a : b;
          return a.visits >= b.visits ? a : b;
        });
      } else {
        // Player chooses: maximize bestScore (matches buildResult DESC sort).
        best = current.children.reduce((a, b) => {
          if (a.bestScore !== b.bestScore) return a.bestScore > b.bestScore ? a : b;
          return a.visits >= b.visits ? a : b;
        });
      }

      if (best.player === 0 && best.action) {
        // Player action → mainPath. stepIndex increments AFTER push so the
        // next opponent window sees the correct count of prior player moves.
        mainPath.push({
          responseIndex: best.action.responseIndex,
          cardId: best.action.cardId,
          cardName: best.cardName,
          actionDescription: best.actionDescription,
        });
        playerStepIndex++;
      } else if (best.player === 1 && best.action && best.action.actionTag !== 'pass') {
        // Opponent activation → timing entry, NOT mainPath.
        adversarialTimings.push({
          stepIndex: playerStepIndex,
          handtrapCardId: best.action.cardId,
          handtrapCardName: handtrapNames.get(best.action.cardId) ?? best.cardName,
          responseIndex: best.action.responseIndex,
        });
      }
      // Opponent pass: silent traversal, neither mainPath nor timing.

      current = best;
    }

    if (process.env['LOG_LEVEL'] === 'debug') {
      console.log('[Solver:minimax] walkRecommendedPath', {
        mainPathLen: mainPath.length,
        mainPath: mainPath.map(a => `${a.cardName}#${a.responseIndex}`),
        timings: adversarialTimings.map(t => `step${t.stepIndex}:${t.handtrapCardName}#${t.responseIndex}`),
        rootBestScore: root.bestScore,
        rootScore: root.score,
      });
    }

    return { mainPath, adversarialTimings };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private createRootNode(): MinimaxNode {
    return {
      action: null,
      parent: null,
      children: [],
      visits: 0,
      totalScore: 0,
      bestScore: 0,
      worstScore: Infinity,
      score: 0,
      isTerminal: false,
      isExpanded: false,
      untriedActions: [],
      depth: 0,
      cardName: '',
      actionDescription: 'root',
      player: 0,
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
    return buildMctsStats({
      algorithm: 'mcts',
      algorithmUsed: 'minimax-mcts',
      nodesExplored, startTime, maxDepthReached,
      totalChildren, totalBranchingNodes, abortedDueToFailures,
    });
  }
}
