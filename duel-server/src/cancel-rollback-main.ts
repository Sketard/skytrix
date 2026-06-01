import type { ActiveDuelSession } from './types.js';
import type { ServerMessage, Player } from './ws-protocol.js';
import { filterMessage } from './message-filter.js';
import * as logger from './logger.js';

/**
 * Main-thread side of the cancel-rollback protocol (P0-3bis.3, post-U38
 * extraction 2026-06-01). The full cross-process contract — worker WASM
 * snapshot, server-side state slots reset, client-side processor.reset —
 * lives in `_bmad-output/planning-artifacts/cancel-rollback-contract.md`.
 *
 * Two surfaces, called from different modules :
 *
 *   - `snapshotCancelTarget(session, p, prompt)` — called from
 *     `client-message-router.ts` on every IDLECMD/BATTLECMD `PLAYER_RESPONSE`
 *     commit. Caches the prompt at the rollback boundary so the cancel
 *     handler can re-broadcast it without depending on `lastSentPrompt`
 *     (which is overwritten by intermediate SELECT_PLACE / SELECT_TRIBUTE /
 *     SELECT_POSITION sub-prompts before the user can right-click cancel).
 *     Also resets the auxiliary state slots that mid-step prompts may have
 *     dirtied (`invalidResponseCount`, `lastSentHint`).
 *
 *   - `applyCancelRollbackBroadcast(session, p, send)` — called from
 *     `worker-message-router.ts WORKER_CANCEL_DONE`. After the worker has
 *     rolled its WASM state back to the IDLECMD/BATTLECMD boundary, this
 *     function re-broadcasts STATE_SYNC + empty CHAIN_STATE + the cached
 *     prompt, mirrors the server-side chain bookkeeping, and clears the
 *     cache.
 *
 * Centralising the broadcast keeps the worker-message-router branch lean
 * and makes the contract testable in isolation (no need to fire the
 * worker message itself). The verbose docstrings on each step migrated
 * from the original inline branch so the inventory stays grep-able from
 * the new location.
 */

/**
 * Snapshot the rollback target prompt at IDLECMD/BATTLECMD commit time.
 *
 * The cached prompt is what `applyCancelRollbackBroadcast` will re-send
 * when the user cancels. We capture it HERE (at commit) rather than at
 * cancel time because intermediate SELECT_PLACE / SELECT_TRIBUTE /
 * SELECT_POSITION sub-prompts overwrite `lastSentPrompt` between the
 * IDLECMD boundary and the user's right-click.
 *
 * Caller responsibility — the per-PLAYER_RESPONSE resets
 * (`awaitingResponse = false`, `invalidResponseCount = 0`,
 * `lastSentHint = null`) stay in `client-message-router.ts` because they
 * fire on EVERY commit, not just IDLECMD/BATTLECMD. Folding them in here
 * would silently change the behavior (mid-sequence sub-prompts would no
 * longer reset their counters), regression-untested.
 */
export function snapshotCancelTarget(
  session: ActiveDuelSession,
  playerIndex: 0 | 1,
  prompt: ServerMessage | null,
): void {
  session.cancelTargetPrompt[playerIndex] = prompt;
}

/**
 * Re-broadcast the cached IDLECMD/BATTLECMD prompt + auxiliary
 * STATE_SYNC / CHAIN_STATE so the client returns to the action menu.
 *
 * Returns `true` if the rollback was applied, `false` if no cached
 * prompt was found (logged + no-op).
 *
 * γ Option C PR2 c6bis (A30) — SOLO multiplex routes the 3 sends to
 * socket 0 (the only live one). STATE_SYNC filter goes omniscient so
 * the SOLO viewer's player-1 perspective sees the rollback's private
 * fields (hand contents, deck order) it needs to render its slot
 * correctly. PvP normal routes to socket `p` with the standard
 * per-player filter.
 */
export function applyCancelRollbackBroadcast(
  session: ActiveDuelSession,
  playerIndex: 0 | 1,
  send: (s: ActiveDuelSession, dest: 0 | 1, m: ServerMessage) => void,
): boolean {
  const cached = session.cancelTargetPrompt[playerIndex];
  if (!cached) {
    logger.warn('CANCEL: no cached IDLECMD/BATTLECMD to re-broadcast', {
      duelId: session.duelId, player: playerIndex,
    });
    return false;
  }

  const dest: 0 | 1 = session.soloMode ? 0 : playerIndex;
  const omniscient = session.soloMode;

  logger.log('CANCEL: re-broadcasting IDLECMD/BATTLECMD prompt', {
    duelId: session.duelId, promptType: cached.type, player: playerIndex, dest,
  });

  // STATE_SYNC + empty CHAIN_STATE so the client's reset machinery runs
  // (processor.reset + commitAll + clear pendingPrompt + clear chain overlay).
  // Same path as a reconnection re-sync.
  if (session.lastBoardState && session.lastBoardState.type === 'BOARD_STATE') {
    const stateSync: ServerMessage = { type: 'STATE_SYNC', data: session.lastBoardState.data };
    const filtered = filterMessage(stateSync, playerIndex as Player, omniscient);
    if (filtered) send(session, dest, filtered);
  }
  send(session, dest, {
    type: 'CHAIN_STATE', links: [], phase: 'idle', negatedIndices: [],
  } as ServerMessage);

  // Mirror server-side chain bookkeeping so a subsequent reconnect-resync
  // sends the same empty chain.
  session.activeChainLinks = [];
  session.chainPhase = 'idle';
  session.negatedChainIndices.clear();
  session.currentSolvingChainIndex = null;

  // Hint replayed verbatim on reconnect would point at an effect that no
  // longer exists — drop it.
  session.lastSentHint[playerIndex] = null;

  // Cancel is a legitimate user action — don't accumulate retry strikes
  // toward `maxInvalidResponses`.
  session.invalidResponseCount[playerIndex] = 0;

  session.lastSentPrompt[playerIndex] = cached;
  session.awaitingResponse[playerIndex] = true;
  // The cached prompt already carries `player = p` (it's a SELECT_* /
  // IDLECMD payload), so the SOLO front routes it through slot p via
  // slotIndex(). PvP normal sends to player p directly.
  send(session, dest, cached);
  // Drop the cache — the prompt is now in flight and a future commit
  // will re-snapshot it.
  session.cancelTargetPrompt[playerIndex] = null;
  return true;
}
