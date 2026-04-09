// =============================================================================
// dfs-solver.ts — Depth-first search solver strategy
// Explores all legal game actions to find optimal combo paths in goldfish mode.
// =============================================================================

import type { GameOracle, DuelHandle } from './game-oracle.js';
import type { SolverStrategy, ActionRanker } from './solver-strategy.js';
import type {
  ActivationLog,
  Action,
  DecisionNode,
  EndBoardCard,
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
      bestEndBoardCards: [],
      maxDepthReached: 0,
      totalChildren: 0,
      totalBranchingNodes: 0,
      totalTreeNodes: 0,
      totalLegalActions: 0,
      totalNodesWithActions: 0,
      lastProgressTime: startTime,
    };

    try {
      // Skip TT reset when resuming from probe — TT already populated
      if (!this._probeStats) {
        this.table.reset();
      }
      if ('resetWarnFlag' in this.ranker) (this.ranker as GoldfishChainRanker).resetWarnFlag();

      const pathHashes = new Set<string>();
      const result = this.dfs(ctx, startHandle, 0, pathHashes);

      const mainPath = this.extractMainPath(result.node);
      const elapsed = Date.now() - startTime;

      let stats: SolverStats = {
        nodesExplored: ctx.nodesExplored,
        elapsed,
        algorithm: 'dfs',
        algorithmUsed: 'dfs',
        maxDepthReached: ctx.maxDepthReached,
        averageBranchingFactor: ctx.totalNodesWithActions > 0
          ? ctx.totalLegalActions / ctx.totalNodesWithActions
          : 0,
        transpositionHits: this.table.getStats().hits,
        deckSeed: '',
      };

      // Merge probe stats if resuming from probe
      stats = this.mergeProbeStats(stats);

      return {
        tree: result.node,
        mainPath,
        score: result.score,
        scoreBreakdown: result.scoreBreakdown,
        endBoardCards: ctx.bestEndBoardCards,
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
    // Abort check + node limit (probe mode)
    if (ctx.signal.aborted || (ctx.nodeLimit !== undefined && ctx.nodesExplored >= ctx.nodeLimit)) {
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
    // Story 1.8: also fetch the activation log so OPT-aware scoring and the
    // verification key both see the same per-handle OPT state.
    const activationLog = ctx.oracle.getActivationLog(handle);

    // Terminal: no legal actions or max depth
    if (actions.length === 0 || depth >= this.maxDepth) {
      return this.scoreTerminal(ctx, fieldState, depth, undefined, activationLog);
    }

    // BF accounting: record actions.length BEFORE any descent. This metric
    // is independent of how many children we actually explore, so it stays
    // unbiased under nodeLimit/time-budget cutoffs (probe mode in particular).
    ctx.totalLegalActions += actions.length;
    ctx.totalNodesWithActions++;

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

    // Transposition lookup. Story 1.8: the verification key includes the
    // activation log so OPT-divergent states (same board, different OPT
    // consumption) do not collide in the TT.
    //
    // C3 fix from Epic 1 review: when a TT entry hits, materialize ONE level
    // of continuation by re-applying `bestAction` and recursing once. The
    // pre-fix code returned an empty leaf with `ROOT_ACTION` placeholder,
    // which broke `extractMainPath()` — any optimal line passing through a
    // TT hit was silently truncated at the hit point. The user-visible
    // breadcrumb / decision tree showed combos cut short with no warning.
    //
    // Materializing one level is enough because the recursive call into
    // `dfs(child, depth+1, ...)` will itself walk the cached subtree (or hit
    // another TT entry deeper, which materializes another level — cascading
    // until the line is fully reconstructed). Cost: 1 fork+apply per TT hit
    // on the chosen line, negligible compared to normal exploration.
    const vKey = buildVerificationKey(fieldState, activationLog);
    const ttEntry = this.table.lookup(hash, vKey, depth);
    if (ttEntry) {
      const matchedAction = actions.find(
        a => a.responseIndex === ttEntry.bestAction.responseIndex && a.promptType === ttEntry.bestAction.promptType,
      );
      if (matchedAction) {
        // Materialize one continuation level instead of returning a bare leaf.
        // Use the LIVE matched action (not the cached one) so its `_response`
        // points at the current handle's prompt, not the original snapshot.
        const child = ctx.oracle.fork(handle);
        try {
          ctx.oracle.applyAction(child, matchedAction);
          const continuation = this.dfs(ctx, child, depth + 1, pathHashes);
          ctx.totalTreeNodes++;
          // Wrap the continuation as the SOLE child of the TT-hit node so
          // `extractMainPath` can keep walking. Confidence stays at 0.5 to
          // signal that this subtree is a partial reconstruction.
          const childNode: DecisionNode = {
            ...continuation.node,
            action: this.adapter.enrichAction(matchedAction),
          };
          return {
            node: this.makeNode(ROOT_ACTION, ttEntry.score, ttEntry.scoreBreakdown, 0.5, [childNode], false),
            score: ttEntry.score,
            scoreBreakdown: ttEntry.scoreBreakdown,
          };
        } finally {
          ctx.oracle.destroyDuel(child);
        }
      }
      this.table.recordStaleHit();
    }

    // Action ranking — the ranker owns its own prompt list via needsState().
    // fieldState is already computed above for the zobrist hash, so passing
    // it here is free regardless.
    let ranked = actions;
    if (actions.length > 0 && this.ranker.needsState(actions[0].promptType)) {
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
      return this.scoreTerminal(ctx, fieldState, depth, undefined, activationLog);
    }

    // Sort children by score descending
    children.sort((a, b) => b.result.score - a.result.score);

    // Build decision node
    const childNodes: DecisionNode[] = children.map(c => ({
      ...c.result.node,
      action: this.adapter.enrichAction(c.action),
    }));

    ctx.totalTreeNodes++;
    // Confidence = fraction of legal actions actually explored before
    // abort/budget cutoff. 1.0 means exhaustive (top child is provably best);
    // lower values reflect how much of the action space remains unexplored,
    // so consumers can distinguish "90% explored" from "10% explored".
    const confidence = ranked.length > 0 ? children.length / ranked.length : 1.0;

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
    const activationLog = ctx.oracle.getActivationLog(handle);
    return this.scoreTerminal(ctx, fieldState, depth, truncated, activationLog);
  }

  private scoreTerminal(
    ctx: DfsContext,
    fieldState: FieldState,
    _depth: number,
    truncated?: boolean,
    activationLog?: ActivationLog,
  ): DfsNodeResult {
    const { score, scoreBreakdown, endBoardCards } = this.scorer.scoreWithCards(fieldState, activationLog);
    ctx.totalTreeNodes++;
    if (score > ctx.bestScore) {
      ctx.bestScore = score;
      ctx.bestEndBoardCards = endBoardCards;
    }

    return {
      node: this.makeNode(ROOT_ACTION, score, scoreBreakdown, truncated ? 0.5 : 1.0, [], true, truncated),
      score,
      scoreBreakdown,
    };
  }

  // ===========================================================================
  // Probe — 100-node DFS for auto-detection BF measurement (Task 8.4)
  // ===========================================================================

  /**
   * Runs a bounded DFS (nodeLimit nodes) to measure branching factor for
   * auto-detection. Called only by the worker's dispatch path.
   *
   * SIDE EFFECT: Resets the shared transposition table before traversal.
   * Callers must treat the probe as destructive to any previously cached
   * TT state. The subsequent solve() (if resuming via resumeFromProbe)
   * skips its own reset to preserve probe entries.
   */
  probe(
    oracle: GameOracle,
    config: SolverConfig,
    signal: AbortSignal,
    nodeLimit: number,
    startHandle: DuelHandle,
  ): ProbeResult {
    const startTime = Date.now();
    const ctx: DfsContext = {
      oracle,
      signal,
      onProgress: () => {},
      startTime,
      timeBudget: config.timeLimitMs,
      nodesExplored: 0,
      bestScore: -1,
      bestEndBoardCards: [],
      maxDepthReached: 0,
      totalChildren: 0,
      totalBranchingNodes: 0,
      totalTreeNodes: 0,
      totalLegalActions: 0,
      totalNodesWithActions: 0,
      lastProgressTime: startTime,
      nodeLimit,
    };

    // Reset TT for clean probe. The resumed solve() skips its own TT reset
    // (via _probeStats check) so probe entries are preserved for resume.
    this.table.reset();
    if ('resetWarnFlag' in this.ranker) (this.ranker as GoldfishChainRanker).resetWarnFlag();

    const pathHashes = new Set<string>();
    this.dfs(ctx, startHandle, 0, pathHashes);

    return {
      averageBranchingFactor: ctx.totalNodesWithActions > 0
        ? ctx.totalLegalActions / ctx.totalNodesWithActions
        : 0,
      bestScore: ctx.bestScore,
      nodesExplored: ctx.nodesExplored,
      // H5 fix from Epic 1 review: expose the raw aggregates so the resumed
      // solve can roll the probe contribution into ALL stats fields, not just
      // nodesExplored.
      maxDepthReached: ctx.maxDepthReached,
      totalLegalActions: ctx.totalLegalActions,
      totalNodesWithActions: ctx.totalNodesWithActions,
    };
  }

  // ===========================================================================
  // Resume from probe — continue DFS with preserved TT (Task 8.5)
  // ===========================================================================

  private _probeStats: ProbeResult | null = null;

  resumeFromProbe(probeResult: ProbeResult): void {
    this._probeStats = probeResult;
  }

  // Merge probe stats when resuming. H5 fix from Epic 1 review: previously
  // only nodesExplored was rolled in, leaving maxDepth/BF post-probe-only —
  // observability drift. Now all aggregates merge:
  //   - nodesExplored: sum
  //   - maxDepthReached: max
  //   - averageBranchingFactor: weighted average over the two phases
  //
  // transpositionHits intentionally stays post-probe — the probe populates
  // the TT and the resumed solve's hit count is the meaningful metric for
  // "did the probe entries help downstream exploration".
  private mergeProbeStats(stats: SolverStats): SolverStats {
    if (!this._probeStats) return stats;
    const probe = this._probeStats;
    this._probeStats = null;

    // Reconstruct a weighted-average BF. The resume's raw aggregates aren't
    // exposed on SolverStats, so we approximate `resumeActions ≈ resumeBF *
    // resumeNodes` — accurate enough for observability since the resume's
    // node count dwarfs the probe's ~100 nodes.
    const resumeNodes = stats.nodesExplored;
    const resumeActions = stats.averageBranchingFactor * resumeNodes;
    const totalNodes = probe.totalNodesWithActions + resumeNodes;
    const totalActions = probe.totalLegalActions + resumeActions;

    return {
      ...stats,
      nodesExplored: stats.nodesExplored + probe.nodesExplored,
      maxDepthReached: Math.max(stats.maxDepthReached, probe.maxDepthReached),
      averageBranchingFactor: totalNodes > 0 ? totalActions / totalNodes : 0,
    };
  }

  // ===========================================================================
  // Main Path Extraction (delegates to free function)
  // ===========================================================================

  private extractMainPath(root: DecisionNode): SolverAction[] {
    return extractMainPath(root, this.maxDepth);
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
      bounce: 0, handRip: 0, sendToGy: 0,
      weighted: 0, fallbackPoints: 0, total: 0,
    };
  }
}

// =============================================================================
// extractMainPath — Public free function for top-K extraction by workers
// =============================================================================

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
  bestEndBoardCards: EndBoardCard[];
  maxDepthReached: number;
  totalChildren: number;
  totalBranchingNodes: number;
  totalTreeNodes: number;
  /** Sum of `actions.length` across every node that enumerated legal actions.
   *  Used for an unbiased branching-factor estimate (independent of how many
   *  children were actually descended into — important for nodeLimit probes). */
  totalLegalActions: number;
  totalNodesWithActions: number;
  lastProgressTime: number;
  nodeLimit?: number; // for probe mode
}

// =============================================================================
// ProbeResult — Returned by DfsSolver.probe() for auto-detection
// =============================================================================

export interface ProbeResult {
  averageBranchingFactor: number;
  bestScore: number;
  nodesExplored: number;
  /** H5 fix from Epic 1 review: probe contributions for full stat merging
   *  in `mergeProbeStats` (not just nodesExplored). */
  maxDepthReached: number;
  totalLegalActions: number;
  totalNodesWithActions: number;
}
