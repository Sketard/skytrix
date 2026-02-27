# Story 1.3: OCGCore Duel Engine & Anti-Cheat Filter

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want a server-side duel engine that enforces all Yu-Gi-Oh! game rules automatically,
so that duels are fair and no manual rule adjudication is needed.

## Acceptance Criteria

1. **Given** the duel server scaffold (Story 1.2) is in place
   **When** `duel-worker.ts` is implemented
   **Then** it spawns an OCGCore WASM instance via `@n1xx1/ocgcore-wasm` (`createCore({ sync: true })`)
   **And** it implements an event-driven duel loop: call `duelProcess()` → read `duelGetMessage()` → transform each `OcgMessage` to a `ServerMessage` DTO (covering all 49 types defined in `ws-protocol.ts`) → `parentPort.postMessage({ type: 'WORKER_MESSAGE', duelId, message: dto })`
   **And** the loop handles 3 `OcgProcessResult` states: `END` → post `WORKER_MESSAGE` with `MSG_WIN` + exit, `CONTINUE` → loop again immediately, `WAITING` → post all accumulated messages + **stop the loop** and wait for `parentPort.on('message')` before calling `duelProcess()` again
   **And** it receives player responses via `parentPort.on('message')` → validates `type === 'PLAYER_RESPONSE'` → transforms `ResponseData` to `OcgResponse` (using the `OcgResponseType` numeric discriminant from the technical reference) → `duelSetResponse(handle, response)` → resume the duel loop
   **And** it wraps `duelProcess()` in try/catch with a 30-second watchdog timer (`setTimeout` + `parentPort.postMessage({ type: 'WORKER_ERROR', duelId, error })`)
   **And** on OCGCore error or watchdog timeout → sends `WORKER_ERROR` to main thread → main thread declares draw + notifies both players

2. **Given** duel-worker.ts exists
   **When** `ocg-callbacks.ts` and `ocg-scripts.ts` are implemented
   **Then** `loadDatabase(dbPath)` reads `cards.cdb` via `better-sqlite3` and returns a `CardDB` object (prepared statement + closure, no global state). `CardDB` and `ScriptDB` type definitions are added to `types.ts`
   **And** `loadScripts(scriptDir)` reads all 20 startup Lua files from `scripts/` directory into memory and returns a `ScriptDB` object (`Map<string, string>` of filename→content for startup scripts + base path for on-demand card scripts)
   **And** `createCardReader(db: CardDB)` and `createScriptReader(scripts: ScriptDB)` are factory functions that return sync callbacks via closure injection (not global state)
   **And** `cardReader` returns `OcgCardData` with properly decoded fields: `setcodes` from packed 64-bit `setcode` column, `level` from `level & 0xFF`, `lscale` from `(level >> 24) & 0xFF`, `rscale` from `(level >> 16) & 0xFF`, `race` as `bigint`
   **And** `scriptReader` searches: `scripts/{name}`, `scripts/official/{name}`, then returns `null` if not found (with `console.warn`). Subdirectories `goat/` and `pre-release/` are out-of-scope for MVP (TCG format only)
   **And** startup health check performs lightweight validation: `cards.cdb` exists and is openable via `better-sqlite3` (open + close, no full load), `scripts/` directory exists and is non-empty. A `dataReady` boolean flag is set at startup and checked by `/health` (returns 503 with `{ status: 'unavailable', reason }` if validation failed). The full `loadDatabase`/`loadScripts` is done in each worker thread only — the main thread does NOT load card data into memory

3. **Given** duel-worker.ts and data loading exist
   **When** `server.ts` manages worker lifecycle
   **Then** each duel runs in a dedicated `Worker` thread via `new Worker(new URL('./duel-worker.js', import.meta.url))`
   **And** communication uses typed `postMessage` (never shared memory)
   **And** `POST /api/duels` accepts JSON body (parsed via `request.on('data')` with `Content-Length` check against `MAX_PAYLOAD_SIZE` — reject with 413 if exceeded): `{ player1: { id: string, deck: { main: number[], extra: number[] } }, player2: { id: string, deck: { main: number[], extra: number[] } } }`. Creates a `DuelSession`, generates a `duelId` (crypto.randomUUID), spawns a worker, passes both decklists to worker via `postMessage({ type: 'INIT_DUEL', duelId, decks })`, generates two one-time join tokens (`crypto.randomUUID` each), stores them in `pendingTokens: Map<string, { duelId, playerIndex }>`, returns `{ duelId, tokens: [token0, token1] }` with HTTP 201
   **And** `POST /api/duels/:id/join` is removed — token-based association replaces it. WebSocket `on('connection')` extracts `?token=xxx` from URL, looks up `pendingTokens.get(token)`, associates the WebSocket to the correct `PlayerSession` in the `DuelSession`, deletes the token from the map (one-time use). If both players are connected, sends `BOARD_STATE` initial to both
   **And** `server.ts` maintains `activeDuels: Map<string, DuelSession>` and `pendingTokens: Map<string, { duelId: string, playerIndex: 0 | 1 }>`
   **And** worker `on('exit')` triggers cleanup: close both player WebSockets, remove session from `activeDuels`, increment `totalDuelsServed`
   **And** `/health` checks `dataReady` flag (from AC2 startup validation) and returns 503 if false
   **And** `/status` updates `activeDuels` count from `activeDuels.size`
   **And** heartbeat: `ws.ping()` every 30 seconds per connection, `on('pong')` resets `isAlive` flag, interval checks and closes dead connections (missed pong → `ws.terminate()`)

4. **Given** the duel engine produces messages
   **When** `message-filter.ts` processes each message
   **Then** it exports `filterMessage(message: ServerMessage, forPlayer: Player): ServerMessage | null` — pure function, no side effects except `console.error` for unknown types
   **And** `MSG_DRAW`: returns a shallow copy with `cards[]` codes replaced by `0` when `forPlayer !== message.player` (opponent sees card count, not identity)
   **And** `MSG_SHUFFLE_HAND`: returns a shallow copy with `cards[]` codes replaced by `0` when `forPlayer !== message.player`
   **And** `MSG_MOVE`: returns a shallow copy with `cardCode` replaced by `0` when the card is moving to or from a non-public zone (`DECK`, `HAND`, `EXTRA`) AND `forPlayer` is not the card's controller. Specifically: sanitize when `toLocation` is private (e.g., returned to hand/deck) or `fromLocation` is private (e.g., from deck to field face-down). If both `from` and `to` are public (e.g., MZONE→GRAVE), pass through unfiltered
   **And** `MSG_HINT` with `hintType === 10` (HINT_EFFECT): routed only to `message.player` (returns `null` for opponent) — prevents hand card code leakage via effect activation hints
   **And** `MSG_CONFIRM_CARDS`: routed only to `message.player` (returns `null` for opponent)
   **And** All `SELECT_*` messages (20 types) + `RPS_CHOICE`: routed only to `message.player` (returns `null` for opponent)
   **And** Any message type NOT in the whitelist returns `null` (DROP) + `console.error('Dropped unknown message type: ${type}')` — **fail-safe: prefer missing display over info leak**
   **And** `BOARD_STATE` and `STATE_SYNC`: returns a deep copy with opponent's private information sanitized — for the opponent's hand zone: `cardCode` set to `null` (count preserved, identity hidden); for face-down cards on field (position `FACEDOWN_ATTACK` or `FACEDOWN_DEFENSE`): `cardCode` set to `null`; for opponent's extra deck zone: `cards` array replaced with empty array (count available via `extraCount` field). This ensures FR15/NFR6 compliance: the client never receives opponent hand contents, face-down card identities, or extra deck contents
   **And** All other recognized `ServerMessage` types pass through unfiltered to both players: `MSG_DAMAGE`, `MSG_RECOVER`, `MSG_PAY_LPCOST`, `MSG_CHAINING`, `MSG_CHAIN_SOLVING`, `MSG_CHAIN_SOLVED`, `MSG_CHAIN_END`, `MSG_FLIP_SUMMONING`, `MSG_CHANGE_POS`, `MSG_SWAP`, `MSG_ATTACK`, `MSG_BATTLE`, `MSG_WIN`, `DUEL_END`, `TIMER_STATE`, `RPS_RESULT`, `REMATCH_CANCELLED`, `WORKER_ERROR`

5. **Given** `server.ts` receives client→server WebSocket messages
   **When** a message arrives from a player
   **Then** `server.ts` validates: (a) sender WebSocket is associated with a `PlayerSession` in an active `DuelSession`, (b) parsed message `type` is in allowed set (`PLAYER_RESPONSE`, `SURRENDER`, `REMATCH_REQUEST`), (c) for `PLAYER_RESPONSE`: `awaitingResponse[playerIndex]` flag is true (prevents spam/out-of-sequence responses)
   **And** `awaitingResponse[playerIndex]` is set to `true` when a `SELECT_*` message is sent to that player, and cleared to `false` when `PLAYER_RESPONSE` is forwarded to the worker
   **And** invalid messages are dropped with `console.error` log (no response sent to client)
   **And** valid `PLAYER_RESPONSE` → sets `awaitingResponse[playerIndex] = false` → forwarded to worker via `worker.postMessage({ type: 'PLAYER_RESPONSE', playerIndex, data })`
   **And** valid `SURRENDER` → main thread (NOT worker) sends `DUEL_END { winner: opponentIndex, reason: 'surrender' }` to both players → terminates the worker via `worker.terminate()`

## Tasks / Subtasks

- [x] Task 1: Internal types — `CardDB`, `ScriptDB`, worker init message (AC: #2, #1)
  - [x] 1.1 Add `CardDB` interface to `types.ts` (wraps `better-sqlite3` prepared statement)
  - [x] 1.2 Add `ScriptDB` interface to `types.ts` (startup scripts map + base script path)
  - [x] 1.3 Add `InitDuelMessage` type to `types.ts`: `{ type: 'INIT_DUEL'; duelId: string; decks: [Deck, Deck] }` where `Deck = { main: number[]; extra: number[] }`
  - [x] 1.4 Add `PlayerResponseMessage` (main→worker): `{ type: 'PLAYER_RESPONSE'; playerIndex: 0 | 1; data: ResponseData }`
  - [x] 1.5 Update `WorkerToMainMessage` union if needed (existing types should suffice)
- [x] Task 2: `ocg-scripts.ts` — Data loading (AC: #2)
  - [x] 2.1 Implement `loadDatabase(dbPath: string): CardDB` — open `better-sqlite3` readonly, prepare statement `SELECT id, ot, alias, setcode, type, atk, def, level, race, attribute, category FROM datas WHERE id = ?`
  - [x] 2.2 Implement `loadScripts(scriptDir: string): ScriptDB` — read 20 startup Lua files into `Map<string, string>`, store `scriptDir` as base path for on-demand reads
  - [x] 2.3 Implement `validateData(db: CardDB, scripts: ScriptDB): { ok: boolean; reason?: string }` — checks DB readable (test query) + scripts map non-empty
  - [x] 2.4 Export `STARTUP_SCRIPTS` constant array (20 filenames from technical reference §5)
- [x] Task 3: `ocg-callbacks.ts` — Sync callbacks (AC: #2)
  - [x] 3.1 Implement `createCardReader(db: CardDB): (code: number) => OcgCardData | null` — decode `setcodes` from packed 64-bit, `level` low byte, `lscale`/`rscale` from high bytes, `race` as `bigint`
  - [x] 3.2 Implement `createScriptReader(scripts: ScriptDB): (name: string) => string | null` — search `scripts/{name}`, `scripts/official/{name}`, return `null` with `console.warn` if not found
- [x] Task 4: `duel-worker.ts` — Worker thread (AC: #1)
  - [x] 4.1 Setup: `parentPort.on('message')` handler for `INIT_DUEL` — initializes OCGCore WASM via `createCore({ sync: true })`, loads data via `loadDatabase`/`loadScripts`, creates callbacks, creates duel instance via `core.createDuel(options)`, loads startup scripts, loads both decks via `core.duelNewCard()`, calls `core.startDuel()`
  - [x] 4.2 Implement event-driven duel loop: `duelProcess()` → `duelGetMessage()` → transform → `postMessage`. On `WAITING`: stop loop, wait for `PLAYER_RESPONSE` on `parentPort`. On `CONTINUE`: loop. On `END`: post final messages + cleanup
  - [x] 4.3 Implement OCGCore→DTO transformation: map `OcgMessageType` enum to `ServerMessage` union types. Cover all 49 message types in `ws-protocol.ts`. Use switch on `msg.type` (numeric `OcgMessageType`) → construct typed DTO with string `type` field
  - [x] 4.4 Implement response transformation: `ResponseData` (from ws-protocol.ts) → `OcgResponse` (numeric `type` discriminant per technical reference §7). Map each `promptType` to the correct `OcgResponseType` number
  - [x] 4.5 Implement 30s watchdog: `setTimeout` before `duelProcess()`, `clearTimeout` after. On timeout → `postMessage({ type: 'WORKER_ERROR', duelId, error: 'Watchdog timeout' })`
  - [x] 4.6 Error handling: try/catch around `duelProcess()`. On catch → `postMessage({ type: 'WORKER_ERROR', duelId, error: err.message })`
  - [x] 4.7 Cleanup: `core.destroyDuel(handle)` on exit (via `WORKER_ERROR`, `MSG_WIN`/`END`, or worker termination signal)
- [x] Task 5: `message-filter.ts` — Anti-cheat filter (AC: #4)
  - [x] 5.1 Implement `filterMessage(message: ServerMessage, forPlayer: Player): ServerMessage | null`
  - [x] 5.2 `MSG_DRAW` filter: shallow copy, replace `cards` with `[0, 0, ...]` for opponent
  - [x] 5.3 `MSG_SHUFFLE_HAND` filter: shallow copy, replace `cards` with `[0, 0, ...]` for opponent
  - [x] 5.4 `MSG_MOVE` filter: shallow copy, replace `cardCode` with `0` when from/to private zone for opponent
  - [x] 5.5 `MSG_HINT` filter: HINT_EFFECT (hintType 10) → route to `message.player` only
  - [x] 5.6 `MSG_CONFIRM_CARDS` filter: route to `message.player` only
  - [x] 5.7 `SELECT_*` (20 types) + `RPS_CHOICE` filter: route to `message.player` only
  - [x] 5.8 `BOARD_STATE` / `STATE_SYNC` filter: deep copy, sanitize opponent hand (`cardCode→null`), face-down cards (`cardCode→null`), opponent extra deck (`cards→[]`)
  - [x] 5.9 Default handler: unknown type → `null` + `console.error`
  - [x] 5.10 Passthrough: all other recognized `ServerMessage` types return `message` as-is
- [x] Task 6: `server.ts` — Worker lifecycle & WebSocket routing (AC: #3, #5)
  - [x] 6.1 Add startup: lightweight data validation — check `cards.cdb` exists and is openable via `better-sqlite3` (open + close, no full load), check `scripts/` directory exists and is non-empty. Set `dataReady` flag. Update `/health` to check flag (return 503 with reason if false). Full `loadDatabase`/`loadScripts` happens in each worker thread only
  - [x] 6.2 Implement `POST /api/duels`: parse JSON body (with Content-Length guard vs MAX_PAYLOAD_SIZE → 413), create `DuelSession`, generate `duelId` + 2 join tokens, spawn worker, `postMessage(INIT_DUEL)`, store in `activeDuels` + `pendingTokens`, return 201
  - [x] 6.3 Update WebSocket `on('connection')`: extract `?token=xxx`, lookup `pendingTokens`, associate WS to `PlayerSession`, delete token, if both connected → signal worker to start (or send initial `BOARD_STATE`)
  - [x] 6.4 Implement WebSocket `on('message')` routing: validate sender, validate message type, check `awaitingResponse` for `PLAYER_RESPONSE`, forward to worker
  - [x] 6.5 Implement worker `on('message')` handler: receive `WorkerToMainMessage`, for `WORKER_MESSAGE` → apply `filterMessage` per player → `ws.send(JSON.stringify(filtered))`. For SELECT_* messages: set `awaitingResponse[playerIndex] = true`
  - [x] 6.6 Implement `SURRENDER` handling (main thread): send `DUEL_END` to both players → `worker.terminate()` → cleanup
  - [x] 6.7 Implement worker `on('exit')` cleanup: close WebSockets, remove from `activeDuels`, increment counter
  - [x] 6.8 Implement heartbeat: `setInterval` 30s → `ws.ping()` for all active connections, `ws.on('pong')` → `isAlive = true`, terminate dead connections
  - [x] 6.9 Update `/status` to return `activeDuels: activeDuels.size`
  - [x] 6.10 Remove `POST /api/duels/:id/join` stub (replaced by token-based WebSocket association)
- [x] Task 7: Build verification (AC: all)
  - [x] 7.1 Run `npm run build` — verify zero TS errors
  - [x] 7.2 Run `node dist/server.js` — verify `/health` returns 200 (with data) or 503 (without data)
  - [x] 7.3 Verify `/status` returns updated `activeDuels` count

## Dev Notes

### Architecture Compliance

- **This story is Phase 1A** — implements the core duel engine on the server side. Depends on Story 1.2 (scaffold, protocol frozen). Enables Stories 1.4-1.7 in parallel once complete.
- **ADR-2 (Independent WebSocket DTOs)**: `duel-worker.ts` transforms OCGCore messages into `ServerMessage` DTOs defined in `ws-protocol.ts`. The worker NEVER sends raw OCGCore types over `postMessage` — always DTOs.
- **ADR-4 (Whitelist message filter)**: `message-filter.ts` implements the complete whitelist. Default policy is DROP. This is the most safety-critical file — every `ServerMessage` type must be explicitly handled.
- **Transformation chain** (from architecture): `OCGCore binary → [duel-worker.ts: transform] → DTO → [message-filter.ts: filter] → [server.ts: ws.send()]`. Each step has a single owner file. No file bypasses the chain.
- **server.ts is the sole WebSocket owner** — no other file calls `ws.send()`. The worker communicates via `postMessage` only.

### Existing Code — What to Modify vs Keep

**Files to CREATE (this story) — 4 new production files:**
```
duel-server/src/
├── duel-worker.ts        # NEW — Worker thread entry point
├── message-filter.ts     # NEW — Anti-cheat filter (pure functions)
├── ocg-callbacks.ts      # NEW — cardReader + scriptReader factories
└── ocg-scripts.ts        # NEW — loadDatabase + loadScripts
```

**Files to MODIFY (this story):**
```
duel-server/src/types.ts    # ADD CardDB, ScriptDB, InitDuelMessage, MainToWorkerMessage
duel-server/src/server.ts   # MAJOR — worker lifecycle, WS routing, body parsing, heartbeat, health check
```

**Files to NOT TOUCH:**
```
duel-server/src/ws-protocol.ts  # FROZEN — protocol boundary (Story 1.2)
duel-server/src/poc-duel.ts     # PoC reference only
duel-server/src/test-core.ts    # PoC reference only
duel-server/patches/            # ESM fix (keep as-is)
front/src/app/pages/pvp/duel-ws.types.ts  # Angular copy (no protocol changes)
```

### Critical Technical Details

#### Worker Thread — Event-Driven Loop (NOT the PoC Pattern)

The PoC (`poc-duel.ts`) uses a synchronous `while` loop with inline `autoRespond()`. Production is fundamentally different:

```
// PoC pattern (WRONG for production):
while (true) {
  status = duelProcess();
  messages = duelGetMessage();
  for (msg of messages) { response = autoRespond(msg); if (response) duelSetResponse(response); }
  if (status === END) break;
}

// Production pattern (CORRECT):
function runDuelLoop() {
  while (true) {
    const status = duelProcess();
    const messages = duelGetMessage();
    for (const msg of messages) {
      const dto = transformToDto(msg);  // OcgMessage → ServerMessage
      parentPort.postMessage({ type: 'WORKER_MESSAGE', duelId, message: dto });
    }
    if (status === END) { cleanup(); return; }
    if (status === WAITING) { return; }  // STOP — wait for parentPort message
    // status === CONTINUE → loop again
  }
}

parentPort.on('message', (msg) => {
  if (msg.type === 'INIT_DUEL') { initDuel(msg); runDuelLoop(); }
  if (msg.type === 'PLAYER_RESPONSE') { duelSetResponse(transform(msg)); runDuelLoop(); }
});
```

Key difference: The production loop **exits** on `WAITING` and **resumes** when a `PLAYER_RESPONSE` arrives via `parentPort`. The PoC never waits because it auto-responds inline.

#### OCGCore → DTO Transformation (~200+ lines)

Each `OcgMessageType` (numeric enum) maps to a `ServerMessage` variant (string discriminant). The transformation must cover all 49 types defined in `ws-protocol.ts`:

**Game messages (19 types):** `START→BOARD_STATE`, `DRAW→MSG_DRAW`, `MOVE→MSG_MOVE`, `DAMAGE→MSG_DAMAGE`, `RECOVER→MSG_RECOVER`, `PAY_LPCOST→MSG_PAY_LPCOST`, `CHAINING→MSG_CHAINING`, `CHAIN_SOLVING→MSG_CHAIN_SOLVING`, `CHAIN_SOLVED→MSG_CHAIN_SOLVED`, `CHAIN_END→MSG_CHAIN_END`, `HINT→MSG_HINT`, `CONFIRM_CARDS→MSG_CONFIRM_CARDS`, `SHUFFLE_HAND→MSG_SHUFFLE_HAND`, `FLIPSUMMONING→MSG_FLIP_SUMMONING`, `POS_CHANGE→MSG_CHANGE_POS`, `SWAP→MSG_SWAP`, `ATTACK→MSG_ATTACK`, `BATTLE→MSG_BATTLE`, `WIN→MSG_WIN`

**Prompt messages (20 types):** Direct 1:1 name mapping — `SELECT_IDLECMD→SELECT_IDLECMD`, `SELECT_CARD→SELECT_CARD`, etc. Field names change from OCGCore snake_case to camelCase per protocol rules.

**System messages (7 types):** Not from OCGCore — generated by server.ts or worker. `DUEL_END` generated by main thread on win/error/surrender. `TIMER_STATE` generated by main thread timer logic (deferred to later story). `RPS_CHOICE`/`RPS_RESULT` generated by worker during pre-duel phase. `WORKER_ERROR` generated by worker on error. `STATE_SYNC` generated for reconnection (deferred to later story). `REMATCH_CANCELLED` generated by main thread.

**OCGCore messages NOT in ws-protocol.ts (intentionally excluded — worker should IGNORE):** `SUMMONING`, `SUMMONED`, `SPSUMMONING`, `SPSUMMONED`, `FLIPSUMMONED`, `LPUPDATE`, `SET`, `EQUIP`, `CARD_TARGET`, `CANCEL_TARGET`, `BECOME_TARGET`, `ADD_COUNTER`, `REMOVE_COUNTER`, `FIELD_DISABLED`, `CHAINED`, `CHAIN_NEGATED`, `CHAIN_DISABLED`, `CONFIRM_DECKTOP`, `CONFIRM_EXTRATOP`, `SHUFFLE_DECK`, `SHUFFLE_SET_CARD`, `SHUFFLE_EXTRA`, `DECK_TOP`, `SWAP_GRAVE_DECK`, `REVERSE_DECK`, `CARD_SELECTED`, `RANDOM_SELECTED`, `CARD_HINT`, `PLAYER_HINT`, `MISSED_EFFECT`, `TOSS_COIN`, `TOSS_DICE`, `HAND_RES`, `SHOW_HINT`, `RELOAD_FIELD`, `REMOVE_CARDS`, `NEW_TURN`, `NEW_PHASE`, `ATTACK_DISABLED`, `DAMAGE_STEP_START`, `DAMAGE_STEP_END`, `WAITING`, `RETRY`

These are either: (a) subsumed by `BOARD_STATE` snapshots, (b) informational only without client-visible effect, or (c) deprecated. The worker transforms only what `ws-protocol.ts` defines — everything else is silently ignored.

**IMPORTANT:** `NEW_TURN` and `NEW_PHASE` are NOT sent as individual messages. Their data is embedded in the `BOARD_STATE` payload (`turnPlayer`, `turnCount`, `phase`). The worker must build a `BOARD_STATE` snapshot using OCGCore query APIs.

**When to send `BOARD_STATE`:** exactly two triggers:
1. After `startDuel()` — initial game state
2. After each message batch when `duelProcess()` returns `WAITING` — ensures board is in sync before player makes a decision

No other trigger is needed. `NEW_TURN` and `NEW_PHASE` data is captured automatically because the snapshot is always taken at `WAITING` time, which follows any phase/turn transition.

**How to build `BOARD_STATE`** (using OCGCore query API from technical reference §8):
```typescript
function buildBoardState(core: OcgCore, duel: OcgDuelHandle): BoardStatePayload {
  // Global duel info via duelQueryField()
  const turnPlayer = core.duelQueryField(duel, OcgQuery.TURN_PLAYER);
  const turnCount  = core.duelQueryField(duel, OcgQuery.TURN_COUNT);
  const phase      = core.duelQueryField(duel, OcgQuery.CURRENT_PHASE);
  const lp0        = core.duelQueryField(duel, OcgQuery.LP, 0);
  const lp1        = core.duelQueryField(duel, OcgQuery.LP, 1);

  // Per-zone card data via duelQuery() — iterate each zone+sequence
  // For each occupied slot: core.duelQuery(duel, { controller, location, sequence, queryFlags })
  // queryFlags: CODE | POSITION | ATTACK | DEFENSE | LEVEL | RANK | LINK | COUNTERS | OVERLAY
  // Returns: { code, position, attack, defense, level, rank, link, overlayCount, ... }
  // Build zones: hand[], monsterZone[], spellTrapZone[], graveyard[], banished[], extraDeck[]
  // Include overlay materials for XYZ monsters (query overlay units at each sequence)
}
```
The `BoardStatePayload` type is already defined in `ws-protocol.ts`. Map queried fields to match its shape exactly.

#### Response Transformation — `ResponseData` → `OcgResponse`

Map the `promptType` string from ws-protocol.ts to the numeric `OcgResponseType`:

| `promptType` | `OcgResponseType` | Key Field Transforms |
|---|---|---|
| `SELECT_BATTLECMD` | 0 | `action` + `index` → `{ type: 0, action, index }` |
| `SELECT_IDLECMD` | 1 | `action` + `index` → `{ type: 1, action, index }` |
| `SELECT_EFFECTYN` | 2 | `yes` → `{ type: 2, yes }` |
| `SELECT_YESNO` | 3 | `yes` → `{ type: 3, yes }` |
| `SELECT_OPTION` | 4 | `index` → `{ type: 4, index }` |
| `SELECT_CARD` | 5 | `indices` → `{ type: 5, indicies: indices }` (**note: OCGCore uses "indicies" typo**) |
| `SELECT_UNSELECT_CARD` | 7 | `index` → `{ type: 7, index }` (null = finish) |
| `SELECT_CHAIN` | 8 | `index` → `{ type: 8, index }` (null = pass) |
| `SELECT_DISFIELD` | 9 | `places` → `{ type: 9, places }` |
| `SELECT_PLACE` | 10 | `places` → `{ type: 10, places }` |
| `SELECT_POSITION` | 11 | `position` → `{ type: 11, position }` |
| `SELECT_TRIBUTE` | 12 | `indices` → `{ type: 12, indicies: indices }` |
| `SELECT_COUNTER` | 13 | `counts` → `{ type: 13, counters: counts }` |
| `SELECT_SUM` | 14 | `indices` → `{ type: 14, indicies: indices }` |
| `SORT_CARD` / `SORT_CHAIN` | 15 | `order` → `{ type: 15, order }` |
| `ANNOUNCE_RACE` | 16 | `value` → `{ type: 16, races: [BigInt(value)] }` |
| `ANNOUNCE_ATTRIB` | 17 | `value` → `{ type: 17, attributes: [value] }` |
| `ANNOUNCE_CARD` | 18 | `value` → `{ type: 18, card: value }` |
| `ANNOUNCE_NUMBER` | 19 | `value` → `{ type: 19, value }` |

**CRITICAL:** OCGCore uses `indicies` (typo) not `indices` in its API. The ws-protocol.ts uses `indices` (correct spelling). The transformation must rename the field.

#### Message Filter — Anti-Cheat Rules

**Private zones** (information hidden from opponent): `LOCATION.DECK` (0x01), `LOCATION.HAND` (0x02), `LOCATION.EXTRA` (0x40).

**Public zones** (visible to both): `LOCATION.MZONE` (0x04), `LOCATION.SZONE` (0x08), `LOCATION.GRAVE` (0x10), `LOCATION.BANISHED` (0x20).

`MSG_MOVE` sanitization logic:
```typescript
const isFromPrivate = [LOCATION.DECK, LOCATION.HAND, LOCATION.EXTRA].includes(msg.fromLocation);
const isToPrivate = [LOCATION.DECK, LOCATION.HAND, LOCATION.EXTRA].includes(msg.toLocation);
if ((isFromPrivate || isToPrivate) && forPlayer !== inferController(msg)) {
  return { ...msg, cardCode: 0 };
}
return msg;
```

The filter returns **shallow copies** for sanitized messages (never mutates the input) and returns the **same reference** for passthrough messages (no copy needed — messages are JSON-serialized per-player anyway).

#### Token-Based WebSocket Association

The original architecture proposed `POST /api/duels/:id/join` as a separate HTTP call. After party-mode review, this is simplified to token-based association:

1. Spring Boot calls `POST /api/duels` → receives `{ duelId, tokens: [t0, t1] }`
2. Spring Boot stores tokens and returns `{ wsUrl, token }` to each Angular client (different token per player)
3. Angular opens WebSocket: `new WebSocket(wsUrl + '?token=' + token)`
4. server.ts `on('connection')`: lookup `pendingTokens.get(token)` → `{ duelId, playerIndex }` → associate WS to `DuelSession.players[playerIndex].ws` → delete token from map
5. When both `players[0].ws` and `players[1].ws` are set → post `{ type: 'START_DUEL' }` to worker (or worker starts automatically after `INIT_DUEL` init completes)

**Token lifetime:** tokens are valid until used or until the duel is cleaned up (worker exit). One-time use: deleted from `pendingTokens` after first successful association.

#### Heartbeat Configuration

```typescript
const HEARTBEAT_INTERVAL_MS = 30_000;
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);
```

Add `ws.isAlive = true` on connection and on `pong` event.

#### Duel Creation — Full Init Sequence

When worker receives `INIT_DUEL`:
1. `const core = await createCore({ sync: true })`
2. `const db = loadDatabase(DATA_DIR + '/cards.cdb')`
3. `const scripts = loadScripts(DATA_DIR + '/scripts')`
4. `const cardReader = createCardReader(db)`, `const scriptReader = createScriptReader(scripts)`
5. `const duel = core.createDuel({ flags: OcgDuelMode.MODE_MR5, seed: [random, random, random, random], team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 }, team2: { ... }, cardReader, scriptReader, errorHandler })`
6. Load 20 startup scripts: `for (const name of STARTUP_SCRIPTS) { const content = scripts.startupScripts.get(name); if (content) core.loadScript(duel, name, content); }`
7. Load player 1 deck: `for (const code of deck1.main) core.duelNewCard(duel, { code, team: 0, duelist: 0, controller: 0, location: OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_ATTACK })`; same for extra deck with `OcgLocation.EXTRA`
8. Load player 2 deck: same with `team: 1, controller: 1`
9. `core.startDuel(duel)`
10. `parentPort.postMessage({ type: 'WORKER_DUEL_CREATED', duelId })`
11. Start the duel loop

**Seed generation:** Use `crypto.getRandomValues(new BigUint64Array(4))` for cryptographically random seed. Never `[0n, 0n, 0n, 0n]` (Xoshiro256** degenerates).

#### DATA_DIR in Worker Context

The worker runs in a separate thread but shares the same filesystem. `DATA_DIR` must be passed to the worker via `workerData`:
```typescript
// server.ts:
new Worker(new URL('./duel-worker.js', import.meta.url), { workerData: { dataDir: DATA_DIR } })

// duel-worker.ts:
const { dataDir } = workerData as { dataDir: string };
```

Alternatively, use an environment variable. Both patterns are acceptable — `workerData` is cleaner for type safety.

### Previous Story Intelligence (Story 1.2)

**Lessons from Story 1.2 implementation:**
- TS5110: `module: "ESNext"` was incompatible with `moduleResolution: "nodenext"` in TS 5.9 — changed to `module: "nodenext"`. All imports MUST use `.js` extension.
- PoC files excluded from tsconfig `exclude` — they use different import patterns (run via `tsx` only).
- `patch-package` MUST be in `dependencies` (not devDependencies) for Docker `npm ci`.
- Code review caught: dead `on('pong')` handler removed, `readBody` in 501 stubs was a DoS vector, `declaration: true` was unnecessary.
- All services in docker-compose must be on `skytrix-internal` network (including `db` and `front`).

**Files created by Story 1.2 that this story depends on:**
- `ws-protocol.ts` (612 lines, 49 message types) — defines ALL DTOs the worker must produce
- `types.ts` (57 lines) — `WorkerToMainMessage` union, `DuelSession`, `PlayerSession`, constants
- `server.ts` (129 lines) — HTTP server skeleton with 501 stubs, WebSocket connection handler stub

### Project Structure Notes

- `duel-server/` is a top-level directory (sibling to `front/` and `back/`) — matches architecture
- All TypeScript files use `kebab-case.ts` naming — matches project-context.md
- `duel-worker.ts` is NOT imported by `server.ts` — it's spawned via `new Worker()`. The two files share types via `types.ts` imports but have no direct import dependency
- `message-filter.ts` is imported by `server.ts` (main thread only) — never imported by the worker

### Alignment with Unified Project Structure

After this story, the duel-server production file tree will be:
```
duel-server/src/
├── server.ts           # Main thread (MODIFIED)
├── duel-worker.ts      # Worker thread (NEW)
├── message-filter.ts   # Anti-cheat filter (NEW)
├── ws-protocol.ts      # Protocol boundary (UNCHANGED)
├── types.ts            # Internal types (MODIFIED)
├── ocg-callbacks.ts    # OCGCore callbacks (NEW)
├── ocg-scripts.ts      # Data loading (NEW)
├── poc-duel.ts         # PoC reference (UNTOUCHED)
└── test-core.ts        # PoC reference (UNTOUCHED)
```

This matches the 7 production files planned in the architecture document.

### Detected Conflicts or Variances

1. **`POST /api/duels/:id/join` removed** — Architecture says this endpoint exists. Party-mode review revealed token-based WebSocket association is simpler and more secure (no separate join step, no race condition between HTTP join and WS connect). Spring Boot Story 1.4 must adapt to receive join tokens from `POST /api/duels` response instead of calling a separate join endpoint. **Dev: add a code comment `// NOTE: /api/duels/:id/join removed — see Story 1.3 variance #1. Story 1.4 uses token-based WS association.` near the `POST /api/duels` handler in `server.ts` so the next dev is aware.**
2. **`MSG_MOVE` filter** — Architecture says "from private zone to private zone". Corrected to "from OR to private zone" after party-mode review. A card moving from DECK to MZONE face-down (set) also needs sanitization.
3. **Node.js 24 + better-sqlite3** — Web research flagged potential V8 compatibility issues. Story 1.2 build already passes on Node 24 image, so current version (12.6.2) works. Monitor if issues arise during duel-worker.ts implementation (worker thread context may differ from main thread).

### References

- [Source: architecture-pvp.md#Core Architectural Decisions] — Thread isolation (worker per duel), whitelist message filter, default DROP policy
- [Source: architecture-pvp.md#Implementation Patterns & Consistency Rules] — Transformation chain, enforcement checklist, naming patterns
- [Source: architecture-pvp.md#Project Structure & Boundaries] — 7 production files, worker path pattern, build & run
- [Source: epics-pvp.md#Story 1.3] — Original AC with BDD format, filter rules, worker lifecycle
- [Source: prd-pvp.md#Functional Requirements] — FR12 (chain delegation), FR13 (rule enforcement delegation), NFR6 (server-only authority)
- [Source: ocgcore-technical-reference.md#§3] — Duel loop pattern (duelProcess → getMessage → setResponse)
- [Source: ocgcore-technical-reference.md#§6] — Complete message type reference (30+ types with fields)
- [Source: ocgcore-technical-reference.md#§7] — Response format reference (OcgResponseType discriminant, field shapes)
- [Source: duel-server/src/poc-duel.ts] — PoC auto-respond patterns (cardReader, scriptReader, autoRespond switch/case)
- [Source: duel-server/src/ws-protocol.ts] — Frozen protocol (49 message types, PlayerResponseMsg union)
- [Source: duel-server/src/types.ts] — WorkerToMainMessage, DuelSession, PlayerSession, constants
- [Source: project-context.md] — TypeScript strict, kebab-case files, SCREAMING_SNAKE_CASE constants

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- Build initially failed with ~30 TS errors due to `@n1xx1/ocgcore-wasm` type resolution bug: `_dist/mod.d.ts` referenced `./dist/index.d.ts` (relative to `_dist/`) but `_dist/dist/` doesn't exist. Fixed by extending the existing `patch-package` patch to also fix the `.d.ts` file (`../dist/index.d.ts` + `export { default }`).
- Additional TS strict mode fixes: `Set<number>` typing for PRIVATE_LOCATIONS, `unknown` intermediate cast for PlayerResponseMsg data, explicit `Error` type on worker error handler.

### Completion Notes List

- **Task 1**: Added `CardDB`, `ScriptDB`, `Deck`, `InitDuelMessage`, `PlayerResponseMessage`, `MainToWorkerMessage` to `types.ts`. `WorkerToMainMessage` already had sufficient types from Story 1.2.
- **Task 2**: Created `ocg-scripts.ts` with `loadDatabase()`, `loadScripts()`, `validateData()`, and `STARTUP_SCRIPTS` constant (20 Lua files). `validateData` takes path strings (not loaded objects) for lightweight main-thread checks.
- **Task 3**: Created `ocg-callbacks.ts` with factory functions `createCardReader()` and `createScriptReader()`. Handles packed setcode decoding (64-bit → array), level byte extraction, bigint race.
- **Task 4**: Created `duel-worker.ts` (~740 lines) with event-driven duel loop, complete OcgMessage→ServerMessage transformation (all 49 types), ResponseData→OcgResponse transformation (20 prompt types), BOARD_STATE builder via query API, 30s watchdog, auto-respond to OCGCore's built-in RPS, cleanup.
- **Task 5**: Created `message-filter.ts` with whitelist-based filter (ADR-4 compliance). Default DROP policy. Sanitizes MSG_DRAW/MSG_SHUFFLE_HAND/MSG_MOVE for opponents. Routes SELECT_*/RPS_CHOICE to deciding player only. Deep-sanitizes BOARD_STATE/STATE_SYNC (hand→null, face-down→null, extra→[]).
- **Task 6**: Rewrote `server.ts` with startup validation, POST /api/duels (body parsing, worker spawn, token generation), token-based WebSocket association, worker message routing with filterMessage integration, awaitingResponse tracking, SURRENDER handling, heartbeat (30s ping/pong), graceful shutdown.
- **Task 7**: Build passes with zero errors. Server starts, `/health` returns `{"status":"ok"}`, `/status` returns `{"activeDuels":0,...}`.

### File List

- `duel-server/src/types.ts` — MODIFIED: Added CardDB, ScriptDB, Deck, InitDuelMessage, PlayerResponseMessage, MainToWorkerMessage
- `duel-server/src/ocg-scripts.ts` — NEW: Data loading (loadDatabase, loadScripts, validateData, STARTUP_SCRIPTS)
- `duel-server/src/ocg-callbacks.ts` — NEW: OCGCore sync callbacks (createCardReader, createScriptReader)
- `duel-server/src/duel-worker.ts` — NEW: Worker thread (duel loop, message transform, response transform, BOARD_STATE builder)
- `duel-server/src/message-filter.ts` — NEW: Anti-cheat message filter (filterMessage, sanitizeBoardState)
- `duel-server/src/server.ts` — MODIFIED: Worker lifecycle, WebSocket routing, body parsing, heartbeat, health check, token-based association
- `duel-server/patches/@n1xx1+ocgcore-wasm+0.1.1.patch` — MODIFIED: Extended to fix .d.ts type resolution for moduleResolution nodenext

### Change Log

- 2026-02-25: Story 1.3 implementation complete — OCGCore duel engine, anti-cheat filter, worker lifecycle, token-based WS association. 4 new files, 2 modified, 1 patch extended.
- 2026-02-25: Code review (Senior Developer Review AI) — 10 findings (4H, 3M, 3L). All HIGH and MEDIUM fixed: race condition on initial BOARD_STATE (H2), worker not terminated after error (H3), silent error swallowing (H4), deterministic RPS (M1), missing deck validation (M2), LP tracking comment (M3). Build verified zero errors post-fix.
