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
import { cloneEmptyBreakdown } from './solver-types.js';
import { ROOT_ACTION, extractMainPath } from './tree-utils.js';
import type { ZobristHash } from './zobrist.js';
import { ZobristHasher, hashToKey } from './zobrist.js';
import { TranspositionTable, buildVerificationKey } from './transposition-table.js';
import { InterruptionScorer } from './interruption-scorer.js';
import type { OCGCoreAdapter } from './ocgcore-adapter.js';
import { GoldfishChainRanker } from './goldfish-chain-ranker.js';

// =============================================================================
// Re-export tree-utils sentinels/walkers for backward-compat. New callers
// should import directly from `./tree-utils.js`.
// =============================================================================

export { ROOT_ACTION, extractMainPath } from './tree-utils.js';

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
      bestTurn1Score: -1,
      bestEndBoardCards: [],
      maxDepthReached: 0,
      totalChildren: 0,
      totalBranchingNodes: 0,
      totalTreeNodes: 0,
      totalLegalActions: 0,
      totalNodesWithActions: 0,
      maxBranchingFactor: 0,
      depthHistogram: new Array(this.maxDepth + 1).fill(0),
      depthCapHit: false,
      timedOut: false,
      lastProgressTime: startTime,
      terminalActionsZero: 0,
      terminalDepthCap: 0,
      terminalLoopDetected: 0,
      terminalTreeSizeLimit: 0,
      terminalAbortOrNodeLimit: 0,
      terminalBudgetCutoff: 0,
      terminalTtHit: 0,
      terminalTurn2: 0,
      promptTypeCounts: {},
      bfByDepthSum: new Array(this.maxDepth + 1).fill(0),
      bfByDepthCount: new Array(this.maxDepth + 1).fill(0),
      actionsZeroByDepth: new Array(this.maxDepth + 1).fill(0),
      actionsZeroSamples: [],
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

      // Termination reason precedence: depth_cap > timeout > aborted > completed.
      // depth_cap dominates because hitting the cap is a structural signal even
      // if the budget also expired — the user needs to know maxDepth is too low.
      const ttStats = this.table.getStats();
      const terminationReason: SolverStats['terminationReason'] = ctx.depthCapHit
        ? 'depth_cap'
        : ctx.timedOut
          ? 'timeout'
          : signal.aborted
            ? 'aborted'
            : 'completed';
      const truncated = ctx.depthCapHit || ctx.timedOut || signal.aborted;

      let stats: SolverStats = {
        nodesExplored: ctx.nodesExplored,
        elapsed,
        algorithm: 'dfs',
        algorithmUsed: 'dfs',
        maxDepthReached: ctx.maxDepthReached,
        averageBranchingFactor: ctx.totalNodesWithActions > 0
          ? ctx.totalLegalActions / ctx.totalNodesWithActions
          : 0,
        maxBranchingFactor: ctx.maxBranchingFactor,
        transpositionHits: ttStats.hits,
        transpositionMisses: ttStats.misses,
        transpositionStores: ttStats.stores,
        transpositionEvictions: ttStats.evictions,
        transpositionStaleHits: ttStats.staleHits,
        deckSeed: '',
        budgetMs: timeBudget,
        truncated,
        terminationReason,
        depthHistogram: ctx.depthHistogram,
        diagnostic: {
          terminalReasons: {
            actionsZero: ctx.terminalActionsZero,
            depthCap: ctx.terminalDepthCap,
            loopDetected: ctx.terminalLoopDetected,
            treeSizeLimit: ctx.terminalTreeSizeLimit,
            abortOrNodeLimit: ctx.terminalAbortOrNodeLimit,
            budgetCutoff: ctx.terminalBudgetCutoff,
            ttHit: ctx.terminalTtHit,
            turn2: ctx.terminalTurn2,
          },
          bestTurn1Score: ctx.bestTurn1Score,
          promptTypeCounts: ctx.promptTypeCounts,
          bfByDepthSum: ctx.bfByDepthSum,
          bfByDepthCount: ctx.bfByDepthCount,
          actionsZeroByDepth: ctx.actionsZeroByDepth,
          actionsZeroSamples: ctx.actionsZeroSamples,
        },
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
      ctx.terminalAbortOrNodeLimit++;
      return this.makeTerminal(ctx, handle, depth);
    }

    ctx.nodesExplored++;
    if (depth > ctx.maxDepthReached) ctx.maxDepthReached = depth;
    // Histogram: clamp to last bucket so out-of-range depths (shouldn't happen
    // since dfs early-returns at depth >= maxDepth, but defensive) still count.
    const bucket = depth < ctx.depthHistogram.length ? depth : ctx.depthHistogram.length - 1;
    ctx.depthHistogram[bucket]++;


    // Progress emission
    this.emitProgress(ctx);

    // Tree size safety net: force-terminal beyond maxResultNodes
    if (ctx.totalTreeNodes >= this.maxResultNodes) {
      ctx.terminalTreeSizeLimit++;
      return this.makeTerminal(ctx, handle, depth, true);
    }

    // Get legal actions — advances through mechanical/opponent prompts
    const actions = ctx.oracle.getLegalActions(handle);

    // Cache field state ONCE per node
    const fieldState = ctx.oracle.getFieldState(handle);
    // Story 1.8: also fetch the activation log so OPT-aware scoring and the
    // verification key both see the same per-handle OPT state.
    const activationLog = ctx.oracle.getActivationLog(handle);

    // Constraint 3.2-light: score every visited state, not just terminals.
    // Without this, `ctx.bestScore` only captures terminal scores, and
    // raising `maxDepth` can paradoxically *lower* the reported best score
    // because the deeper exploration passes through the optimal mid-combo
    // endboard state without ever freezing its value. Scoring every node
    // guarantees `ctx.bestScore` is monotone with respect to `maxDepth`
    // (more exploration can only ever find equal or better states).
    //
    // Mid-chain-resolution states (SELECT_CHAIN / SELECT_EFFECTYN) may
    // over-credit transient staging positions, but `ctx.bestScore` is a
    // `max`, so over-crediting an unreal state is safer than missing a
    // real terminal. Cost: ~15µs × nodes visited ≈ 10-15ms per solve.
    //
    // Constraint 3.2 full: `bestEndBoardCards` is gated to `turn <= 1` so
    // the reported endboard is the canonical end-of-turn-1 state, not a
    // post-combo or opponent-turn state where cards have cycled through.
    // `bestScore` stays ungated for observability. Round 5's peak-state
    // replay on Branded found every expected-board card present mid-combo
    // but absent from the mainPath terminal — the solver executes the
    // canonical line then walks past it. This gate freezes capture at the
    // right moment. See synthesis §7.10.4 / §7.10.6.
    const interim = this.scorer.scoreWithCards(fieldState, activationLog);
    this.updateBest(ctx, interim.score, interim.endBoardCards, fieldState.turn);

    // Constraint 3.2 full: virtual terminal at turn-2 entry. The solver's
    // search horizon is end-of-turn-1; exploring into opponent turn wastes
    // budget and has no validation signal (`matched` is measured against
    // turn-1 endboards). Score the turn-2 state for tree propagation so
    // branches that *reach* turn 2 still carry the interim score upward,
    // but stop exploring children.
    if (fieldState.turn >= 2) {
      ctx.terminalTurn2++;
      ctx.totalTreeNodes++;
      return {
        node: this.makeNode(ROOT_ACTION, interim.score, interim.scoreBreakdown, 1.0, [], true),
        score: interim.score,
        scoreBreakdown: interim.scoreBreakdown,
      };
    }

    // Terminal: no legal actions or max depth
    if (actions.length === 0 || depth >= this.maxDepth) {
      // Distinguish "natural end" (no actions) from "depth cap hit while
      // actions remained" — the latter is a truncation signal.
      if (actions.length > 0 && depth >= this.maxDepth) {
        ctx.depthCapHit = true;
        ctx.terminalDepthCap++;
      } else {
        ctx.terminalActionsZero++;
        if (depth < ctx.actionsZeroByDepth.length) ctx.actionsZeroByDepth[depth]++;
        // Sample the first 10 actionsZero terminals so we can diagnose
        // WHY OCGCore reports 0 legal actions (game ended vs stalemate
        // vs stuck mid-turn). Low cost, ultra-high diagnostic value.
        if (ctx.actionsZeroSamples.length < 10) {
          ctx.actionsZeroSamples.push({
            depth,
            phase: fieldState.phase,
            turn: fieldState.turn,
            lp0: fieldState.lifePoints[0],
            lp1: fieldState.lifePoints[1],
            handSize: fieldState.zones.HAND?.length ?? 0,
          });
        }
      }
      return this.scoreTerminal(ctx, fieldState, depth, undefined, activationLog);
    }

    // Record BF + prompt type now that we know this is a non-terminal node
    // with at least one legal action.
    if (depth < ctx.bfByDepthSum.length) {
      ctx.bfByDepthSum[depth] += actions.length;
      ctx.bfByDepthCount[depth]++;
    }
    const pt = actions[0].promptType;
    ctx.promptTypeCounts[pt] = (ctx.promptTypeCounts[pt] ?? 0) + 1;

    // BF accounting: record actions.length BEFORE any descent. This metric
    // is independent of how many children we actually explore, so it stays
    // unbiased under nodeLimit/time-budget cutoffs (probe mode in particular).
    ctx.totalLegalActions += actions.length;
    ctx.totalNodesWithActions++;
    if (actions.length > ctx.maxBranchingFactor) ctx.maxBranchingFactor = actions.length;

    // Zobrist hash for loop detection & transposition
    const hash = this.hasher.computeHash(fieldState);
    const hashKey = hashToKey(hash);

    // Loop detection is restricted to SELECT_IDLECMD prompts. Meta decks
    // (Snake-Eye, Dracotail, Mitsurugi, D/D/D) expose a cascade of chain
    // windows before the first Main Phase — several SELECT_CHAIN / YESNO /
    // EFFECTYN prompts for handtrap triggers, OPT checks, and effect
    // resolutions. Passing through these windows does NOT change the visible
    // FieldState (no card moves), so the Zobrist hash stays identical across
    // consecutive passes. Treating those as loops cuts the DFS off at
    // depth 2-4 before Main Phase is reached, producing the empty-endBoard
    // behaviour the validation harness surfaced (scores 0-48, mainPath 0-5,
    // endBoardCards=[] on all three meta decks).
    //
    // True infinite loops in OCG require an IDLECMD re-entry (e.g. Special
    // Summon → search → Special Summon → re-summon the same body), and those
    // still get caught because the IDLECMD prompt is where the path hash
    // is actually written. The transposition table still prunes revisits
    // of equivalent states globally (independent of path), so we do not
    // lose the big-O benefit of state deduplication.
    const promptType = actions[0].promptType;
    const isIdleCmd = promptType === 'SELECT_IDLECMD';
    if (isIdleCmd && pathHashes.has(hashKey)) {
      ctx.totalTreeNodes++;
      ctx.terminalLoopDetected++;
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
    // Transposition table is only consulted at SELECT_IDLECMD prompts. Chain
    // windows (SELECT_CHAIN, SELECT_YESNO, SELECT_EFFECTYN, ...) are not
    // uniquely determined by (fieldState, activationLog) — OCGCore has an
    // internal chain queue, effect resolution state, and per-window handtrap
    // availability that the solver never observes. On meta decks with a
    // turn-start handtrap cascade (Fuwalos/Maxx/Ash → pass → ...) every root
    // branch produces the SAME Zobrist hash at d=1 because the field is
    // unchanged, and a TT hit short-circuits subsequent branches with a
    // cached shallow score. The harness run showed this as "Mitsurugi DFS
    // completes in 1.2s at depth 3 with mainPath=2" — three of the four root
    // children were served cached results.
    //
    // Restricting TT to IDLECMD matches the pathHashes policy and preserves
    // deduplication at the real decision points (Main Phase branches).
    const vKey = buildVerificationKey(fieldState, activationLog);
    const ttEntry = isIdleCmd ? this.table.lookup(hash, vKey, depth) : null;
    if (ttEntry) {
      const matchedAction = actions.find(
        a => a.responseIndex === ttEntry.bestAction.responseIndex && a.promptType === ttEntry.bestAction.promptType,
      );
      if (matchedAction) {
        // Materialize one continuation level instead of returning a bare leaf.
        // Use the LIVE matched action (not the cached one) so its `_response`
        // points at the current handle's prompt, not the original snapshot.
        ctx.terminalTtHit++;
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

    // Explore children. Path-hash bookkeeping is only maintained for
    // SELECT_IDLECMD (see loop-detection comment above) — for chain-window
    // prompts we neither check nor record.
    if (isIdleCmd) pathHashes.add(hashKey);
    const children: { action: Action; result: DfsNodeResult }[] = [];
    let bestScore = -1;
    let bestAction: Action | undefined;
    let bestBreakdown: ScoreBreakdown | undefined;

    for (const action of ranked) {
      // Time budget check BEFORE fork
      if (Date.now() - ctx.startTime >= ctx.timeBudget) {
        ctx.timedOut = true;
        break;
      }

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
    if (isIdleCmd) pathHashes.delete(hashKey);

    if (children.length > 0) ctx.totalBranchingNodes++;

    // If no children were explored (abort + time budget), treat as terminal
    if (children.length === 0) {
      ctx.terminalBudgetCutoff++;
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

    // Mirror of the lookup gate: only cache at IDLECMD prompts, and only
    // positive scores. Chain-window entries are unreliable (see lookup
    // comment) and 0-score entries tend to be cheap shallow terminals
    // whose cache value is less than the contamination risk.
    if (isIdleCmd && bestAction && bestScore > 0) {
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
    this.updateBest(ctx, score, endBoardCards, fieldState.turn);

    return {
      node: this.makeNode(ROOT_ACTION, score, scoreBreakdown, truncated ? 0.5 : 1.0, [], true, truncated),
      score,
      scoreBreakdown,
    };
  }

  /**
   * Constraint 3.2 full: gated best-state update. `bestScore` tracks the
   * global max unconditionally (observability). `bestEndBoardCards` is
   * only captured for states where `turn <= 1`, so the reported endboard
   * reflects the canonical player-turn-1 peak rather than cycled
   * post-combo or opponent-turn states. See synthesis §7.10.6.
   */
  private updateBest(
    ctx: DfsContext,
    score: number,
    endBoardCards: EndBoardCard[],
    turn: number,
  ): void {
    if (score > ctx.bestScore) {
      ctx.bestScore = score;
    }
    if (turn <= 1 && score > ctx.bestTurn1Score) {
      ctx.bestTurn1Score = score;
      ctx.bestEndBoardCards = endBoardCards;
    }
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
      bestTurn1Score: -1,
      bestEndBoardCards: [],
      maxDepthReached: 0,
      totalChildren: 0,
      totalBranchingNodes: 0,
      totalTreeNodes: 0,
      totalLegalActions: 0,
      totalNodesWithActions: 0,
      maxBranchingFactor: 0,
      depthHistogram: new Array(this.maxDepth + 1).fill(0),
      depthCapHit: false,
      timedOut: false,
      lastProgressTime: startTime,
      terminalActionsZero: 0,
      terminalDepthCap: 0,
      terminalLoopDetected: 0,
      terminalTreeSizeLimit: 0,
      terminalAbortOrNodeLimit: 0,
      terminalBudgetCutoff: 0,
      terminalTtHit: 0,
      terminalTurn2: 0,
      promptTypeCounts: {},
      bfByDepthSum: new Array(this.maxDepth + 1).fill(0),
      bfByDepthCount: new Array(this.maxDepth + 1).fill(0),
      actionsZeroByDepth: new Array(this.maxDepth + 1).fill(0),
      actionsZeroSamples: [],
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
      maxBranchingFactor: ctx.maxBranchingFactor,
      depthHistogram: ctx.depthHistogram,
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

    // Element-wise sum the depth histogram. Probe and resume share the same
    // maxDepth so the arrays are the same length; defensive `Math.min` handles
    // any drift without throwing.
    const mergedHistogram = stats.depthHistogram.slice();
    const minLen = Math.min(mergedHistogram.length, probe.depthHistogram.length);
    for (let i = 0; i < minLen; i++) mergedHistogram[i] += probe.depthHistogram[i];

    return {
      ...stats,
      nodesExplored: stats.nodesExplored + probe.nodesExplored,
      maxDepthReached: Math.max(stats.maxDepthReached, probe.maxDepthReached),
      averageBranchingFactor: totalNodes > 0 ? totalActions / totalNodes : 0,
      maxBranchingFactor: Math.max(stats.maxBranchingFactor, probe.maxBranchingFactor),
      depthHistogram: mergedHistogram,
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
    return cloneEmptyBreakdown();
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
  /** Constraint 3.2 full: max score observed at any `turn <= 1` state.
   *  Gated companion to `bestScore` so that `bestEndBoardCards` reflects
   *  the canonical end-of-turn-1 peak rather than post-combo / opponent-turn
   *  cycling. `bestScore` stays as the unconditional global max for
   *  observability (diagnostic + progress emission). */
  bestTurn1Score: number;
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
  /** Worst-case BF (max actions.length seen at any single node). */
  maxBranchingFactor: number;
  /** Per-depth visit count for the depth histogram. Length = maxDepth + 1. */
  depthHistogram: number[];
  /** Set when at least one node was forced terminal because depth >= maxDepth
   *  while it still had legal actions to explore. Distinct from "ran out of
   *  actions naturally" which is the normal terminal path. */
  depthCapHit: boolean;
  /** Set when the per-node time-budget guard fired mid-exploration. */
  timedOut: boolean;
  lastProgressTime: number;
  nodeLimit?: number; // for probe mode
  /** Diagnostic counters for Exp 1-bis (empirical validation spike) — track
   *  WHY the search tree terminates where it does. Populated unconditionally
   *  (cost is negligible) and surfaced via SolverStats.diagnostic. */
  terminalActionsZero: number;
  terminalDepthCap: number;
  terminalLoopDetected: number;
  terminalTreeSizeLimit: number;
  terminalAbortOrNodeLimit: number;
  terminalBudgetCutoff: number;
  terminalTtHit: number;
  /** Constraint 3.2 full: nodes cut off because `fieldState.turn >= 2`.
   *  The solver's search horizon is end of player turn 1; reaching opponent
   *  turn is a virtual terminal. */
  terminalTurn2: number;
  promptTypeCounts: Record<string, number>;
  bfByDepthSum: number[];
  bfByDepthCount: number[];
  actionsZeroByDepth: number[];
  actionsZeroSamples: { depth: number; phase: string; turn: number; lp0: number; lp1: number; handSize: number }[];
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
  /** Phase A instrumentation: probe-side observability that needs to roll
   *  forward into the resumed solve's final stats. */
  maxBranchingFactor: number;
  depthHistogram: number[];
}
