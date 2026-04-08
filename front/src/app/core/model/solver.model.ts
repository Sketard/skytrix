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
  total: number;
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
}

export const EMPTY_SCORE_BREAKDOWN: ScoreBreakdown = {
  omniNegate: 0, typedNegate: 0, targetedNegate: 0, floodgate: 0,
  controlChange: 0, banish: 0, banishFacedown: 0, attach: 0,
  spin: 0, flipFacedown: 0, destruction: 0, moveToSt: 0,
  bounce: 0, handRip: 0, sendToGy: 0, total: 0,
};

// =============================================================================
// Solver Progress & Stats
// =============================================================================

export interface SolverProgress {
  nodesExplored: number;
  bestScore: number;
  elapsed: number;
  highComplexity?: boolean;
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
  deckId: string;
  deck: { main: number[]; extra: number[] };
  hand: number[];
  mode: 'goldfish';
  speed: 'fast' | 'optimal';
  algorithm?: 'dfs' | 'mcts' | 'auto';
}

// =============================================================================
// Solver State Machine
// =============================================================================

export type SolverState =
  | 'loading'
  | 'idle'
  | 'configuring'
  | 'running'
  | 'cancelled'
  | 'complete'
  | 'error';
