import type { BoardStatePayload, Player, PlayerBoardState, ServerMessage } from './duel-ws.types';

/**
 * Perspective swap for a `BoardStatePayload`.
 *
 * The server relativizes only `players[]` + `turnPlayer` per the receiving
 * connection's `forPlayer` filter (cf. `duel-server/src/message-filter.ts`
 * `sanitizeBoardState`). In two contexts the front needs to swap a
 * payload that arrived UNswapped:
 *
 * 1. **Replay** — precompute data is perspective-agnostic; the adapter
 *    swaps every `BoardStatePayload` it consumes when `perspectiveIndex = 1`.
 *
 * 2. **SOLO PvP multiplex (γ Option C)** — the single socket receives
 *    omniscient (absolute) board states; `DuelConnection.handleMessage`
 *    swaps when the user's current visual perspective is 1.
 *
 * Both call sites are documented in CLAUDE.md "Perspective Convention" §2
 * and "Replay Board State Parity Rule".
 *
 * Pure function — no `this`, no closures. Caller passes the desired
 * perspective directly; `perspective === 0` returns the payload unchanged
 * (identity fast-path), `perspective === 1` returns a shallow-cloned
 * payload with `players` reversed and `turnPlayer` flipped.
 */
export function swapBoardState(bs: BoardStatePayload, perspective: 0 | 1): BoardStatePayload {
  if (perspective === 0) return bs;
  return {
    ...bs,
    turnPlayer: (bs.turnPlayer === 0 ? 1 : 0) as Player,
    players: [bs.players[1], bs.players[0]] as [PlayerBoardState, PlayerBoardState],
  };
}

/**
 * Relativize the per-event `boardStateAfter` snapshot attached server-side
 * to BOARD_CHANGING events during chain resolution (cf. CLAUDE.md
 * "Per-event boardStateAfter snapshot"). `swapBoardState` alone only
 * covers the top-level `boardState`; the snapshot buried on each event is
 * consumed directly by `AnimationOrchestratorService.processEvent()` via
 * `rbs.updateLogical(event.boardStateAfter)`. Left un-swapped, perspective=1
 * renders the board with absolute server P0 at the bottom for one frame
 * before the next commit corrects it — the "board briefly flips" symptom.
 *
 * Returns the events untouched for perspective 0, and a shallow-cloned
 * array (only events carrying a snapshot are cloned) for perspective 1.
 */
export function swapEventBoardStates(events: ServerMessage[], perspective: 0 | 1): ServerMessage[] {
  if (perspective === 0) return events;
  return events.map(e => {
    const snapshot = (e as { boardStateAfter?: BoardStatePayload }).boardStateAfter;
    if (!snapshot) return e;
    return { ...e, boardStateAfter: swapBoardState(snapshot, perspective) };
  });
}
