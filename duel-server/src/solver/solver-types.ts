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
  /** weighted + fallbackPoints. Surfaced as the headline score in the UI. */
  total: number;
}

export const INTERRUPTION_TYPES = [
  'omniNegate', 'typedNegate', 'targetedNegate', 'floodgate',
  'controlChange', 'banish', 'banishFacedown', 'attach',
  'spin', 'flipFacedown', 'destruction', 'moveToSt',
  'bounce', 'handRip', 'sendToGy',
] as const;

export type InterruptionType = (typeof INTERRUPTION_TYPES)[number];

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
}

// =============================================================================
// Solver Configuration & Results
// =============================================================================

export interface SolverConfig {
  mode: 'goldfish' | 'adversarial';
  speed: 'fast' | 'optimal';
  timeLimitMs: number;
  handtraps?: HandtrapConfig[];
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
  transpositionHits?: number;
  deckSeed: string;
  /** Set when a solver bails out early due to a streak of iteration errors. */
  abortedDueToFailures?: number;
}

export interface SolverProgress {
  nodesExplored: number;
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
  ismctsDeterminizations: number;
  maxHandtraps: number;
  ucb1C: number;
  backpropPolicy: 'max' | 'mean';
  rolloutEpsilon: number;
  verificationBudgetRatio: number;
  stalledWarningMs: number;
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
