// =============================================================================
// solver-types.ts — Solver module data types (source of truth)
// Frontend solver.model.ts must match relevant types in the same commit
// =============================================================================

import type { ZoneId, Phase } from '../ws-protocol.js';

// =============================================================================
// Duel Configuration
// =============================================================================

export interface DuelConfig {
  mainDeck: number[];
  extraDeck: number[];
  hand: number[];
  deckSeed: bigint[];
  opponentDeck: number[];
  handtraps?: HandtrapConfig[];
  /** Override OCGCore's startingDrawCount. Defaults to 5 (standard TCG/OCG
   *  opening hand). Set to 0 in test harnesses that push an exact starter
   *  hand via `hand` — otherwise OCGCore draws 5 additional cards on top,
   *  producing a 10-card hand and polluting measurements. */
  startingDrawCount?: number;
  /** Override OCGCore's drawCountPerTurn. Defaults to 1. Set to 0 in test
   *  harnesses that want a truly fixed hand across all turns (no per-turn
   *  draws contaminating the scored state). */
  drawCountPerTurn?: number;
  /** Preferred cardIds for `SELECT_CARD` auto-resolution. When the adapter
   *  must pick N cards out of a pool (e.g. Lukias searching a Dracotail
   *  to hand), it first tries to select any card whose `code` appears in
   *  this list before falling back to the default "pick first N" policy.
   *  Used by the empirical-validation spike to bias search targets toward
   *  the fixture's expected-combo endboard, so we can measure whether the
   *  solver *could* reach the canonical line given correct target picks. */
  preferredSearchTargets?: number[];
  /** Cards placed directly into non-deck zones BEFORE `startDuel()`. Consumed
   *  by `createNativeDuel` via `duelNewCard` with the mapped OcgLocation/
   *  OcgPosition. Used by bridge-validator (2026-04-24) to seed mid-combo
   *  starting states (e.g., Flamberge in GY, 2 Lv4 on field) that a bridge
   *  subroute requires. Cards listed here are NOT drawn from deck — they're
   *  synthesized into the zone directly. `sequence` auto-assigns per-zone
   *  if omitted (first placement → 0, next → 1, …). */
  initialPlacements?: InitialPlacement[];
}

export type InitialPlacementZone = 'MZONE' | 'SZONE' | 'GRAVE' | 'REMOVED' | 'FZONE' | 'PZONE' | 'HAND' | 'EXTRA' | 'DECK';
export type InitialPlacementPosition = 'FACEUP_ATTACK' | 'FACEUP_DEFENSE' | 'FACEDOWN_ATTACK' | 'FACEDOWN_DEFENSE';

export interface InitialPlacement {
  cardId: number;
  zone: InitialPlacementZone;
  /** Defaults to auto-assigned per zone (0, 1, 2, …). For MZONE use 0-4 to
   *  target a specific M1-M5 slot; for EMZ the sequence is engine-dependent. */
  sequence?: number;
  /** Defaults to FACEUP_ATTACK for monster zones, FACEDOWN for set/backrow,
   *  FACEDOWN_ATTACK for hand/deck/extra/grave (inert). */
  position?: InitialPlacementPosition;
  /** Defaults to 0 (player). */
  controller?: 0 | 1;
}

// =============================================================================
// Actions & Field State
// =============================================================================

export type PromptType =
  | 'SELECT_IDLECMD'
  | 'SELECT_BATTLECMD'
  | 'SELECT_CHAIN'
  | 'SELECT_EFFECTYN'
  | 'SELECT_YESNO'
  | 'SELECT_OPTION'
  | 'SELECT_CARD'
  | 'SELECT_UNSELECT_CARD'
  | 'SELECT_POSITION'
  | 'SELECT_PLACE'
  | 'SELECT_TRIBUTE'
  | 'SELECT_SUM'
  | 'SELECT_COUNTER'
  | 'SELECT_DISFIELD';

// Exploratory prompts become tree branches in the solver.
// All other PromptType values (SELECT_POSITION, SELECT_PLACE, SELECT_TRIBUTE,
// SELECT_SUM, SELECT_COUNTER, SELECT_DISFIELD, SELECT_CARD, SELECT_UNSELECT_CARD)
// are auto-resolved with heuristic defaults (mechanical).
// SELECT_CARD / SELECT_UNSELECT_CARD are mechanical for MVP — the solver focuses
// on which effects to activate, not which targets to pick. Future story may
// promote them to exploratory for decks where target selection is strategic.
export const EXPLORATORY_PROMPTS: ReadonlySet<PromptType> = new Set<PromptType>([
  'SELECT_IDLECMD',
  'SELECT_BATTLECMD',
  'SELECT_CHAIN',
  'SELECT_EFFECTYN',
  'SELECT_YESNO',
  'SELECT_OPTION',
]);

export interface Action {
  responseIndex: number;
  cardId: number;
  promptType: PromptType;
  isExploratory: boolean;
  description?: string;
  actionTag?: string;
  /** @internal OCGCore response object — set by adapter, consumed by applyAction. */
  _response?: unknown;
  /** @internal True when this action represents an effect activation that
   *  should be recorded in the per-handle activation log. Set by the adapter
   *  enumerator based on prompt sub-type and `selects[i].location` (so that
   *  Synchro/Xyz/Link summon procedures, normal summons, sets, attacks, and
   *  SELECT_EFFECTYN "no" responses do NOT pollute the OPT log). Story 1.8. */
  _isEffectActivation?: boolean;
  /** Team that owns this action: 0 = player, 1 = opponent. Default undefined
   *  (= player 0) for backward-compat with DFS/SP-MCTS. In adversarial mode,
   *  OCGCoreAdapter populates `team: 1` on opponent SELECT_CHAIN actions.
   *  Minimax MCTS uses this to tag nodes as max (player) or min (opponent). */
  team?: 0 | 1;
  /** Phase B (graph-ml-v2): zone the action's source card is in at activation
   *  time. Populated by OCGCoreAdapter from `card.location` / `selects[i].location`
   *  + `sequence` + controller. Self-controlled source = ZoneId; opp-controlled
   *  source or unhandled prompt = `undefined`. Used by `NeuralFeatureRanker`'s
   *  `act_src_in_*` features — replaces a silently-corrupting "scan FieldState
   *  for first occurrence of cardId" strategy that broke on multi-copy cards
   *  (3× Ash Blossom in HAND vs 1 in GY → first match could pick the wrong
   *  zone). All other rankers ignore this field. */
  sourceZone?: ZoneId;
}

export interface FieldCard {
  cardId: number;
  cardName: string;
  position: 'faceup-atk' | 'faceup-def' | 'facedown-def' | 'facedown';
  overlayCount: number;
}

export interface FieldState {
  zones: Record<ZoneId, FieldCard[]>;
  lifePoints: [number, number];
  turn: number;
  phase: Phase;
  /** Phase B (graph-ml-v2) — opponent-side zone snapshot from the active
   *  player's perspective. Same `ZoneId` keys as `zones`, but cards belong to
   *  player 1 (e.g. `oppZones.M1` is opp's first main monster zone).
   *  Optional for backward compat — pre-Phase-B FieldState consumers see
   *  `oppZones === undefined` and behave unchanged. Populated by
   *  `queryFieldState` (board + pile zones for completeness; ranker features
   *  32-35 read board-only). No player info-leak concern: solver never
   *  exposes FieldState across a network boundary. */
  oppZones?: Record<ZoneId, FieldCard[]>;
}

// =============================================================================
// Decision Tree Model
// =============================================================================

export interface SolverAction {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
}

export interface ScoreBreakdown {
  omniNegate: number;
  typedNegate: number;
  targetedNegate: number;
  floodgate: number;
  controlChange: number;
  banish: number;
  banishFacedown: number;
  attach: number;
  spin: number;
  flipFacedown: number;
  destruction: number;
  moveToSt: number;
  bounce: number;
  handRip: number;
  sendToGy: number;
  /** Sum of weighted interruption scores from TAGGED cards only — excludes the
   *  fallback +1 heuristic. Brick detection MUST use this, not `total`. */
  weighted: number;
  /** Bonus points awarded by the fallback heuristic (untagged face-up monsters).
   *  Used for tie-breaking between non-brick paths only. */
  fallbackPoints: number;
  /** Phase 2.3 V1 + Step 1 structural + Phase D — latent combo-progress
   *  bonus. Feeds `explorationScore` only; excluded from `interruptionScore`
   *  so brick detection and the reported grade stay pure disruption value. */
  latentPoints: number;
  /** Strategic Grammar v1 (2026-04-21) — Σ(baselineScore × matchRatio) over
   *  active ComboGoals. Counts INTO `interruptionScore` (user-facing grade)
   *  because goal-completion IS part of end-board disruption value, not
   *  latent exploration signal. 0 when no archetypeExpertise loaded. */
  goalMatchPoints: number;
  /** Phase A scorer fix (2026-04-26) — Σ(weight × matched) over the
   *  fixture's `expectedBoard` cards present on the terminal field. Set
   *  per-fixture by the eval harness (env-gated `SOLVER_IMPLICIT_GOALS=1`);
   *  always 0 in production runtime where no `expectedBoard` is supplied.
   *  Counts INTO `interruptionScore` to flip DFS preference from a high-
   *  structural-score short terminal to a longer terminal that reaches
   *  more expectedBoard cards. */
  implicitGoalPoints: number;
  /** `weighted + fallbackPoints + goalMatchPoints + implicitGoalPoints`.
   *  User-facing end-board grade — consumed by harness `reportScore`,
   *  regression rubric, `DecisionNode.score` display. */
  interruptionScore: number;
  /** `interruptionScore + latentPoints`. DFS guidance signal — drives action
   *  ordering, TT storage, α-β floor (`bestTurn1ExplorationScore`), virtual-
   *  terminal propagation (`pathTurn1ExplorationScore`). Also the value
   *  returned as `score` from `scoreWithCards()` (preserves pre-v5 DFS
   *  internal contract). */
  explorationScore: number;
}

export const INTERRUPTION_TYPES = [
  'omniNegate', 'typedNegate', 'targetedNegate', 'floodgate',
  'controlChange', 'banish', 'banishFacedown', 'attach',
  'spin', 'flipFacedown', 'destruction', 'moveToSt',
  'bounce', 'handRip', 'sendToGy',
] as const;

export type InterruptionType = (typeof INTERRUPTION_TYPES)[number];

/** Frozen zero-breakdown sentinel. Single source of truth for all solver
 *  strategies and the WS verify stub. Frozen so accidental mutation throws
 *  in dev (instead of silently corrupting the next scorer pass).
 *
 *  Use `cloneEmptyBreakdown()` when you need a mutable fresh instance (e.g.,
 *  the scorer builds one per call then mutates it). */
export const EMPTY_BREAKDOWN: Readonly<ScoreBreakdown> = Object.freeze({
  omniNegate: 0, typedNegate: 0, targetedNegate: 0, floodgate: 0,
  controlChange: 0, banish: 0, banishFacedown: 0, attach: 0,
  spin: 0, flipFacedown: 0, destruction: 0, moveToSt: 0,
  bounce: 0, handRip: 0, sendToGy: 0,
  weighted: 0, fallbackPoints: 0, latentPoints: 0,
  goalMatchPoints: 0, implicitGoalPoints: 0,
  interruptionScore: 0, explorationScore: 0,
});

/** Allocate a fresh mutable ScoreBreakdown with all fields = 0. */
export function cloneEmptyBreakdown(): ScoreBreakdown {
  return { ...EMPTY_BREAKDOWN };
}

export interface DecisionNode {
  action: SolverAction;
  annotation: string;
  score: number;
  scoreBreakdown?: ScoreBreakdown;
  confidence: number;
  children: DecisionNode[];
  isTerminal: boolean;
  handtrapLabel?: string;
  prunedChildren?: number;
  truncated?: boolean;
  /** For opponent nodes (handtrapLabel set): total number of legal activations
   *  the opponent could choose from at this chain window (including pass).
   *  Lets the UI show "chose among N options" when this value > 1. */
  alternativeCount?: number;
}

// =============================================================================
// Solver Configuration & Results
// =============================================================================

export interface SolverConfig {
  mode: 'goldfish' | 'adversarial';
  speed: 'fast' | 'optimal';
  timeLimitMs: number;
  handtraps?: HandtrapConfig[];
  /** Pre-S2 infra — Phase L node-budget override (deterministic regression
   *  gate mode). When set, the per-root-child Phase L guard uses
   *  `totalTreeNodes` instead of wall-clock. `undefined` keeps wall-clock
   *  (production default). Typically driven by `--node-budget=N` in
   *  `evaluate-structural.ts`. */
  rootChildBudgetNodes?: number;
  /** Phase 5-lite Phase 0 (2026-04-18) — canonical-path forcing for
   *  trajectory recording. An ordered list of cardIds consulted at each
   *  DFS decision point: when the next-expected cardId matches one of the
   *  legal actions, the DFS filters its options down to that single action
   *  (forced pick) and advances the pointer. Used by
   *  `scripts/record-trajectory.ts` to derive full `SolverAction[]` traces
   *  from terse combo-reference hints authored by humans. When `undefined`,
   *  the DFS explores normally (production default). */
  canonicalPath?: readonly number[];
  /** Phase 5-lite Phase 0 (2026-04-18) — anti-pins. Set of cardIds that
   *  the DFS must never pick at any decision point. Filters legal actions
   *  upfront (before canonicalPath forcing) so the DFS explores the
   *  remaining options freely. Used to block specific cards that the
   *  scorer mis-rewards (e.g., Mitsurugi Mirror tributing the canonical
   *  ritual target, or generic 3-material Xyz consuming the engine pool).
   *  When `undefined` or empty, no filter is applied (production default). */
  bannedCardIds?: readonly number[];
}

export interface EndBoardCard {
  cardId: number;
  cardName: string;
  position: FieldCard['position'];
  zone: ZoneId;
  effects: InterruptionEffect[];
  isFallback: boolean;
  /** Number of OPT effects consumed by this card during the current turn.
   *  Set when the scorer is called with an active `ActivationLog`. Zero or
   *  undefined means no effects consumed (fresh card). */
  consumedUses?: number;
}

export interface SolverResult {
  tree: DecisionNode;
  mainPath: SolverAction[];
  score: number;
  scoreBreakdown: ScoreBreakdown;
  endBoardCards?: EndBoardCard[];
  stats: SolverStats;
  adversarialTimings?: AdversarialTiming[];
  minimax?: number;
  verified?: boolean;
}

export interface SolverStats {
  nodesExplored: number;
  elapsed: number;
  algorithm: string;
  algorithmUsed: string;
  maxDepthReached: number;
  averageBranchingFactor: number;
  /** Worst-case branching factor observed at any single node (legal actions
   *  enumerated, pre-pruning). Reveals explosion points hidden by the average. */
  maxBranchingFactor: number;
  transpositionHits?: number;
  transpositionMisses?: number;
  transpositionStores?: number;
  transpositionEvictions?: number;
  transpositionStaleHits?: number;
  deckSeed: string;
  /** Set when a solver bails out early due to a streak of iteration errors. */
  abortedDueToFailures?: number;
  verifyDivergence?: string;
  /** Effective compute budget given to this solve (post verification reservation).
   *  Use `elapsed / budgetMs` to compute utilization. */
  budgetMs: number;
  /** True when the search hit the depth cap OR ran out of time mid-exploration.
   *  Indicates the result may be incomplete — the solver stopped before
   *  finishing the search space, not because nothing was left to explore. */
  truncated: boolean;
  /** Why the search stopped:
   *  - 'completed' — natural exhaustion (DFS) or expansion-only end (MCTS)
   *  - 'timeout' — time budget elapsed mid-exploration
   *  - 'depth_cap' — at least one node hit `maxDepth` with legal actions remaining
   *  - 'failures' — circuit-breaker tripped (MAX_CONSECUTIVE_FAILURES)
   *  - 'aborted' — external signal cancellation */
  terminationReason: 'completed' | 'timeout' | 'depth_cap' | 'failures' | 'aborted';
  /** Per-depth visit count. Index = depth, value = nodes visited at that depth.
   *  Length = `maxDepth + 1`. Heat map of where the solver spent its budget;
   *  a long tail at the cap indicates depth pressure. */
  depthHistogram: number[];
  /** Optional diagnostic bundle — populated only by DFS when the
   *  empirical-validation spike requests it. Absent in production paths.
   *  Used to answer "why did the search tree stop where it did". */
  diagnostic?: DfsDiagnostic;
}

export interface DfsDiagnostic {
  /** Count of terminal nodes reached per reason. The sum over all reasons
   *  equals `totalTreeNodes` (roughly — every path ends in exactly one
   *  terminal). Used to diagnose whether the tree is bounded by natural
   *  exhaustion, loop detection, depth cap, or external cutoff. */
  terminalReasons: {
    actionsZero: number;     // OCGCore returned 0 legal actions at a player prompt
    depthCap: number;        // hit `maxDepth`
    loopDetected: number;    // pathHashes already contained this IDLECMD state
    treeSizeLimit: number;   // totalTreeNodes >= maxResultNodes
    abortOrNodeLimit: number; // signal abort OR probe nodeLimit reached
    budgetCutoff: number;    // 0 children explored after loop (time budget or abort mid-branch)
    ttHit: number;           // transposition table lookup short-circuited further exploration
    turn2: number;           // constraint 3.2 full: reached `fieldState.turn >= 2` (beyond search horizon)
    branchBoundCut: number;  // Phase I: upper-bound pruning (ancestor pathTurn1 + remaining-ply gain < bestTurn1)
    rootChildBudgetCut: number; // Phase L: first-level root-child branch exceeded its wall-clock slice without progress
  };
  /** Max explorationScore observed at `turn <= 1` states. Paired with
   *  `bestEndBoardCards` on the solver result. Diverges from
   *  `bestExplorationScore` / tree-propagated `explorationScore` when states
   *  beyond the turn-1 boundary outscore every turn-1 state seen. */
  bestTurn1ExplorationScore: number;
  /** Phase H: authoritative peak field-state snapshot captured when
   *  `bestTurn1ExplorationScore` was updated. Probes and diagnostics should
   *  read this instead of replaying the mainPath (which may desync under
   *  forkViaReplay semantics). Undefined when no turn-1 peak was recorded. */
  bestTurn1FieldState?: FieldState;
  /** Phase A #4: hint from the heuristic suggester (terminal reason
   *  distribution → suggested maxDepth for next run). Pure observability;
   *  does not affect the current run. Callers may use it to rerun with an
   *  adjusted bound when tuning fixtures. */
  suggestedMaxDepth: number;
  /** Prompt type counts observed at nodes with legal actions (exploratory
   *  prompts only — mechanical prompts are auto-resolved by the adapter). */
  promptTypeCounts: Record<string, number>;
  /** Per-depth sum of legal-action counts and per-depth count of nodes
   *  with at least one action. `bfByDepthSum[d] / bfByDepthCount[d]` yields
   *  the average BF at depth `d`. */
  bfByDepthSum: number[];
  bfByDepthCount: number[];
  /** Per-depth count of terminals with 0 legal actions. Reveals how deep
   *  the "stuck" states are. */
  actionsZeroByDepth: number[];
  /** First N sampled `actionsZero` terminals — captures phase/turn/LP so
   *  we can tell whether OCGCore ends the duel early or stalls mid-turn. */
  actionsZeroSamples: { depth: number; phase: string; turn: number; lp0: number; lp1: number; handSize: number }[];
}

export interface SolverProgress {
  nodesExplored: number;
  /** User-facing peak score emitted live during solve. Per-algorithm semantic:
   *   - DFS: `bestTurn1Breakdown.interruptionScore` when a turn-1 peak has
   *     landed, else 0 (methodology v5 — matches final reportScore and the
   *     frontend "Score d'interruption" label).
   *   - MCTS / Minimax-MCTS: the algorithm's internal backprop max.
   *  Label semantic is aligned on "interruption score" for DFS; MCTS variants
   *  retain their original backprop-max definition. */
  bestScore: number;
  elapsed: number;
  highComplexity?: boolean;
  /** Set when no nodesExplored advancement has been observed for stalledWarningMs. */
  stalled?: boolean;
}

// =============================================================================
// Handtrap & Adversarial
// =============================================================================

export interface HandtrapConfig {
  cardId: number;
  cardName: string;
}

export interface AdversarialTiming {
  stepIndex: number;
  handtrapCardId: number;
  handtrapCardName: string;
  responseIndex: number;
}

export interface VerifyResult {
  verified: boolean;
  divergenceStep?: number;
  reason?: string;
}

// =============================================================================
// Golden Test Cases
// =============================================================================

export interface GoldenTestCase {
  id: string;
  deck: number[];
  hand: number[];
  expectedOutcome: string;
  expectedMinScore?: number;
  expectedCards?: number[];
  mode: 'goldfish' | 'adversarial';
  algorithm: string;
  maxTimeMs: number;
}

// =============================================================================
// Config Schema Types
// =============================================================================

export interface SolverConfigFile {
  poolSize: number;
  maxDepth: number;
  timeBudgetFastMs: number;
  timeBudgetOptimalMs: number;
  progressThrottleMs: number;
  treePruningTopX: number;
  maxResultNodes: number;
  transpositionMaxEntries: number;
  memoryBudgetMb: number;
  bfComplexityThreshold: number;
  rateLimitIntervalMs: number;
  maxHandtraps: number;
  ucb1C: number;
  backpropPolicy: 'max' | 'mean';
  rolloutEpsilon: number;
  verificationBudgetRatio: number;
  stalledWarningMs: number;
  maxSolverConnections: number;
}

/** When/how an interruption effect can be activated. Used by the solver's
 *  effect-disambiguation logic to map a runtime activation prompt back to a
 *  specific entry in `InterruptionTag.effects[]`. */
export type InterruptionTrigger =
  | 'chain'        // Activatable in a chain (most negate effects)
  | 'main'         // Ignition effect, Main Phase only
  | 'quick'        // Quick effect, either player's turn
  | 'trigger'      // Triggers on a specific event (summon, destruction, etc.)
  | 'continuous';  // Continuous effect (no per-activation tracking)

export interface InterruptionEffect {
  type: InterruptionType;
  usesPerTurn: number;
  /** When this effect can be activated. Used by `disambiguateEffect()` to map
   *  a runtime SELECT_CHAIN/SELECT_IDLECMD prompt to a specific effect index.
   *  Optional for backward compat — missing trigger falls back to index 0 with
   *  a warning when multiple effects exist. */
  trigger?: InterruptionTrigger;
  /** Zones in which this effect is scorable by the interruption scorer.
   *  Default (when absent): **on-field only** (M1-M5, S1-S5, FIELD, EMZ_L,
   *  EMZ_R) — matches the typical case (Apollousa, Baronne, Continuous
   *  Traps). Any non-field activation surface must opt in explicitly:
   *   - GY-trigger: `activeZones: ['GY']` (Mirrorjade, Eldlich, Necroface).
   *   - Banished face-up: `activeZones: ['BANISHED']` (Runick quick-plays).
   *   - Handtrap: `activeZones: ['HAND']` (Ash, Maxx "C", Nibiru, Veiler).
   *   - Dual-zone (field + GY): enumerate both zone groups explicitly.
   *  Added 2026-04-17 (Voie B). */
  activeZones?: readonly ZoneId[];
  /** Human-readable summary for debugging and UI tooltips. ≤120 chars. */
  description?: string;
}

export interface InterruptionTag {
  cardName: string;
  effects: InterruptionEffect[];
  /** True when the card's effects share a single hard OPT budget
   *  (e.g., "you can only use 1 effect of [card] per turn, and only once that turn").
   *  Default false — each effect has its own independent OPT counter. */
  sharedOpt?: boolean;
  /** Override for the shared OPT budget when `sharedOpt: true`. Defaults to
   *  `sum(effects.usesPerTurn)` if omitted. */
  totalUsesPerTurn?: number;
  /** Audit metadata — name of the generator (e.g., 'claude-opus-4-6'). */
  _generatedBy?: string;
  /** Audit metadata — ISO date of the oracle text used. */
  _oracleVersion?: string;
  /** True when a human has reviewed and validated this entry. */
  _validated?: boolean;
}

/** Per-handle log of interruption effect activations consumed during the
 *  current turn. Key: cardId. Value: list of effect indices (positions in
 *  `InterruptionTag.effects[]`) that have been activated, in order. The same
 *  index can appear multiple times if the effect has `usesPerTurn > 1`.
 *  Cleared on every NEW_TURN. Used by the scorer for OPT-aware evaluation
 *  and by the transposition table for verification key fingerprinting. */
export type ActivationLog = ReadonlyMap<number, readonly number[]>;

/** Deep-clone an activation log into a fresh standalone Map. Each entry's
 *  array is reallocated so mutations on the clone do not leak back to the
 *  source. Shared by `OCGCoreAdapter.forkViaReplay` (DFS branch isolation)
 *  and `mcts-solver.simulate` (rollout snapshot before handle destruction). */
export function cloneActivationLog(src: ActivationLog | Map<number, number[]>): Map<number, number[]> {
  const dst = new Map<number, number[]>();
  for (const [k, v] of src) dst.set(k, [...v]);
  return dst;
}

// =============================================================================
// Solver Error Types
// =============================================================================

export type SolverError =
  | 'DECK_NOT_FOUND'
  | 'DECK_ACCESS_DENIED'
  | 'WASM_INIT_FAILED'
  | 'RATE_LIMITED'
  | 'MEMORY_LIMIT'
  | 'INTERNAL_ERROR';

// =============================================================================
// Shared Constants
// =============================================================================

/** Canonical zone iteration order — use this instead of Object.keys() for determinism. */
export const ALL_ZONE_IDS: readonly ZoneId[] = [
  'M1', 'M2', 'M3', 'M4', 'M5',
  'S1', 'S2', 'S3', 'S4', 'S5',
  'FIELD', 'EMZ_L', 'EMZ_R',
  'GY', 'BANISHED', 'EXTRA', 'DECK', 'HAND',
] satisfies readonly ZoneId[];

// =============================================================================
// Re-exports from Zobrist / Transposition modules (convenience for DFS consumer)
// =============================================================================

export type { ZobristHash } from './zobrist.js';
export type { TranspositionEntry } from './transposition-table.js';
