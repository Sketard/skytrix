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
}

export interface InterruptionEffect {
  type: InterruptionType;
  usesPerTurn: number;
}

export interface InterruptionTag {
  cardName: string;
  effects: InterruptionEffect[];
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
