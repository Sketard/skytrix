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
import { time as instrumentTime } from './solver-instrumentation.js';

// =============================================================================
// Re-export tree-utils sentinels/walkers for backward-compat. New callers
// should import directly from `./tree-utils.js`.
// =============================================================================

export { ROOT_ACTION, extractMainPath } from './tree-utils.js';

// =============================================================================
// Phase I — branch-and-bound pruning tunable
// =============================================================================

/** Max plausible score gain per remaining ply, used by the branch-and-bound
 *  pruning check to decide whether a subtree can possibly exceed the current
 *  `ctx.bestTurn1ExplorationScore`. Calibrated conservatively (~2× the empirical average
 *  gain of productive plies) to minimize false pruning. A higher value
 *  prunes less but preserves more exploration; a lower value prunes more
 *  aggressively at the risk of cutting legitimate late peaks.
 *
 *  Default 3 was empirically validated on D/D/D / Mitsurugi / Branded at
 *  60s budget — raise to 5+ if a fixture matched-count regresses, lower
 *  to 2 to tighten the cut window once alpha-beta-friendly move ordering
 *  is in place. */
const BRANCH_BOUND_RECOVERY_PER_PLY = 1.5;

// =============================================================================
// Phase L — per-subtree soft budget guard tunables
// =============================================================================

/** Fraction of the global solve `timeBudget` that any single first-level
 *  (depth==0) root-child branch is allowed to stall without producing a
 *  new `bestTurn1ExplorationScore` peak. Once a branch has gone `rootChildBudgetMs`
 *  milliseconds without any strict improvement to the turn-1 peak, nodes
 *  in that subtree early-return so the DFS unwinds and moves on to the
 *  next root child. The clock is sliding (reset on every peak update
 *  inside the branch — see `branchLastPeakTime`) — NOT a fixed "elapsed
 *  since branch start" window.
 *
 *  Applied against `timeBudget` (the solve-level deadline), NOT
 *  `ctx.timeBudget` which is re-scoped per iteration under Phase K
 *  iterative deepening.
 *
 *  Calibration: **45% of timeBudget**, empirically tuned against the D/D/D
 *  `ddd-pendulum-opener` fixture at 60s / d=50:
 *  - **35% (≈18s window)**: D/D/D **regressed 34 → 6** (55 rootChildBudgetCut
 *    fires). NS-first has a "late-climb" segment where the peak plateaus
 *    for ≈18-20s between intermediate latent bonuses and the final fusion
 *    chain peak. An 18s stall window is inside that plateau.
 *  - **40% (≈20.4s window)**: D/D/D held 34 with zero cuts — the plateau
 *    is under 20.4s.
 *  - **45% (≈22.95s window)**: D/D/D held 34 with zero cuts; ≈5s margin
 *    above the empirical plateau ceiling. Mitsurugi / Branded both fired
 *    cuts (72 / 34 / 35) without score regression. **Shipped value.**
 *  - **50%+**: zero regression but progressively less useful for future
 *    Phase J-on-L variants (Gate-first subtree would be given too long
 *    before being cut).
 *
 *  If a future fixture regresses, raise this fraction BEFORE lowering any
 *  of the calibrations above — the floor is "the longest peak-update
 *  plateau on any fixture in this budget". */
const ROOT_CHILD_BUDGET_FRACTION = 0.45;

/** Phase L — the guard uses a sliding "time since last peak improvement"
 *  clock rather than a fixed "elapsed since branch start" window. The
 *  clock resets on every strict improvement of `ctx.bestTurn1ExplorationScore` while
 *  inside a tracked root-child branch; the guard fires only if the clock
 *  has been running without reset for longer than `ctx.rootChildBudgetMs`.
 *
 *  This is critical for depth-bound combos (e.g. D/D/D NS-first, which
 *  climbs 0 → 34 in many small latent-bonus + final-boss-fusion increments
 *  over the full 51s budget). A fixed "16.8s since branch start" window
 *  would cut NS-first around step 27/43 because the score hasn't yet
 *  reached its final peak at that point. The sliding clock lets NS-first
 *  continue as long as it keeps discovering new peaks (even small +1-2
 *  bumps), while still cutting Gate-first after it has stalled without
 *  any improvement for the allotted window. */

// =============================================================================
// Internal Types
// =============================================================================

interface DfsNodeResult {
  node: DecisionNode;
  /** DFS-internal guidance signal (methodology v5). Drives `children.sort`,
   *  α-β pruning, `bestScore > result.score` comparisons. User-facing grade
   *  is derived from `scoreBreakdown.interruptionScore` at the top-level
   *  `reportScore` extraction — not from this field. */
  explorationScore: number;
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
    this.ranker = ranker ?? new GoldfishChainRanker(adapter.getTags());
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
      bestExplorationScore: -1,
      bestTurn1ExplorationScore: -1,
      bestEndBoardCards: [],
      bestTurn1Breakdown: cloneEmptyBreakdown(),
      currentActionStack: [],
      bestTurn1Path: undefined,
      bestTurn1FieldState: undefined,
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
      terminalBranchBoundCut: 0,
      terminalRootChildBudgetCut: 0,
      rootChildBudgetMs: Math.floor(timeBudget * ROOT_CHILD_BUDGET_FRACTION),
      rootChildBudgetNodes: config.rootChildBudgetNodes,
      canonicalPath: config.canonicalPath,
      bannedCardIds: config.bannedCardIds && config.bannedCardIds.length > 0
        ? new Set(config.bannedCardIds)
        : undefined,
      currentRootChildStart: undefined,
      branchLastPeakTime: undefined,
      branchLastPeakNodes: undefined,
      iterationMaxDepth: this.maxDepth,
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

      // Phase K — iterative deepening. Run a shallow DFS pass first to
      // establish a `bestTurn1ExplorationScore` floor, then a full pass that benefits
      // from Phase I branch-bound pruning against that floor. The TT is
      // cleared BETWEEN iterations because this solver's TT semantics
      // (`entry.depth >= currentDepth` for hits, with `depth` = depth-from-
      // root) treat cached scores as authoritative, not as bounds. Leaving
      // shallow-iteration entries in the table poisons deep-iteration
      // lookups — the deep search receives the shallow score as the answer
      // and never re-explores. Empirically verified on D/D/D: TT-persistent
      // iterative deepening regressed 34→10 because the deep iteration hit
      // cached shallow scores at every shared state. Clearing between
      // iterations costs the warm-cache benefit but preserves correctness
      // and keeps the primary goal — `ctx.bestTurn1ExplorationScore` floor — which
      // accumulates naturally in ctx fields (not TT).
      //
      // First attempt capped at `ceil(maxDepth/2)`; final pass uses the
      // full `this.maxDepth`. Each iteration runs until the global time
      // budget expires, at which point the outer loop bails and the best
      // result across completed iterations is reported.
      //
      // Motivation: Phase 2.1 / Phase J combo-enabler ranker promotion
      // regressed catastrophically (D/D/D 27→3 and 34→7) because the
      // Gate subtree was explored first and consumed all budget before
      // the NS-first line could run. With iterative deepening, the
      // shallow pass reaches NS-first's partial peak FAST (even if the
      // final combo state isn't hit), setting a non-trivial floor. The
      // deep pass then has that floor available when exploring Gate-first
      // branches, and Phase I pruning trims dead Gate sub-branches early.
      const iterationDepths = [
        Math.max(10, Math.ceil(this.maxDepth / 2)),
        this.maxDepth,
      ];
      // Phase K — budget split. The shallow iteration gets a small slice
      // (20% of total) because it only needs to establish a bestTurn1ExplorationScore
      // floor, not find the full peak. Deep iteration receives the
      // remainder. Without this split, the shallow iteration (whose own
      // search tree is still large at d=25) consumes the entire global
      // budget and the deep iteration never runs. Empirically observed
      // on D/D/D: without budget split, deep iteration got ~1s and
      // never reached depth>25, collapsing score 34→10.
      const shallowBudgetMs = Math.floor(timeBudget * 0.2);
      // Save the original ctx.timeBudget so we can restore it for the
      // deep iteration. ctx.timeBudget is consumed by the per-node time
      // check inside `dfs()` (line 635).
      const originalCtxBudget = ctx.timeBudget;
      let lastResultNode: DecisionNode | null = null;
      let lastResultExplorationScore = 0;
      let lastResultBreakdown: ScoreBreakdown = cloneEmptyBreakdown();
      for (let i = 0; i < iterationDepths.length; i++) {
        // Global budget guard — don't start a new iteration if time's up.
        if (Date.now() - startTime >= timeBudget) break;
        if (signal.aborted) break;

        ctx.iterationMaxDepth = iterationDepths[i];
        // Per-iteration time budget: shallow capped to `shallowBudgetMs`,
        // deep gets the full original budget (= up to the global deadline).
        ctx.timeBudget = i === 0 ? shallowBudgetMs : originalCtxBudget;
        // Per-iteration state reset:
        // - currentActionStack: push/pop discipline is symmetric under
        //   try/finally, so it's always empty at the end of a completed
        //   iteration. Reset defensively in case of mid-iteration abort.
        // - depthCapHit: only the FINAL iteration's depth-cap signal
        //   belongs in the termination reason (shallow always caps by
        //   design). Reset before the last iteration to avoid spurious
        //   'depth_cap' labels.
        // - TT: cleared BEFORE non-first iteration (see phase comment
        //   above — shallow-iteration entries poison the deep lookup).
        // - totalTreeNodes: reset BEFORE non-first iteration. The tree-cap
        //   check (`totalTreeNodes >= maxResultNodes`) force-terminalizes
        //   every new node once the cap is reached. Since `lastResultNode`
        //   is overwritten per-iteration (only the deep iter's tree is
        //   returned), the cap should be scoped per-iteration. Without
        //   this reset, a shallow iter that fills the cap (e.g. Snake-Eye
        //   Yummy at 594 nodes ≥ 500 cap) starves the deep iter — it sees
        //   `totalTreeNodes` already ≥ cap and immediately returns a
        //   terminal at depth 0. Produces 'completed' termination at ~5s
        //   on a 60s budget with depth stuck at shallow's max.
        // - branchLastPeakNodes: reset to undefined for coherence with
        //   the tree-nodes reset. Re-seeded on first root-child entry.
        // NOT reset: bestTurn1ExplorationScore/Path/FieldState (accumulate — that's
        // the whole point), nodesExplored / histograms / counters
        // (accumulate for stats).
        ctx.currentActionStack = [];
        if (i === iterationDepths.length - 1) ctx.depthCapHit = false;
        if (i > 0) {
          this.table.reset();
          ctx.totalTreeNodes = 0;
          ctx.branchLastPeakNodes = undefined;
        }

        // Fresh handle per iteration. The adapter's `runUntilPlayerPrompt`
        // consumes engine messages on its first call, so calling it twice
        // on the same DuelHandle returns an empty action list on the
        // second call (messages already drained). `fork()` doesn't help
        // because it pre-advances the engine past the first WAITING
        // prompt, which corrupts the subsequent runUntilPlayerPrompt
        // invocation. `cloneFromConfig` creates a handle identical to a
        // fresh `createDuel(config)` call — the DFS then drives the
        // advance via its own getLegalActions call as normal.
        //
        // Cost: one extra createDuel per iteration (negligible vs total
        // DFS walltime). startHandle is left in whatever state the DFS
        // put it in; since we only use it as a config source, that's OK.
        const iterHandle = this.adapter.cloneFromConfig(startHandle);
        try {
          const pathHashes = new Set<string>();
          const iterResult = this.dfs(ctx, iterHandle, 0, pathHashes);
          lastResultNode = iterResult.node;
          lastResultExplorationScore = iterResult.explorationScore;
          lastResultBreakdown = iterResult.scoreBreakdown;
        } finally {
          ctx.oracle.destroyDuel(iterHandle);
        }
      }

      // Phase H — mainPath prefers `ctx.bestTurn1Path` (exact replay to peak
      // state) over the old `extractMainPath` tree walk, which drifts into
      // arbitrary post-peak tied branches due to Phase F-bis v2 ancestor-
      // chain score propagation. Fallback to extractMainPath only when no
      // turn<=1 state was ever visited (pathological — shouldn't happen in
      // normal solves). See Phase H diagnostic / probe-ddd-mainpath-autopsy.
      const mainPath: SolverAction[] = ctx.bestTurn1Path !== undefined
        ? ctx.bestTurn1Path.map(a => this.adapter.enrichAction(a))
        : (lastResultNode ? this.extractMainPath(lastResultNode) : []);
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
            branchBoundCut: ctx.terminalBranchBoundCut,
            rootChildBudgetCut: ctx.terminalRootChildBudgetCut,
          },
          bestTurn1ExplorationScore: ctx.bestTurn1ExplorationScore,
          // Phase H — authoritative peak field-state snapshot. Probes and
          // diagnostics should read this instead of attempting to replay
          // the mainPath (which may desync under forkViaReplay semantics).
          bestTurn1FieldState: ctx.bestTurn1FieldState,
          suggestedMaxDepth: this.suggestMaxDepth(ctx),
          promptTypeCounts: ctx.promptTypeCounts,
          bfByDepthSum: ctx.bfByDepthSum,
          bfByDepthCount: ctx.bfByDepthCount,
          actionsZeroByDepth: ctx.actionsZeroByDepth,
          actionsZeroSamples: ctx.actionsZeroSamples,
        },
      };

      // Merge probe stats if resuming from probe
      stats = this.mergeProbeStats(stats);

      // 2026-04-15 triplet-sync: report the turn-1 peak as the external
      // result. `ctx.bestTurn1ExplorationScore` / `bestTurn1Breakdown` / `bestEndBoardCards`
      // are always captured together via `updateBest`, so the reported
      // (score, scoreBreakdown, endBoardCards) triplet describes ONE state.
      // Tree-internal `result.score` still drives action ordering and TT
      // caching, but it can include turn>=2 terminal propagation which
      // inflates the number past the canonical end-of-turn-1 peak.
      // Fallback to tree propagation when no turn<=1 state was ever reached
      // (pathological — shouldn't happen in normal solves, but defensive).
      //
      // methodology v5 (2026-04-17): user-facing `score` reports the pure
      // `interruptionScore` (weighted + fallbackPoints) from the peak
      // breakdown, NOT the `explorationScore` that drove DFS. This keeps
      // latent guidance (Phase 2.3, Step 1 F1/F2/F3, future Phase D) as an
      // internal exploration signal while the reported grade remains a
      // pure disruption-value metric. `scoreBreakdown` still carries both
      // fields, so consumers that want the exploration value can read
      // `scoreBreakdown.explorationScore` explicitly.
      const reportBreakdown = ctx.bestTurn1ExplorationScore >= 0 ? ctx.bestTurn1Breakdown : lastResultBreakdown;
      const reportScore = reportBreakdown
        ? reportBreakdown.interruptionScore
        : (ctx.bestTurn1ExplorationScore >= 0 ? ctx.bestTurn1ExplorationScore : lastResultExplorationScore);
      // Phase K — tree comes from the deepest iteration that completed
      // (or was in-progress when budget expired). `lastResultNode` is
      // guaranteed non-null when at least one iteration ran, which is the
      // normal case. Defensive empty-tree fallback for the degenerate
      // "budget expired before first iteration could start" path.
      const reportTree: DecisionNode = lastResultNode ?? this.makeNode(
        ROOT_ACTION, 0, this.emptyBreakdown(), 0, [], true, true,
      );
      return {
        tree: reportTree,
        mainPath,
        score: reportScore,
        scoreBreakdown: reportBreakdown,
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
    /** Phase F-bis (v2): best (score, breakdown) observed at a `turn <= 1`
     *  state along the ancestor chain from root to this node. Used as the
     *  return value when this subtree hits the `turn >= 2` virtual terminal,
     *  so the propagated score reflects "best turn-1 reachable from this
     *  branch" instead of the polluted turn-2 boundary state. Root call
     *  starts at 0 / empty; each recursive call receives the max over
     *  (parent's ancestor value, parent's interim value at turn<=1). */
    ancestorTurn1ExplorationScore: number = 0,
    ancestorTurn1Breakdown: ScoreBreakdown = this.emptyBreakdown(),
    /** Phase 5-lite Phase 0 (2026-04-18): canonical-path forcing pointer.
     *  Indexes into `ctx.canonicalPath` at this node; when the next-expected
     *  cardId matches an available action, actions are filtered to just
     *  that one and the pointer advances in the recursive call. No effect
     *  when `ctx.canonicalPath` is undefined (production default). */
    canonicalPathPointer: number = 0,
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
    let actions = ctx.oracle.getLegalActions(handle);

    // Anti-pin filter (Phase 5-lite Phase 0). When `bannedCardIds` is set,
    // remove any action whose cardId is in the ban set BEFORE canonicalPath
    // forcing. Complements pins: pins steer toward a desired line, bans
    // block scorer-exploited detours (e.g., Mitsurugi Mirror tributing the
    // canonical ritual target). Undefined in production.
    if (ctx.bannedCardIds !== undefined) {
      const before = actions.length;
      actions = actions.filter(a => !ctx.bannedCardIds!.has(a.cardId));
      if (process.env.SOLVER_DEBUG_CANONICAL === '1' && actions.length !== before) {
        console.log(`[canonical] depth=${depth} banned filter: ${before} → ${actions.length} options`);
      }
    }

    // Canonical-path forcing (Phase 5-lite Phase 0). When a canonicalPath
    // is set on the DFS config and still has entries, try to match the
    // next-expected cardId against the legal actions at this prompt. If
    // any action carries that cardId, filter `actions` to that single
    // option and advance the pointer for the recursive call. When no
    // match (or path exhausted), leave `actions` alone — the DFS explores
    // this prompt freely and the pointer stays put for the next recursion.
    let nextCanonicalPointer = canonicalPathPointer;
    if (ctx.canonicalPath !== undefined && canonicalPathPointer < ctx.canonicalPath.length) {
      const expectedCardId = ctx.canonicalPath[canonicalPathPointer];
      const match = actions.find(a => a.cardId === expectedCardId);
      if (match !== undefined) {
        if (process.env.SOLVER_DEBUG_CANONICAL === '1') {
          console.log(`[canonical] depth=${depth} pointer=${canonicalPathPointer} forced cardId=${expectedCardId} rIdx=${match.responseIndex} (${actions.length} → 1 options)`);
        }
        actions = [match];
        nextCanonicalPointer = canonicalPathPointer + 1;
      } else if (process.env.SOLVER_DEBUG_CANONICAL === '1') {
        const cids = actions.map(a => a.cardId).slice(0, 8);
        console.log(`[canonical] depth=${depth} pointer=${canonicalPathPointer} NO MATCH for cardId=${expectedCardId}; available cardIds=[${cids.join(',')}${actions.length > 8 ? ',...' : ''}] (n=${actions.length})`);
      }
    }

    // Cache field state ONCE per node
    const fieldState = ctx.oracle.getFieldState(handle);
    // Story 1.8: also fetch the activation log so OPT-aware scoring and the
    // verification key both see the same per-handle OPT state.
    const activationLog = ctx.oracle.getActivationLog(handle);

    // Constraint 3.2-light: score every visited state, not just terminals.
    // Without this, `ctx.bestExplorationScore` only captures terminal scores, and
    // raising `maxDepth` can paradoxically *lower* the reported best score
    // because the deeper exploration passes through the optimal mid-combo
    // endboard state without ever freezing its value. Scoring every node
    // guarantees `ctx.bestExplorationScore` is monotone with respect to `maxDepth`
    // (more exploration can only ever find equal or better states).
    //
    // Mid-chain-resolution states (SELECT_CHAIN / SELECT_EFFECTYN) may
    // over-credit transient staging positions, but `ctx.bestExplorationScore` is a
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
    // `interim.score` = explorationScore (scorer contract, methodology v5).
    const interim = this.scorer.scoreWithCards(fieldState, activationLog);
    this.updateBest(ctx, interim.score, interim.scoreBreakdown, interim.endBoardCards, fieldState.turn, fieldState);

    // Phase F-bis v2: fold the current interim into the ancestor chain
    // parameter ONLY if this state is turn<=1. This value propagates upward
    // at the turn>=2 virtual terminal and downward as `ancestorTurn1ExplorationScore`.
    let pathTurn1ExplorationScore = ancestorTurn1ExplorationScore;
    let pathTurn1Breakdown = ancestorTurn1Breakdown;
    if (fieldState.turn <= 1 && interim.score > pathTurn1ExplorationScore) {
      pathTurn1ExplorationScore = interim.score;
      pathTurn1Breakdown = interim.scoreBreakdown;
    }

    // Constraint 3.2 full + Phase F-bis v2: virtual terminal at turn-2
    // entry. The solver's search horizon is end-of-turn-1; exploring into
    // opponent turn wastes budget and has no validation signal (`matched`
    // is measured against turn-1 endboards).
    //
    // Instead of propagating either `interim.score` from the polluted
    // turn-2 boundary state (original Phase A #1 — leaked turn-2 value
    // into tree propagation and TT cache) or hard-coded 0 (Phase F-bis v1
    // — dropped the guidance signal that helped D/D/D find its Siegfried
    // subtree, causing -8 score / -1 matched regression), we propagate
    // `pathTurn1ExplorationScore` — the best turn-1 state observed along the ancestor
    // chain from root to here. This is the "best turn-1 commitment
    // reachable from this branch" — an honest ceiling that drives child
    // selection toward subtrees whose ancestors already hit real turn-1
    // peaks, without crediting the turn-2 state itself.
    if (fieldState.turn >= 2) {
      ctx.terminalTurn2++;
      ctx.totalTreeNodes++;
      return {
        node: this.makeNode(ROOT_ACTION, pathTurn1ExplorationScore, pathTurn1Breakdown, 1.0, [], true),
        explorationScore: pathTurn1ExplorationScore,
        scoreBreakdown: pathTurn1Breakdown,
      };
    }

    // Phase I — branch-and-bound pruning. If the current ancestor-chain
    // turn-1 peak plus a plausible upper bound on remaining-ply gain still
    // falls short of the global best, this subtree cannot possibly produce
    // a new peak — cut it and return pathTurn1ExplorationScore upward. RECOVERY_PER_PLY
    // is calibrated at 3 (~2× the empirical average gain per productive ply)
    // to stay conservative: the cut only fires when the gap cannot be
    // bridged even under an optimistic per-ply gain assumption.
    //
    // Propagating pathTurn1ExplorationScore (not 0) keeps tree score tracking honest
    // — the parent's `children.sort score desc` sees the ancestor value
    // this branch already captured, preserving the Phase F-bis v2 semantics.
    //
    // No-op at the root (ctx.bestTurn1ExplorationScore starts at -1, condition
    // `pathTurn1ExplorationScore + maxGain < -1` is always false). Only starts firing
    // once updateBest has set bestTurn1ExplorationScore to a non-trivial value.
    // Strategic Grammar v1 (2026-04-21): widen the branch-bound window to
    // include the grammar-goal-reachable upper bound. A state from which a
    // large goal could still be completed deserves exploration even when
    // the linear per-ply estimate (1.5) falls short. Without this, DFS
    // early-cuts subtrees that eventually reach a multi-goal terminal.
    // Non-expertise fixtures: the delta is 0 → cut semantics unchanged.
    const remainingPlies = ctx.iterationMaxDepth - depth;
    const grammarUpperBoundDelta = this.scorer.goalMatchUpperBoundDelta(
      fieldState,
      interim.scoreBreakdown.goalMatchPoints,
      interim.scoreBreakdown.implicitGoalPoints,
    );
    const maxPlausibleGain = (remainingPlies * BRANCH_BOUND_RECOVERY_PER_PLY) + grammarUpperBoundDelta;
    if (pathTurn1ExplorationScore + maxPlausibleGain < ctx.bestTurn1ExplorationScore) {
      ctx.terminalBranchBoundCut++;
      ctx.totalTreeNodes++;
      return {
        node: this.makeNode(ROOT_ACTION, pathTurn1ExplorationScore, pathTurn1Breakdown, 1.0, [], true),
        explorationScore: pathTurn1ExplorationScore,
        scoreBreakdown: pathTurn1Breakdown,
      };
    }

    // Phase L — per-subtree soft budget guard. The currently-explored
    // first-level root-child branch is cut when it has been running for
    // longer than `ctx.rootChildBudgetMs` without producing ANY new
    // `bestTurn1ExplorationScore` peak. The clock is a sliding "time since last peak
    // improvement" reference (`ctx.branchLastPeakTime`), not a fixed
    // "elapsed since branch start" window — this is essential for
    // depth-bound combos (e.g. D/D/D NS-first) that climb their peak in
    // many small increments over the whole global budget. A fixed window
    // would cut those branches mid-climb; the sliding clock keeps them
    // alive as long as they keep discovering new peaks, while still
    // cutting branches that stall entirely (e.g. a combo-enabler Gate
    // subtree that has exhausted its latent bonus and now wastes time
    // in a deep dead-end).
    //
    // Motivation: Phase 2.1 / Phase J / Phase J-on-K all catastrophically
    // regressed when a ranker change promoted `Dark Contract with the Gate`
    // (or any combo-enabler) to the front of the root enumeration. The Gate
    // subtree has an enormous branching factor and, at the current 60s /
    // d=50 budget, consumes the entire global budget before the NS-first
    // line (which actually reaches the tagged boss peak) ever runs. Phase K
    // iterative deepening did NOT rescue this because D/D/D's canonical
    // combo requires depth ~43 and the shallow iter at d=25 can't establish
    // a meaningful bestTurn1ExplorationScore floor. A per-subtree stall detector is
    // the only known mechanism that forces Gate-first exploration to yield
    // without requiring a working shallow-iter floor.
    //
    // The guard fires at `depth > 0` only (the root node itself is outside
    // any tracked branch). `branchLastPeakTime` is `undefined` outside of
    // tracked branches (scoreTerminal on root, probe mode with
    // rootChildBudgetMs = +Infinity gated via the isFinite check), so the
    // condition is trivially false in those cases.
    //
    // Propagates `pathTurn1ExplorationScore` (not 0) to preserve Phase F-bis v2
    // ancestor-chain semantics — the parent sorts children by score and
    // this branch's ancestor value is still the honest turn-1 floor it
    // observed along its descent.
    if (depth > 0) {
      // Node-budget mode (pre-S2 infra) takes precedence over wall-clock
      // when `rootChildBudgetNodes` is set. Both modes use identical
      // sliding-window semantics: measure progress since last peak
      // improvement inside the current root-child branch, cut if it
      // exceeds the allotted budget. Node-count is deterministic across
      // CPU throttling states (unlike Date.now()), unlocking reproducible
      // regression gates in evaluate-structural.ts.
      if (
        ctx.rootChildBudgetNodes !== undefined &&
        ctx.branchLastPeakNodes !== undefined
      ) {
        const nodesSinceLastPeak = ctx.totalTreeNodes - ctx.branchLastPeakNodes;
        if (nodesSinceLastPeak > ctx.rootChildBudgetNodes) {
          ctx.terminalRootChildBudgetCut++;
          ctx.totalTreeNodes++;
          return {
            node: this.makeNode(ROOT_ACTION, pathTurn1ExplorationScore, pathTurn1Breakdown, 1.0, [], true),
            explorationScore: pathTurn1ExplorationScore,
            scoreBreakdown: pathTurn1Breakdown,
          };
        }
      } else if (
        ctx.branchLastPeakTime !== undefined &&
        Number.isFinite(ctx.rootChildBudgetMs)
      ) {
        const elapsedSinceLastPeak = Date.now() - ctx.branchLastPeakTime;
        if (elapsedSinceLastPeak > ctx.rootChildBudgetMs) {
          ctx.terminalRootChildBudgetCut++;
          ctx.totalTreeNodes++;
          return {
            node: this.makeNode(ROOT_ACTION, pathTurn1ExplorationScore, pathTurn1Breakdown, 1.0, [], true),
            explorationScore: pathTurn1ExplorationScore,
            scoreBreakdown: pathTurn1Breakdown,
          };
        }
      }
    }

    // Terminal: no legal actions or max depth
    if (actions.length === 0 || depth >= ctx.iterationMaxDepth) {
      // Distinguish "natural end" (no actions) from "depth cap hit while
      // actions remained" — the latter is a truncation signal.
      if (actions.length > 0 && depth >= ctx.iterationMaxDepth) {
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
        explorationScore: 0,
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
          const continuation = this.dfs(ctx, child, depth + 1, pathHashes, pathTurn1ExplorationScore, pathTurn1Breakdown, nextCanonicalPointer);
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
            explorationScore: ttEntry.score,
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
      ranked = instrumentTime('rank', () => this.ranker.rank(actions, fieldState));
    }

    // Explore children. Path-hash bookkeeping is only maintained for
    // SELECT_IDLECMD (see loop-detection comment above) — for chain-window
    // prompts we neither check nor record.
    if (isIdleCmd) pathHashes.add(hashKey);
    const children: { action: Action; result: DfsNodeResult }[] = [];
    let bestExplorationScore = -1;
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
      // Phase H — maintain the live descent stack. The push must happen
      // BEFORE the recursive call so that `updateBest` at the child node
      // sees the complete root→child path. The pop MUST run in the
      // `finally` block to stay symmetric even if the recursive call
      // throws (current code never does, but defensive).
      ctx.currentActionStack.push(action);
      // Phase L — track first-level root-child branches. Set the branch
      // start timestamp + sliding-clock reference on entry, clear on exit.
      // Deeper recursive dfs() calls never touch these fields; they
      // inherit the outer branch's tracking transparently. `branchLastPeakTime`
      // is reset to now at each new root-child entry (so the previous
      // branch's last-peak timestamp doesn't leak into the new branch's
      // budget) and subsequently advanced by `updateBest` whenever
      // `bestTurn1ExplorationScore` strictly improves while this branch is active.
      const isRootChild = depth === 0;
      if (isRootChild) {
        const branchStart = Date.now();
        ctx.currentRootChildStart = branchStart;
        ctx.branchLastPeakTime = branchStart;
        ctx.branchLastPeakNodes = ctx.totalTreeNodes;
      }
      try {
        ctx.oracle.applyAction(child, action);
        const result = this.dfs(ctx, child, depth + 1, pathHashes, pathTurn1ExplorationScore, pathTurn1Breakdown, nextCanonicalPointer);

        children.push({ action, result });
        ctx.totalChildren++;

        if (result.explorationScore > bestExplorationScore) {
          bestExplorationScore = result.explorationScore;
          bestAction = action;
          bestBreakdown = result.scoreBreakdown;
        }
      } finally {
        ctx.currentActionStack.pop();
        if (isRootChild) {
          ctx.currentRootChildStart = undefined;
          ctx.branchLastPeakTime = undefined;
          ctx.branchLastPeakNodes = undefined;
        }
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

    // Sort children by explorationScore descending (DFS guidance order)
    children.sort((a, b) => b.result.explorationScore - a.result.explorationScore);

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
    if (isIdleCmd && bestAction && bestExplorationScore > 0) {
      this.table.store(hash, depth, bestExplorationScore, bestAction, vKey, bestBreakdown ?? this.emptyBreakdown());
    }

    return {
      node: this.makeNode(ROOT_ACTION, bestExplorationScore, bestBreakdown, confidence, childNodes, false),
      explorationScore: bestExplorationScore,
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
    // `score` returned by scoreWithCards = explorationScore (preserves pre-v5
    // DFS internal contract). The breakdown carries interruptionScore for
    // downstream user-facing extraction.
    const { score: explorationScore, scoreBreakdown, endBoardCards } = this.scorer.scoreWithCards(fieldState, activationLog);
    ctx.totalTreeNodes++;
    this.updateBest(ctx, explorationScore, scoreBreakdown, endBoardCards, fieldState.turn, fieldState);

    return {
      node: this.makeNode(ROOT_ACTION, explorationScore, scoreBreakdown, truncated ? 0.5 : 1.0, [], true, truncated),
      explorationScore,
      scoreBreakdown,
    };
  }

  /**
   * Phase A #4: suggest a maxDepth for the NEXT run based on the terminal
   * reason distribution observed in this run. Returns a positive integer
   * multiplier semantics absent — the caller treats it as "maxDepth the
   * next solve should use" when deciding whether to rerun with a different
   * config. Pure observability; does not affect the current run.
   *
   * Heuristic:
   * - If `depthCap` is >= 30% of all terminals → current maxDepth is too
   *   low (the solver is truncating at the bound), suggest ×1.5.
   * - If `actionsZero` is >= 60% of all terminals → current maxDepth is
   *   probably sufficient (the solver reaches natural ends), suggest ×0.8
   *   to free budget for breadth.
   * - Else → suggest current value (nothing obvious to change).
   */
  private suggestMaxDepth(ctx: DfsContext): number {
    const reasons = {
      actionsZero: ctx.terminalActionsZero,
      depthCap: ctx.terminalDepthCap,
      loopDetected: ctx.terminalLoopDetected,
      treeSizeLimit: ctx.terminalTreeSizeLimit,
      abortOrNodeLimit: ctx.terminalAbortOrNodeLimit,
      budgetCutoff: ctx.terminalBudgetCutoff,
      ttHit: ctx.terminalTtHit,
      turn2: ctx.terminalTurn2,
    };
    const total = Object.values(reasons).reduce((a, b) => a + b, 0);
    if (total === 0) return this.maxDepth;
    const depthCapRatio = reasons.depthCap / total;
    const actionsZeroRatio = reasons.actionsZero / total;
    if (depthCapRatio >= 0.3) return Math.round(this.maxDepth * 1.5);
    if (actionsZeroRatio >= 0.6) return Math.round(this.maxDepth * 0.8);
    return this.maxDepth;
  }

  /**
   * Constraint 3.2 full: gated best-state update. `bestExplorationScore`
   * tracks the global max unconditionally (observability). `bestEndBoardCards`
   * + `bestTurn1Breakdown` only capture for `turn <= 1` so the reported
   * endboard + interruption score reflect the canonical player-turn-1 peak.
   */
  private updateBest(
    ctx: DfsContext,
    explorationScore: number,
    scoreBreakdown: ScoreBreakdown,
    endBoardCards: EndBoardCard[],
    turn: number,
    fieldState: FieldState,
  ): void {
    if (explorationScore > ctx.bestExplorationScore) {
      ctx.bestExplorationScore = explorationScore;
    }
    if (turn <= 1 && explorationScore > ctx.bestTurn1ExplorationScore) {
      ctx.bestTurn1ExplorationScore = explorationScore;
      ctx.bestEndBoardCards = endBoardCards;
      ctx.bestTurn1Breakdown = scoreBreakdown;
      // Phase H — clone the live descent stack so consumers can inspect the
      // action sequence the DFS took to reach the peak. NOTE: replaying this
      // path on a fresh engine may desync due to `forkViaReplay` vs fresh
      // `createDuel + applyAction` divergence in OCGCore chain-window
      // materialization. Use `bestTurn1FieldState` below for authoritative
      // peak state inspection.
      ctx.bestTurn1Path = [...ctx.currentActionStack];
      // Phase H — authoritative peak state snapshot. FieldState is a plain
      // object returned by `getFieldState` (pure query, no engine mutation),
      // so storing the reference is safe. The caller does not mutate it
      // after passing it in.
      ctx.bestTurn1FieldState = fieldState;
      // Phase L — advance the sliding "since last peak improvement"
      // counters (both wall-clock and node-count). Only updated while a
      // tracked root-child branch is active (`currentRootChildStart`
      // defined) so that the guard measures stall INSIDE the current
      // branch, independent of peaks found in prior branches. Both
      // counters advance together so the active mode (selected in the
      // guard) sees a consistent reset.
      if (ctx.currentRootChildStart !== undefined) {
        ctx.branchLastPeakTime = Date.now();
        ctx.branchLastPeakNodes = ctx.totalTreeNodes;
      }
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
      bestExplorationScore: -1,
      bestTurn1ExplorationScore: -1,
      bestEndBoardCards: [],
      bestTurn1Breakdown: cloneEmptyBreakdown(),
      currentActionStack: [],
      bestTurn1Path: undefined,
      bestTurn1FieldState: undefined,
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
      terminalBranchBoundCut: 0,
      terminalRootChildBudgetCut: 0,
      // Probe mode: disable Phase L guard. Probes are short (100 nodes)
      // and don't need per-subtree pacing; setting rootChildBudgetMs = 0
      // would fire immediately, so we set Infinity instead to make the
      // guard inactive. Node-budget mode is also off during probe — the
      // node-budget branch in the guard only fires when `rootChildBudgetNodes`
      // is defined.
      rootChildBudgetMs: Number.POSITIVE_INFINITY,
      rootChildBudgetNodes: undefined,
      canonicalPath: undefined,
      bannedCardIds: undefined,
      currentRootChildStart: undefined,
      branchLastPeakTime: undefined,
      branchLastPeakNodes: undefined,
      iterationMaxDepth: this.maxDepth,
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
      bestScore: ctx.bestExplorationScore,
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
      // Emit user-facing interruptionScore from the current turn-1 peak
      // breakdown — matches the final reportScore semantic and the UI
      // "Score d'interruption" label. Falls back to 0 before the first
      // turn-1 peak lands (solver-types `SolverProgress.bestScore` is
      // expected to be a non-negative number). Pre-v5 this emitted
      // `ctx.bestExplorationScore` which contaminated the displayed value
      // with latent combo-progress bonuses.
      const displayScore = ctx.bestTurn1ExplorationScore >= 0
        ? (ctx.bestTurn1Breakdown.interruptionScore ?? 0)
        : 0;
      ctx.onProgress({
        nodesExplored: ctx.nodesExplored,
        bestScore: displayScore,
        elapsed: now - ctx.startTime,
      });
      ctx.lastProgressTime = now;
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Build a DecisionNode for the returned solver tree.
   *
   * methodology v5 (2026-04-17) split semantic:
   *   - `DecisionNode.score` = **interruptionScore** (user-facing, pure
   *     end-board disruption value). Derived from
   *     `scoreBreakdown.interruptionScore` when the breakdown is present.
   *   - DFS internal variables (`bestScore`, `pathTurn1ExplorationScore`, `ttEntry.score`)
   *     continue to track **explorationScore** for action ordering / α-β
   *     floor / TT reuse. Those values are passed as the `explorationScore`
   *     parameter here and used only as a fallback when no breakdown is
   *     available (degenerate empty-tree / unscored-terminal paths).
   *
   * Why the fallback matters: a few makeNode callsites don't have a
   * breakdown (empty-tree sentinel, mid-solve abort paths). For those,
   * the exploration value is the only number on hand — displaying it as
   * `node.score` is better than leaking an undefined or zero value that
   * would distort downstream tree rendering and sorting.
   */
  private makeNode(
    action: SolverAction,
    explorationScore: number,
    scoreBreakdown: ScoreBreakdown | undefined,
    confidence: number,
    children: DecisionNode[],
    isTerminal: boolean,
    truncated?: boolean,
  ): DecisionNode {
    const displayScore = scoreBreakdown?.interruptionScore ?? explorationScore;
    return {
      action,
      annotation: '',
      score: displayScore,
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
  /** Peak explorationScore observed at ANY state (turn-agnostic). Observability
   *  only — emitted via SolverProgress. Reported harness score is extracted
   *  from `bestTurn1Breakdown.interruptionScore` (methodology v5). */
  bestExplorationScore: number;
  /** Peak explorationScore observed at turn <= 1. Gated companion to
   *  `bestExplorationScore` so `bestEndBoardCards` + `bestTurn1Breakdown`
   *  reflect the canonical end-of-turn-1 peak rather than post-combo / opp-turn
   *  cycling.
   *  Used as the α-β floor and the source of `reportBreakdown.interruptionScore`. */
  bestTurn1ExplorationScore: number;
  bestEndBoardCards: EndBoardCard[];
  /** 2026-04-15 triplet-sync fix: scoreBreakdown companion to
   *  `bestEndBoardCards` so the externally reported (score, scoreBreakdown,
   *  endBoardCards) triplet always describes the SAME captured peak state.
   *  Previously the report mixed tree-propagation score/breakdown (best
   *  durable terminal, possibly turn>1) with peak endBoardCards (interim
   *  turn<=1 snapshot), causing D/D/D to surface
   *  `score=3 weighted=0 fallback=3` alongside an actualBoard of 2 tagged
   *  bosses that should have contributed 27 weighted. */
  bestTurn1Breakdown: ScoreBreakdown;
  /** Phase H — live DFS descent stack. Maintained via push/pop around each
   *  recursive `dfs()` call in the child exploration loop. At the top of any
   *  `dfs()` call the stack contains the ordered list of Actions that transition
   *  the root state to the current node's state. Used by `updateBest` to capture
   *  the exact replay path when `bestTurn1ExplorationScore` improves. */
  currentActionStack: Action[];
  /** Phase H — clone of `currentActionStack` taken at the moment `bestTurn1ExplorationScore`
   *  improved. Represents the ordered exploratory actions the DFS took from
   *  root to the peak node. NOTE: this is NOT guaranteed to replay exactly
   *  on a fresh `createDuel + applyAction` engine because the DFS uses
   *  `forkViaReplay` semantics that may surface different chain windows than
   *  fresh replay. Use `bestTurn1FieldState` for authoritative peak state;
   *  use `bestTurn1Path` for understanding the solver's decision sequence.
   *  `undefined` means no turn<=1 state was ever visited (solve() falls back
   *  to the old tree-walk `extractMainPath`). */
  bestTurn1Path: Action[] | undefined;
  /** Phase H — snapshot of `fieldState` at the moment `bestTurn1ExplorationScore` improved.
   *  Authoritative peak state, untouched by fork/replay divergence. Consumers
   *  (probes, diagnostics) should prefer this over replaying `bestTurn1Path`
   *  when they want to inspect the peak. */
  bestTurn1FieldState: FieldState | undefined;
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
  /** Phase I — nodes cut by the branch-and-bound pruning check: subtrees
   *  whose upper bound (ancestor pathTurn1ExplorationScore + remaining-ply plausible
   *  gain) cannot possibly exceed ctx.bestTurn1ExplorationScore. */
  terminalBranchBoundCut: number;
  /** Phase L — nodes cut by the per-subtree soft budget guard: the current
   *  first-level root-child branch has exceeded its allotted time slice
   *  without producing a non-trivial `bestTurn1ExplorationScore` improvement, so the
   *  DFS is forced to unwind and move on to the next root child. */
  terminalRootChildBudgetCut: number;
  /** Phase L — per first-level root-child branch wall-clock budget (ms).
   *  Computed once in `solve()` as `Math.floor(timeBudget * ROOT_CHILD_BUDGET_FRACTION)`.
   *  Read by every dfs() call to decide whether the current branch has
   *  overstayed its welcome. `0` disables the guard (probe mode). */
  rootChildBudgetMs: number;
  /** Phase L node-budget (pre-S2 infra) — deterministic alternative to
   *  `rootChildBudgetMs`. When defined, supersedes the wall-clock guard:
   *  branch cut fires at `totalTreeNodes - branchLastPeakNodes > rootChildBudgetNodes`.
   *  Unlocks reproducible regression gates in `evaluate-structural.ts` by
   *  removing CPU-throughput sensitivity. `undefined` = wall-clock mode (default). */
  rootChildBudgetNodes: number | undefined;
  /** Phase 5-lite Phase 0 (2026-04-18) — canonical-path forcing. When
   *  defined, the DFS consults this ordered list of cardIds at each
   *  decision point and force-picks the option whose cardId matches the
   *  next-expected entry, advancing the pointer in the recursive call.
   *  Unused (undefined) in production solves; set by
   *  `scripts/record-trajectory.ts` during trajectory derivation. */
  canonicalPath: readonly number[] | undefined;
  /** Phase 5-lite Phase 0 (2026-04-18) — anti-pins. When non-empty, every
   *  legal action whose `cardId` is in this set is filtered out upfront
   *  (before canonicalPath forcing) so the DFS never picks these cards.
   *  Complements `canonicalPath` for hint authoring: pins steer toward a
   *  desired line, anti-pins block scorer-exploited detours. Undefined
   *  (production default) = no filter. */
  bannedCardIds: ReadonlySet<number> | undefined;
  /** Phase L — timestamp at which the currently-explored first-level
   *  root-child branch began. Set in the child loop at `depth === 0`
   *  before the recursive call, cleared in the `finally` after the pop.
   *  `undefined` means we are NOT currently inside a tracked branch
   *  (root dfs() itself, between branches, or terminal scoreTerminal).
   *  Used by the Phase L guard to compute elapsed-in-branch. */
  currentRootChildStart: number | undefined;
  /** Phase L — sliding "time since last peak improvement" clock.
   *  Initialized at `Date.now()` at each first-level root-child branch
   *  entry. Updated to `Date.now()` inside `updateBest` whenever
   *  `bestTurn1ExplorationScore` strictly increases while a tracked branch is
   *  active (i.e. `currentRootChildStart !== undefined`). The guard
   *  fires when `Date.now() - branchLastPeakTime > rootChildBudgetMs`.
   *  `undefined` when no branch is currently tracked. */
  branchLastPeakTime: number | undefined;
  /** Phase L node-budget — sliding "nodes since last peak improvement"
   *  counter. Parallels `branchLastPeakTime` but in node-count space
   *  (reads `ctx.totalTreeNodes` as the progress clock). Seeded at
   *  root-child entry, advanced inside `updateBest` on peak improvement,
   *  compared against `rootChildBudgetNodes` in the Phase L guard.
   *  `undefined` when no branch is tracked or node-budget mode is off. */
  branchLastPeakNodes: number | undefined;
  /** Phase K — iterative deepening. Current iteration's max depth bound.
   *  Set before each DFS pass in `solve()`; the DFS reads this instead of
   *  `this.maxDepth` for terminal checks and Phase I remaining-ply math.
   *  Shallow iterations use a fraction of this.maxDepth; the final iteration
   *  uses the full this.maxDepth. Always <= this.maxDepth. */
  iterationMaxDepth: number;
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
