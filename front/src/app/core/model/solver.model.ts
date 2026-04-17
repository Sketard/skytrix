// =============================================================================
// solver.model.ts — Frontend-facing solver types
// Must match backend solver-types.ts in the same commit
// =============================================================================

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
  /** Tag-only score (excludes fallback heuristic). Brick detection uses this. */
  weighted: number;
  /** Fallback heuristic bonus (untagged face-up monsters). */
  fallbackPoints: number;
  /** Latent combo-progress bonus (Phase 2.3 Dark Contract, Step 1 F1/F2/F3,
   *  Phase D enabler×target). Optional for backwards compatibility with
   *  pre-v5 payloads. */
  latentPoints?: number;
  /** User-facing end-board grade = weighted + fallbackPoints (methodology v5). */
  interruptionScore?: number;
  /** DFS guidance signal = interruptionScore + latentPoints (methodology v5). */
  explorationScore?: number;
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

export const EMPTY_SCORE_BREAKDOWN: ScoreBreakdown = {
  omniNegate: 0, typedNegate: 0, targetedNegate: 0, floodgate: 0,
  controlChange: 0, banish: 0, banishFacedown: 0, attach: 0,
  spin: 0, flipFacedown: 0, destruction: 0, moveToSt: 0,
  bounce: 0, handRip: 0, sendToGy: 0,
  weighted: 0, fallbackPoints: 0, latentPoints: 0,
  interruptionScore: 0, explorationScore: 0,
};

// =============================================================================
// Solver Progress & Stats
// =============================================================================

export interface SolverProgress {
  nodesExplored: number;
  bestScore: number;
  elapsed: number;
  highComplexity?: boolean;
  /** Set when no node-advancement has been observed for stalledWarningMs server-side. */
  stalled?: boolean;
}

export interface SolverStats {
  nodesExplored: number;
  elapsed: number;
  algorithm: string;
  algorithmUsed: string;
  maxDepthReached: number;
  averageBranchingFactor: number;
  /** Worst-case branching factor observed at any single node. */
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
  /** Effective compute budget for this solve (post verification reservation). */
  budgetMs: number;
  /** True when the search hit the depth cap OR ran out of time mid-exploration. */
  truncated: boolean;
  terminationReason: 'completed' | 'timeout' | 'depth_cap' | 'failures' | 'aborted';
  /** Per-depth visit count, length = maxDepth + 1. */
  depthHistogram: number[];
}

// =============================================================================
// End Board Card
// =============================================================================

export interface EndBoardCard {
  cardId: number;
  cardName: string;
  position: 'faceup-atk' | 'faceup-def' | 'facedown-def' | 'facedown';
  zone: string;
  effects: { type: string; usesPerTurn: number }[];
  isFallback: boolean;
  /** Number of OPT effects consumed by this card during the current turn. */
  consumedUses?: number;
}

// =============================================================================
// Solver Result
// =============================================================================

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
  partial?: boolean;
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
// Solver Error
// =============================================================================

export type { SolverWsError } from '../../pages/pvp/duel-ws.types';
import type { SolverWsError } from '../../pages/pvp/duel-ws.types';

export interface SolverErrorMessage {
  error: SolverWsError;
  message: string;
}

// =============================================================================
// Solver Start Config (emitted by SolverConfigComponent)
// =============================================================================

export interface SolverStartConfig {
  /** Spring Boot deck ID — server fetches the composition via JWT. C2 fix
   *  from Epic 1 review. The client no longer sends the deck contents. */
  deckId: string;
  hand: number[];
  mode: 'goldfish' | 'adversarial';
  speed: 'fast' | 'optimal';
  algorithm?: 'dfs' | 'mcts' | 'auto';
  handtraps?: HandtrapConfig[];
  deckSeed?: string;
}

// =============================================================================
// Solver State Machine
// =============================================================================

export type SolverState =
  | 'loading'
  | 'idle'
  | 'configuring'
  | 'running'
  | 'complete'
  | 'error';

// =============================================================================
// Session History (Story 3.1)
// =============================================================================

export interface HistoryEntryConfig {
  deckId: string;
  deckName: string;
  hand: Record<number, number>;
  mode: 'goldfish' | 'adversarial';
  speed: 'fast' | 'optimal';
  algorithm: 'dfs' | 'mcts' | 'auto';
  handtraps: number[];
}

export interface HistoryEntry {
  result: SolverResult;
  config: HistoryEntryConfig;
  handCardNames: string[];
  timestamp: number;
  /** Set for cancelled solves with partial tree — lets history UI differentiate. */
  partial?: boolean;
}

// =============================================================================
// Pinned Results (Story 3.2)
// =============================================================================

export interface PinnedResult {
  score: number;
  scoreBreakdown: ScoreBreakdown;
  mainPath: SolverAction[];
  endBoardCards: { cardId: number; cardName: string }[];
  handCards: { cardId: number; cardName: string }[];
  config: HistoryEntryConfig;
  minimax?: number;
  deckSeed?: string;
  savedAt: number;
}
