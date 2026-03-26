import { InjectionToken, Signal } from '@angular/core';
import type { DuelState, Prompt, GameEvent, ChainLinkState } from '../types';

/**
 * Data source interface for the animation pipeline.
 *
 * Implemented by DuelWebSocketService (live PvP) and ReplayDuelAdapter (replay).
 * Injected by AnimationOrchestratorService and PvpChainOverlayComponent via
 * the ANIMATION_DATA_SOURCE token — they never reference the concrete class.
 *
 * NOTE: DuelConnection (duel-connection.ts) is an EXISTING concrete class
 * with WebSocket internals. Do NOT modify it. This interface extracts only
 * the subset needed by the animation pipeline.
 */
export interface AnimationDataSource {
  readonly duelState: Signal<DuelState>;
  readonly animationQueue: Signal<GameEvent[]>;
  readonly activeChainLinks: Signal<ChainLinkState[]>;
  readonly chainPhase: Signal<'idle' | 'building' | 'resolving'>;
  readonly pendingPrompt: Signal<Prompt | null>;

  dequeueAnimation(): GameEvent | null;
  removeAnimationAt(index: number): void;
  applyPendingBoardState(): void;
  setAnimating(animating: boolean): void;
  setDrawMaskActive(active: boolean): void;
  applyChainSolving(chainIndex: number): void;
  applyChainSolved(chainIndex: number): void;
  applyChainEnd(): void;
}

export const ANIMATION_DATA_SOURCE = new InjectionToken<AnimationDataSource>('AnimationDataSource');
