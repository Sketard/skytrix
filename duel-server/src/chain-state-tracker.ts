import type { ServerMessage } from './ws-protocol.js';

/**
 * Server-side chain state, tracked per active duel session so a
 * reconnecting player can be re-synced via CHAIN_STATE before the duel
 * resumes. Mirrors `DuelEventProcessor` on the client (which owns the
 * client-side equivalent) but stays minimal — the server only needs to
 * snapshot the active links + phase + negated indices for the
 * reconnection handshake.
 *
 * Audit finding H8 — extracted from server.ts handleWorkerMessage so the
 * 4 chain transitions can be unit-tested in isolation without booting
 * the full WS server.
 */
export interface ChainStateContainer {
  /** Cumulative MSG_CHAINING messages from the current chain (cleared on
   *  MSG_CHAIN_END). Sent verbatim in CHAIN_STATE.links on reconnect. */
  activeChainLinks: ServerMessage[];
  /** Current chain phase: idle (no chain), building (between MSG_CHAINING
   *  and MSG_CHAIN_SOLVING), resolving (after MSG_CHAIN_SOLVING). */
  chainPhase: 'idle' | 'building' | 'resolving';
  /** Indices of links that received a MSG_CHAIN_NEGATED, accumulated for
   *  the current chain. Cleared on MSG_CHAIN_END. */
  negatedChainIndices: Set<number>;
  /** M22 — chainIndex of the link currently resolving (set at MSG_CHAIN_SOLVING,
   *  cleared at MSG_CHAIN_SOLVED + MSG_CHAIN_END). Used to tag MSG_CONFIRM_CARDS
   *  emitted during resolution so the client can filter prompt reveals per-link. */
  currentSolvingChainIndex: number | null;
}

/** Build a fresh chain state — used at session creation and on rematch. */
export function emptyChainState(): ChainStateContainer {
  return { activeChainLinks: [], chainPhase: 'idle', negatedChainIndices: new Set(), currentSolvingChainIndex: null };
}

/**
 * Apply a server-side chain transition based on an outgoing message.
 *
 * Transitions:
 *  - MSG_CHAINING: idle → building (first link only); push link onto activeChainLinks
 *  - MSG_CHAIN_SOLVING: → resolving
 *  - MSG_CHAIN_END: clear links + indices, → idle
 *  - MSG_CHAIN_NEGATED: add chainIndex to negated set (no phase change)
 *  - any other message: no-op
 *
 * Pure mutation of the passed-in `state` — the caller (handleWorkerMessage
 * in production, the spec in tests) owns the state lifecycle.
 */
export function applyChainTransition(state: ChainStateContainer, message: ServerMessage): void {
  switch (message.type) {
    case 'MSG_CHAINING':
      if (state.chainPhase === 'idle') state.chainPhase = 'building';
      state.activeChainLinks.push(message);
      break;
    case 'MSG_CHAIN_SOLVING':
      state.chainPhase = 'resolving';
      state.currentSolvingChainIndex = (message as { chainIndex: number }).chainIndex;
      break;
    case 'MSG_CHAIN_SOLVED':
      state.currentSolvingChainIndex = null;
      break;
    case 'MSG_CHAIN_END':
      state.activeChainLinks = [];
      state.chainPhase = 'idle';
      state.negatedChainIndices = new Set();
      state.currentSolvingChainIndex = null;
      break;
    case 'MSG_CHAIN_NEGATED': {
      const negIdx = (message as { chainIndex: number }).chainIndex;
      state.negatedChainIndices.add(negIdx);
      break;
    }
    default:
      // No-op for non-chain messages.
      break;
  }
}
