# API Contracts — Duel Server (Node)

> The duel-server speaks two protocols: **HTTP** for internal back-end coordination (port 3001), and **WebSocket** for browsers (PvP, replay, solver). All HTTP endpoints under `/api/*` validate `X-Internal-Key`.

## HTTP

### `GET /health`
Liveness probe. Returns `200 { ok: true }` if `isDataReady`, else `503`. Used by Docker healthcheck.

### `GET /status`
Server stats — public.
```json
{
  "activeDuels": 3,
  "totalDuelsServed": 142,
  "protocolMismatchCount": 7,
  "uptimeMs": 86400000,
  "rssBytes": 314572800
}
```

### `GET /api/duels/active` *(internal)*
Returns the list of in-flight duel IDs. Consumed by Spring's `RoomCleanupScheduler` to detect rooms that should have been torn down.

### `PUT /api/update-data` *(internal)*
Pulls fresh `cards.cdb` + scripts (typically from ProjectIgnis), then re-initializes the solver pool with the new card data. **Blocks while duels are active** — the call returns when the swap is safe.

### `POST /api/validate-passcodes` *(internal)*
```json
{ "passcodes": [10000010, 14558127, ...] }
```
Returns which passcodes are present in `cards.cdb` and which are missing. Used by the back-end to pre-flight a deck before letting the user enter the duel.

### `POST /api/duels` *(internal)*
Creates a duel session.
```json
{
  "player1": { "userId": 1, "username": "alice", "deck": { "main": [...], "extra": [...] } },
  "player2": { "userId": 2, "username": "bob",   "deck": { "main": [...], "extra": [...] } },
  "options": { "speed": "normal", "tcgRules": false }
}
```
Returns:
```json
{
  "duelId": "uuid",
  "wsToken1": "uuid",
  "wsToken2": "uuid"
}
```
Arms a 60-second connection timeout — if neither player connects, the session is cleaned up.

### `DELETE /api/duels/:duelId` *(internal)*
Tears down a duel session. Called when a room is closed externally (admin force-end, surrender via REST, etc.).

## WebSocket — connection modes

The server inspects `?mode=` to route the connection.

| `?mode=` | Purpose | Auth | Protocol version gate |
|---|---|---|---|
| (omitted) | PvP duel | `?token=...` (initial) or `?reconnect=...` | yes (close 4426 on mismatch) |
| `replay` | Replay viewer | JWT in `?token=`, plus `?replayId=<uuid>` | yes |
| `solver` | Combo solver | JWT in `?token=` (decoded for `userId`) | no (currently exempt) |

Common close codes:
- `4001` — token unknown / session-gone (PvP) or replaced solver connection.
- `4029` — rate-limit exceeded or solver max-connections reached.
- `4426` — protocol-version mismatch (HTTP-426 analog). The front MUST surface "client outdated, refresh".

### Protocol files (synced front↔back)

The protocol is split into 6 sub-files re-exported via the `ws-protocol.ts` barrel. **Edit sub-files, not the barrel.**

| Sub-file | Contents |
|---|---|
| `ws-protocol-shared.ts` | `Player` (0\|1), `Phase`, `LOCATION`, `POSITION`, `BoardStatePayload`, `BOARD_CHANGING_EVENT_TYPES` |
| `ws-protocol-game.ts` | `MSG_*` (MOVE, DRAW, DAMAGE, CHAINING, BATTLE, ATTACK, COUNTER, FLIP_SUMMONING, ...) — all BOARD_CHANGING events live here |
| `ws-protocol-prompts.ts` | `SELECT_*`, `ANNOUNCE_*`, `SORT_*`, `PlayerResponseMsg` |
| `ws-protocol-system.ts` | Lifecycle (`DUEL_END`, `RPS`, `TP`, `REMATCH`, `STATE_SYNC`, `CHAIN_STATE`, `TIMER_STATE`, `INACTIVITY_WARNING`, surrender, cancel, etc.) |
| `ws-protocol-replay.ts` | `REPLAY_BOARD_STATES`, `REPLAY_METADATA`, fork lifecycle |
| `ws-protocol-solver.ts` | `SOLVER_INIT`, `SOLVER_START`, `SOLVER_PROGRESS`, `SOLVER_RESULT`, `SOLVER_CANCELLED`, `SOLVER_ERROR`, `SOLVER_HANDTRAPS` |

`scripts/check-ws-protocol-sync.mjs` byte-compares all six between front (`front/src/app/pages/pvp/duel-ws.types.ts/`) and back (`duel-server/src/`) — modulo the `.js` import suffix on the back. Runs as the duel-server `prebuild` step. Build fails on divergence.

## PvP WebSocket — message catalogue

> Only the most load-bearing types are listed below. The full TypeScript-level contract lives in the protocol sub-files.

### Server → Client (system / lifecycle)

| Type | When | Payload |
|---|---|---|
| `SESSION_TOKEN` | After connection bind | `{ token: string }` (next reconnect token) |
| `DUEL_STARTING` | Both players connected | `{ playerIndex, ownDeckCardCodes }` |
| `STATE_SYNC` | After connect / reconnect | `{ board: BoardStatePayload }` |
| `CHAIN_STATE` | After connect during chain | `{ activeChainLinks, chainPhase, currentSolvingChainIndex, negatedIndices }` |
| `TIMER_STATE` | Periodically + on phase | `{ remainingMs, perPlayerRemainingMs }` |
| `RPS_REQUEST` / `RPS_RESULT` | Pre-duel | RPS choices + outcome |
| `TP_RESULT` | After RPS winner picks | who plays first |
| `OPPONENT_DISCONNECTED` | Opponent lost connection | `{ graceMs }` |
| `INACTIVITY_WARNING` | Idle approaching timeout | `{ secondsRemaining }` |
| `DUEL_END` | Duel finished | `{ winner: 0 \| 1 \| null, reason }` |
| `REMATCH_PROPOSAL` / `REMATCH_ACCEPTED` / `REMATCH_DECLINED` | Post-game | rematch flow |

### Server → Client (game events — MSG_*)

All `MSG_*` types in `ws-protocol-game.ts`. Highlights:

- **`MSG_NEW_TURN`** — turn boundary (turnPlayer, turnCount)
- **`MSG_NEW_PHASE`** — phase change (drawPhase, mainPhase1, battlePhase, ...)
- **`MSG_DRAW`** — card drawn (player, count, isLowestCardId)
- **`MSG_MOVE`** — card moved (`from`/`to` location + sequence/position)
- **`MSG_DAMAGE`** — LP damage
- **`MSG_RECOVER`** — LP recovery
- **`MSG_PAY_LPCOST`** — LP cost
- **`MSG_CHAINING`** / `MSG_CHAIN_SOLVING` / `MSG_CHAINED` / `MSG_CHAIN_SOLVED` / `MSG_CHAIN_NEGATED` / `MSG_CHAIN_END` — chain lifecycle
- **`MSG_FLIP_SUMMONING`** / `MSG_FLIPSUMMONED` / `MSG_SUMMONING` / `MSG_SUMMONED` / `MSG_SPSUMMONING` / `MSG_SPSUMMONED` — summon flows
- **`MSG_SET`** — card set face-down
- **`MSG_BECOME_TARGET`** — target indicator
- **`MSG_CONFIRM_CARDS`** — reveal cards (often after tutor)
- **`MSG_SHUFFLE_HAND`** / `MSG_SHUFFLE_DECK`
- **`MSG_ATTACK`** / `MSG_BATTLE`
- **`MSG_WIN`** — duel result (player, type)

Events listed in `BOARD_CHANGING_EVENT_TYPES` (see `ws-protocol-shared.ts`) carry an optional `boardStateAfter: BoardStatePayload` field while a chain is resolving — the snapshot is the post-event ocgcore state, attached server-side by `ChainSnapshotTracker` (same class for live + replay precompute).

### Server → Client (prompts — SELECT_*, ANNOUNCE_*, SORT_*)

Promp subtypes drive the React-style UI rendering on the front. Listed in `ws-protocol-prompts.ts`. Highlights:

- `SELECT_CARD`, `SELECT_UNSELECT_CARD`, `SELECT_TRIBUTE`, `SELECT_SUM`, `SELECT_COUNTER`, `SELECT_PLACE`, `SELECT_DISFIELD`
- `SELECT_BATTLECMD`, `SELECT_IDLECMD`, `SELECT_CHAIN`, `SELECT_YESNO`, `SELECT_OPTION`, `SELECT_POSITION`, `SELECT_EFFECTYN`
- `ANNOUNCE_CARD`, `ANNOUNCE_NUMBER`, `ANNOUNCE_RACE`, `ANNOUNCE_ATTRIB`
- `SORT_CARD`, `SORT_CHAIN`
- `CONFIRM_CARDS`, `CONFIRM_DECKTOP`

Each prompt carries a `promptType` discriminator and the data the UI needs (selectable cards, ranges, hints).

### Client → Server

| Type | Purpose |
|---|---|
| `PLAYER_RESPONSE` | Reply to a `SELECT_*` / `ANNOUNCE_*` / `SORT_*` prompt: `{ promptType, data }`. Worker validates bounds before applying via `capturedSetResponse`. |
| `SURRENDER` | Concede the duel |
| `CANCEL_ACTION` | Cancel a queued action when a rollback boundary is reached |
| `REMATCH_REQUEST` / `REMATCH_RESPONSE` | Post-duel rematch flow |
| `CHAT` (if enabled) | Text chat |
| `READY` | Solo mode "ready" toggle (P0 phase wait) |

## Replay WebSocket — `?mode=replay`

| Server → Client | Purpose |
|---|---|
| `REPLAY_METADATA` | Match info, player decks, totalResponses |
| `REPLAY_BOARD_STATES` | Precomputed states per decision moment (or chunked) |
| `REPLAY_ERROR` | Errors / fork divergence |
| `REPLAY_FORK_CREATED` | Forked game tokens |

| Client → Server | Purpose |
|---|---|
| `REPLAY_SEEK` | Jump to a turn / response index |
| `REPLAY_FORK` | Spin off a fork from a decision (issues new wsToken) |

## Solver WebSocket — `?mode=solver`

| Server → Client | Payload |
|---|---|
| `SOLVER_HANDTRAPS` | `{ deckId, handtraps: [{cardId, cardName, ...}] }` (cache for the user's deck) |
| `SOLVER_PROGRESS` | `{ nodesSearched, bestScore, elapsedMs }` |
| `SOLVER_RESULT` | `{ tree, bestPath, breakdown }` |
| `SOLVER_CANCELLED` | `{ reason }` |
| `SOLVER_ERROR` | `{ message }` |

| Client → Server | Payload |
|---|---|
| `SOLVER_INIT` | `{ deckId, config }` (handshake; server caches deck + answers `SOLVER_HANDTRAPS`) |
| `SOLVER_START` | `{ board: BoardStatePayload, handtraps, timeBudgetMs, options }` |
| `SOLVER_CANCEL` | (no payload) |

The orchestrator (`src/solver/solver-orchestrator.ts`) pools Piscina workers; `solver-config.json` holds hyperparameters (poolSize, time budgets, maxHandtraps, transpositionMaxEntries, ucb1C, backpropPolicy).

`SOLVER_RESULT` results may also be cached briefly per-user (`solverResultCache`) so a quick reconnect can pick up the last result without re-running.

## See also

- [integration-architecture.md](./integration-architecture.md) for the full back ↔ duel-server ↔ front wiring.
- [architecture-duel-server.md](./architecture-duel-server.md) for the runtime model.
- [`../CLAUDE.md`](../CLAUDE.md) for the chain state machine, pre-lock contract, replay parity rules, and the `POLL-DROP REGRESSION` watchdog.
