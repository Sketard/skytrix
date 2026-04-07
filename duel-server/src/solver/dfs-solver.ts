// =============================================================================
// dfs-solver.ts — Depth-first search solver strategy
// Explores all legal game actions to find optimal combo paths in goldfish mode.
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
import type { ZobristHash } from './zobrist.js';
import { ZobristHasher, hashToKey } from './zobrist.js';
import { TranspositionTable, buildVerificationKey } from './transposition-table.js';
import { InterruptionScorer } from './interruption-scorer.js';
import type { OCGCoreAdapter } from './ocgcore-adapter.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';

// =============================================================================
// Constants
// =============================================================================

export const ROOT_ACTION: SolverAction = {
  responseIndex: -1,
  cardId: 0,
  cardName: '',
  actionDescription: 'root',
};

// =============================================================================
// Internal Types
// =============================================================================

interface DfsNodeResult {
  node: DecisionNode;
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

// =============================================================================
// DfsSolver
// =============================================================================

export class DfsSolver implements SolverStrategy {
  readonly name = 'dfs';
  readonly supportsAdversarial = false;

  private readonly hasher: ZobristHasher;
  private readonly table: TranspositionTable;
  private readonly scorer: InterruptionScorer;
  private readonly adapter: OCGCoreAdapter;
  private readonly ranker: ActionRanker;
  private readonly maxDepth: number;
  private readonly maxResultNodes: number;
  private readonly verificationBudgetRatio: number;

  constructor(
    hasher: ZobristHasher,
    table: TranspositionTable,
    scorer: InterruptionScorer,
    adapter: OCGCoreAdapter,
    ranker?: ActionRanker,
    config?: SolverConfigFile,
  ) {
    if (!hasher) throw new Error('[Solver] DfsSolver requires ZobristHasher');
    if (!table) throw new Error('[Solver] DfsSolver requires TranspositionTable');
    if (!scorer) throw new Error('[Solver] DfsSolver requires InterruptionScorer');
    if (!adapter) throw new Error('[Solver] DfsSolver requires OCGCoreAdapter');

    this.hasher = hasher;
    this.table = table;
    this.scorer = scorer;
    this.adapter = adapter;
    this.ranker = ranker ?? new GoldfishChainRanker();
    this.maxDepth = config?.maxDepth ?? 50;
    this.maxResultNodes = config?.maxResultNodes ?? 500;
    this.verificationBudgetRatio = config?.verificationBudgetRatio ?? 0.15;
  }

  solve(
    oracle: GameOracle,
    config: SolverConfig,
    signal: AbortSignal,
    onProgress: (progress: SolverProgress) => void,
    startHandle?: DuelHandle,
  ): SolverResult {
    if (!startHandle) throw new Error('[Solver] DfsSolver requires startHandle');

    const timeBudget = config.timeLimitMs * (1 - this.verificationBudgetRatio);
    const startTime = Date.now();

    // Shared mutable state for DFS traversal
    const ctx: DfsContext = {
      oracle,
      signal,
      onProgress,
      startTime,
      timeBudget,
      nodesExplored: 0,
      bestScore: -1,
      maxDepthReached: 0,
      totalChildren: 0,
      totalBranchingNodes: 0,
      totalTreeNodes: 0,
      lastProgressTime: startTime,
    };

    try {
      this.table.reset();
      if ('resetWarnFlag' in this.ranker) (this.ranker as GoldfishChainRanker).resetWarnFlag();

      const pathHashes = new Set<string>();
      const result = this.dfs(ctx, startHandle, 0, pathHashes);

      const mainPath = this.extractMainPath(result.node);
      const elapsed = Date.now() - startTime;

      const stats: SolverStats = {
        nodesExplored: ctx.nodesExplored,
        elapsed,
        algorithm: 'dfs',
        algorithmUsed: 'dfs',
        maxDepthReached: ctx.maxDepthReached,
        averageBranchingFactor: ctx.totalBranchingNodes > 0
          ? ctx.totalChildren / ctx.totalBranchingNodes
          : 0,
        transpositionHits: this.table.getStats().hits,
        deckSeed: '',
      };

      return {
        tree: result.node,
        mainPath,
        score: result.score,
        scoreBreakdown: result.scoreBreakdown,
        stats,
      };
    } finally {
      oracle.destroyAll();
    }
  }

  // ===========================================================================
  // Recursive DFS
  // ===========================================================================

  private dfs(
    ctx: DfsContext,
    handle: DuelHandle,
    depth: number,
    pathHashes: Set<string>,
  ): DfsNodeResult {
    // Abort check
    if (ctx.signal.aborted) {
      return this.makeTerminal(ctx, handle, depth);
    }

    ctx.nodesExplored++;
    if (depth > ctx.maxDepthReached) ctx.maxDepthReached = depth;

    // Progress emission
    this.emitProgress(ctx);

    // Tree size safety net: force-terminal beyond maxResultNodes
    if (ctx.totalTreeNodes >= this.maxResultNodes) {
      return this.makeTerminal(ctx, handle, depth, true);
    }

    // Get legal actions — advances through mechanical/opponent prompts
    const actions = ctx.oracle.getLegalActions(handle);

    // Cache field state ONCE per node
    const fieldState = ctx.oracle.getFieldState(handle);

    // Terminal: no legal actions or max depth
    if (actions.length === 0 || depth >= this.maxDepth) {
      return this.scoreTerminal(ctx, fieldState, depth);
    }

    // Zobrist hash for loop detection & transposition
    const hash = this.hasher.computeHash(fieldState);
    const hashKey = hashToKey(hash);

    // Loop detection: same state on current path
    if (pathHashes.has(hashKey)) {
      ctx.totalTreeNodes++;
      return {
        node: this.makeNode(ROOT_ACTION, 0, undefined, 1.0, [], true),
        score: 0,
        scoreBreakdown: this.emptyBreakdown(),
      };
    }

    // Transposition lookup
    const vKey = buildVerificationKey(fieldState);
    const ttEntry = this.table.lookup(hash, vKey, depth);
    if (ttEntry) {
      const bestActionInLegal = actions.some(
        a => a.responseIndex === ttEntry.bestAction.responseIndex && a.promptType === ttEntry.bestAction.promptType
      );
      if (bestActionInLegal) {
        ctx.totalTreeNodes++;
        return {
          node: this.makeNode(ROOT_ACTION, ttEntry.score, ttEntry.scoreBreakdown, 0.5, [], false),
          score: ttEntry.score,
          scoreBreakdown: ttEntry.scoreBreakdown,
        };
      }
      this.table.recordStaleHit();
    }

    // Action ranking for SELECT_CHAIN and SELECT_BATTLECMD
    let ranked = actions;
    if (actions.length > 0 && (actions[0].promptType === 'SELECT_CHAIN' || actions[0].promptType === 'SELECT_BATTLECMD')) {
      ranked = this.ranker.rank(actions, fieldState);
    }

    // Explore children
    pathHashes.add(hashKey);
    const children: { action: Action; result: DfsNodeResult }[] = [];
    let bestScore = -1;
    let bestAction: Action | undefined;
    let bestBreakdown: ScoreBreakdown | undefined;

    for (const action of ranked) {
      // Time budget check BEFORE fork
      if (Date.now() - ctx.startTime >= ctx.timeBudget) break;

      // Abort check
      if (ctx.signal.aborted) break;

      const child = ctx.oracle.fork(handle);
      try {
        ctx.oracle.applyAction(child, action);
        const result = this.dfs(ctx, child, depth + 1, pathHashes);

        children.push({ action, result });
        ctx.totalChildren++;

        if (result.score > bestScore) {
          bestScore = result.score;
          bestAction = action;
          bestBreakdown = result.scoreBreakdown;
        }
      } finally {
        ctx.oracle.destroyDuel(child);
      }
    }
    pathHashes.delete(hashKey);

    if (children.length > 0) ctx.totalBranchingNodes++;

    // If no children were explored (abort + time budget), treat as terminal
    if (children.length === 0) {
      return this.scoreTerminal(ctx, fieldState, depth);
    }

    // Sort children by score descending
    children.sort((a, b) => b.result.score - a.result.score);

    // Build decision node
    const childNodes: DecisionNode[] = children.map(c => ({
      ...c.result.node,
      action: this.adapter.enrichAction(c.action),
    }));

    ctx.totalTreeNodes++;
    const allExplored = children.length === ranked.length && !ctx.signal.aborted;
    const confidence = allExplored ? 1.0 : 0.5;

    // Store in transposition table
    if (bestAction) {
      this.table.store(hash, depth, bestScore, bestAction, vKey, bestBreakdown ?? this.emptyBreakdown());
    }

    return {
      node: this.makeNode(ROOT_ACTION, bestScore, bestBreakdown, confidence, childNodes, false),
      score: bestScore,
      scoreBreakdown: bestBreakdown ?? this.emptyBreakdown(),
    };
  }

  // ===========================================================================
  // Terminal Scoring
  // ===========================================================================

  private makeTerminal(ctx: DfsContext, handle: DuelHandle, depth: number, truncated?: boolean): DfsNodeResult {
    const fieldState = ctx.oracle.getFieldState(handle);
    return this.scoreTerminal(ctx, fieldState, depth, truncated);
  }

  private scoreTerminal(ctx: DfsContext, fieldState: FieldState, _depth: number, truncated?: boolean): DfsNodeResult {
    const { score, scoreBreakdown } = this.scorer.score(fieldState);
    ctx.totalTreeNodes++;
    if (score > ctx.bestScore) ctx.bestScore = score;

    return {
      node: this.makeNode(ROOT_ACTION, score, scoreBreakdown, truncated ? 0.5 : 1.0, [], true, truncated),
      score,
      scoreBreakdown,
    };
  }

  // ===========================================================================
  // Main Path Extraction
  // ===========================================================================

  private extractMainPath(root: DecisionNode): SolverAction[] {
    if (root.children.length === 0) return [];

    const path: SolverAction[] = [];
    let current = root;
    let guard = this.maxDepth;

    while (current.children.length > 0 && guard-- > 0) {
      const next = current.children[0];
      // Skip ROOT_ACTION sentinel (identified by its unique actionDescription)
      if (next.action.actionDescription !== ROOT_ACTION.actionDescription) {
        path.push(next.action);
      }
      current = next;
    }

    return path;
  }

  // ===========================================================================
  // Progress Emission
  // ===========================================================================

  private emitProgress(ctx: DfsContext): void {
    const now = Date.now();
    if (ctx.nodesExplored % 100 === 0 || now - ctx.lastProgressTime > 200) {
      ctx.onProgress({
        nodesExplored: ctx.nodesExplored,
        bestScore: ctx.bestScore,
        elapsed: now - ctx.startTime,
      });
      ctx.lastProgressTime = now;
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private makeNode(
    action: SolverAction,
    score: number,
    scoreBreakdown: ScoreBreakdown | undefined,
    confidence: number,
    children: DecisionNode[],
    isTerminal: boolean,
    truncated?: boolean,
  ): DecisionNode {
    return {
      action,
      annotation: '',
      score,
      scoreBreakdown,
      confidence,
      children,
      isTerminal,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  private emptyBreakdown(): ScoreBreakdown {
    return {
      omniNegate: 0, typedNegate: 0, targetedNegate: 0, floodgate: 0,
      controlChange: 0, banish: 0, banishFacedown: 0, attach: 0,
      spin: 0, flipFacedown: 0, destruction: 0, moveToSt: 0,
      bounce: 0, handRip: 0, sendToGy: 0, total: 0,
    };
  }
}

// =============================================================================
// DFS Context — shared mutable state for traversal
// =============================================================================

interface DfsContext {
  oracle: GameOracle;
  signal: AbortSignal;
  onProgress: (progress: SolverProgress) => void;
  startTime: number;
  timeBudget: number;
  nodesExplored: number;
  bestScore: number;
  maxDepthReached: number;
  totalChildren: number;
  totalBranchingNodes: number;
  totalTreeNodes: number;
  lastProgressTime: number;
}
