import type { ServerMessage, Player, BoardStatePayload } from './ws-protocol.js';
import type { GameLogEntry } from './game-log/game-log-types.js';
import { GameLogBuilder } from './game-log/game-log-builder.js';
import { filterMessage } from './message-filter.js';

/**
 * Per-session game-log state — one `GameLogBuilder` per perspective.
 *
 * Why two builders instead of one + a post-build relativizer: the builder
 * relativises 4 distinct fields (`RowHead.player`, `BoardCell.player`,
 * `LpLoss.player`, `MovedCard.destCell.player`) deep inside its emit paths
 * via a private `this.rel(absolute)` helper. A relativizer running on the
 * built entries would have to mirror that knowledge — every schema evolution
 * of `GameLogEntry` then has TWO copies of the rule to keep in sync, and a
 * missed field is a silent perspective-swap bug. Two builders cost ~150 KB
 * + a duplicate `ingestEvent` call per WS message (the builder is light); 50
 * concurrent sessions ≈ 15 MB. The robustness trade beats the duplication.
 *
 * The builders ingest the same raw event stream; only the board snapshot
 * is sanitized per perspective (the `players[]` swap + private-info mask
 * matches what `filterMessage('BOARD_STATE', p)` would produce).
 *
 * No resolvers injected: `MSG_CHAINING` carries `descriptionText` resolved
 * worker-side, and `MSG_DRAW` `cardName` resolution is the front's job (its
 * panel renderer reads from local card data). Keeps this module DB-free.
 */
export interface SessionGameLog {
  builders: [GameLogBuilder, GameLogBuilder];
  /** Last board snapshot, sanitized per recipient — needed by `ingestEvent`
   *  for `MSG_BECOME_TARGET` (which resolves target identities through the
   *  board). Null until the first BOARD_STATE arrives. */
  lastSanitizedBoard: [BoardStatePayload | null, BoardStatePayload | null];
}

export function createSessionGameLog(): SessionGameLog {
  return {
    builders: [new GameLogBuilder(0), new GameLogBuilder(1)],
    lastSanitizedBoard: [null, null],
  };
}

/**
 * Ingest one outgoing server message into both perspective builders.
 *
 * BOARD_STATE messages drive turn/phase separator synthesis: each builder
 * gets the snapshot sanitized for its own perspective, mirroring exactly
 * what `filterMessage` would produce when sending to that recipient.
 *
 * Other messages are fed verbatim (the builder reads only absolute `player`
 * fields, which it relativises internally via `this.rel()`). The
 * most-recent sanitized board is passed alongside for the `MSG_BECOME_TARGET`
 * path that needs it for identity resolution.
 *
 * Side-effect free on `message`. Mutates only the session's `gameLog` field.
 */
export function ingestMessage(log: SessionGameLog, message: ServerMessage): void {
  if (message.type === 'BOARD_STATE') {
    for (const p of [0, 1] as const) {
      const sanitized = sanitizeBoardForPerspective(message.data, p);
      log.lastSanitizedBoard[p] = sanitized;
      log.builders[p].syncTurnAndPhase(sanitized);
    }
    return;
  }
  for (const p of [0, 1] as const) {
    // OCGCore emits MSG_DRAW × 5 (initial hand) BEFORE the first BOARD_STATE
    // (start_duel fires before the first prompt). Feed those events too — the
    // builder reads `board` only in `MSG_BECOME_TARGET` (which can't fire
    // before the opening hand), so a stub board is safe for the pre-BOARD_STATE
    // window. Without this fallback the opening-hand row never reaches the
    // journal and an F5 right after the opening shows an empty journal.
    const board = log.lastSanitizedBoard[p] ?? STUB_EMPTY_BOARD;
    log.builders[p].ingestEvent(message, board);
  }
}

/** Stub board for pre-BOARD_STATE events. The builder's `MSG_BECOME_TARGET`
 *  path would call `resolveBoardCard(board, ...)` against this — but that
 *  event cannot fire before the opening hand has been drawn, so the path is
 *  unreachable here. Other event types ignore `board`. */
const STUB_EMPTY_BOARD: BoardStatePayload = {
  turnPlayer: 0,
  turnCount: 0,
  phase: 'DRAW',
  players: [
    { lp: 8000, hand: 0, zones: [] } as unknown as BoardStatePayload['players'][0],
    { lp: 8000, hand: 0, zones: [] } as unknown as BoardStatePayload['players'][0],
  ],
} as unknown as BoardStatePayload;

/**
 * Read the entries the recipient should see — caller attaches to the
 * outgoing STATE_SYNC. Returns a snapshot copy so a later ingest cannot
 * mutate what was sent.
 */
export function entriesForPlayer(log: SessionGameLog, player: Player): GameLogEntry[] {
  return log.builders[player].entries.slice();
}

/**
 * Sanitize a BOARD_STATE payload to match what a recipient would see. Mirrors
 * `message-filter.sanitizeBoardState` (kept private). Re-routed through
 * `filterMessage('BOARD_STATE', forPlayer)` so the sanitization logic is not
 * duplicated — single source of truth for what each player sees.
 */
function sanitizeBoardForPerspective(
  data: BoardStatePayload,
  forPlayer: Player,
): BoardStatePayload {
  const msg: ServerMessage = { type: 'BOARD_STATE', data };
  const filtered = filterMessage(msg, forPlayer);
  if (filtered && filtered.type === 'BOARD_STATE') return filtered.data;
  return data;
}
