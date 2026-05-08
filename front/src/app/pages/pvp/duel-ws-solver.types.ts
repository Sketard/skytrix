// =============================================================================
// ws-protocol-solver.ts — Skytrix WS protocol — solver messages (Story 1.4)
// 8 message types (3 client→server, 5 server→client) + payload sub-types.
// Sync rule: same content as duel-server/src/ws-protocol-solver.ts
// (modulo `.js` import suffix). Canonical solver type definitions live in
// solver-types.ts; what's here is the lightweight WS-protocol mirror so the
// shared protocol files stay independent of the solver internals.
// =============================================================================

// =============================================================================
// Solver Message Type Constants
// =============================================================================

export const SOLVER_START = 'SOLVER_START' as const;
export const SOLVER_CANCEL = 'SOLVER_CANCEL' as const;
export const SOLVER_INIT = 'SOLVER_INIT' as const;
export const SOLVER_PROGRESS = 'SOLVER_PROGRESS' as const;
export const SOLVER_RESULT = 'SOLVER_RESULT' as const;
export const SOLVER_CANCELLED = 'SOLVER_CANCELLED' as const;
export const SOLVER_ERROR = 'SOLVER_ERROR' as const;
export const SOLVER_HANDTRAPS = 'SOLVER_HANDTRAPS' as const;

// =============================================================================
// Solver Payload Sub-Types (inlined from solver-types.ts)
// =============================================================================

export interface SolverWsAction {
  responseIndex: number;
  cardId: number;
  cardName: string;
  actionDescription: string;
}

export interface SolverWsScoreBreakdown {
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
  /** Latent combo-progress bonus (Phase 2.3 Dark Contract hardcode, Step 1
   *  F1/F2/F3 structural, Phase D enabler×target). */
  latentPoints?: number;
  /** User-facing end-board grade = weighted + fallbackPoints (methodology v5). */
  interruptionScore?: number;
  /** DFS guidance signal = interruptionScore + latentPoints (methodology v5). */
  explorationScore?: number;
}

export interface SolverWsDecisionNode {
  action: SolverWsAction;
  annotation: string;
  score: number;
  scoreBreakdown?: SolverWsScoreBreakdown;
  confidence: number;
  children: SolverWsDecisionNode[];
  isTerminal: boolean;
  handtrapLabel?: string;
  prunedChildren?: number;
  truncated?: boolean;
}

export interface SolverWsStats {
  nodesExplored: number;
  elapsed: number;
  algorithm: string;
  algorithmUsed: string;
  maxDepthReached: number;
  averageBranchingFactor: number;
  maxBranchingFactor: number;
  transpositionHits?: number;
  transpositionMisses?: number;
  transpositionStores?: number;
  transpositionEvictions?: number;
  transpositionStaleHits?: number;
  deckSeed: string;
  verifyDivergence?: string;
  budgetMs: number;
  truncated: boolean;
  terminationReason: 'completed' | 'timeout' | 'depth_cap' | 'failures' | 'aborted';
  depthHistogram: number[];
}

export interface SolverWsHandtrapConfig {
  cardId: number;
  cardName: string;
}

export interface SolverWsAdversarialTiming {
  stepIndex: number;
  handtrapCardId: number;
  handtrapCardName: string;
  responseIndex: number;
}

export interface SolverWsEndBoardCard {
  cardId: number;
  cardName: string;
  position: 'faceup-atk' | 'faceup-def' | 'facedown-def' | 'facedown';
  zone: string;
  effects: { type: string; usesPerTurn: number }[];
  isFallback: boolean;
  /** Number of OPT effects consumed by this card during the current turn. */
  consumedUses?: number;
}

export type SolverWsError =
  | 'DECK_NOT_FOUND'
  | 'DECK_ACCESS_DENIED'
  | 'WASM_INIT_FAILED'
  | 'RATE_LIMITED'
  | 'MEMORY_LIMIT'
  | 'INTERNAL_ERROR';

// =============================================================================
// Solver: Client → Server (3)
// =============================================================================

export interface SolverStartMessage {
  type: typeof SOLVER_START;
  /** Spring Boot deck ID. Server fetches the composition via JWT — never
   *  trust a client-supplied deck array. C2 fix from Epic 1 review. */
  deckId: string;
  hand: number[];
  mode: 'goldfish' | 'adversarial';
  speed: 'fast' | 'optimal';
  algorithm?: 'dfs' | 'mcts' | 'auto';
  handtraps?: SolverWsHandtrapConfig[];
  deckSeed?: string;
  verifyPath?: SolverWsAction[];
  verifyTimings?: SolverWsAdversarialTiming[];
  verifyExpectedScore?: number;
}

export interface SolverCancelMessage {
  type: typeof SOLVER_CANCEL;
}

export interface SolverInitMessage {
  type: typeof SOLVER_INIT;
}

// =============================================================================
// Solver: Server → Client (5)
// =============================================================================

export interface SolverProgressMessage {
  type: typeof SOLVER_PROGRESS;
  nodesExplored: number;
  bestScore: number;
  elapsed: number;
  highComplexity?: boolean;
  /** Set when no node-advancement has been observed for stalledWarningMs. */
  stalled?: boolean;
}

export interface SolverResultMessage {
  type: typeof SOLVER_RESULT;
  tree: SolverWsDecisionNode;
  mainPath: SolverWsAction[];
  score: number;
  scoreBreakdown: SolverWsScoreBreakdown;
  endBoardCards?: SolverWsEndBoardCard[];
  minimax?: number;
  adversarialTimings?: SolverWsAdversarialTiming[];
  stats: SolverWsStats;
  verified?: boolean;
  isVerifyResult?: boolean;
}

export interface SolverCancelledMessage {
  type: typeof SOLVER_CANCELLED;
  partialTree?: SolverWsDecisionNode;
  stats: SolverWsStats;
}

export interface SolverErrorMessage {
  type: typeof SOLVER_ERROR;
  error: SolverWsError;
  message: string;
}

export interface SolverHandtrapsMessage {
  type: typeof SOLVER_HANDTRAPS;
  handtraps: SolverWsHandtrapConfig[];
}
