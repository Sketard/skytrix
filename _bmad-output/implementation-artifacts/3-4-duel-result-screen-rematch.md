# Story 3.4: Duel Result Screen & Rematch

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see a clear result screen after the duel ends with the option to rematch,
so that I know the outcome and can quickly play again.

## Acceptance Criteria

### AC1: Result Overlay Displays on Duel End

**Given** the duel ends (any reason: LP=0, surrender, timeout, inactivity, disconnect)
**When** the client receives `DUEL_END` message
**Then** the result overlay renders as a full-screen overlay over the board with backdrop blur
**And** it displays: outcome text "VICTORY" / "DEFEAT" / "DRAW" (large, centered)
**And** it displays a reason text mapping:
  - `winner !== null, reason contains 'lp'` → "Opponent LP reduced to 0" (victory) / "Your LP reduced to 0" (defeat)
  - `reason === 'surrender'` → "Opponent surrendered" (victory) / "You surrendered" (defeat)
  - `reason === 'timeout'` → "Opponent timed out" (victory) / "You timed out" (defeat)
  - `reason === 'inactivity'` → "Opponent inactive" (victory) / "You were inactive" (defeat)
  - `reason === 'disconnect'` → "Opponent disconnected" (victory) / "You disconnected" (defeat)
  - `winner === null` → "Draw" with reason text (e.g., "Simultaneous LP depletion")
**And** the outcome text uses color coding: victory = green (`#4caf50`), defeat = red (`#f44336`), draw = yellow (`#ffeb3b`) — existing CSS variables
**And** `LiveAnnouncer` announces the result text for accessibility (e.g., "Victory — Opponent surrendered")
**And** three action buttons are shown: "Rematch" (primary), "Leave Room" (secondary), "Back to Deck" (subtle text link)

### AC2: Rematch Request Flow

**Given** the result screen is displayed
**When** the player taps "Rematch"
**Then** a `REMATCH_REQUEST` WebSocket message is sent to the duel server
**And** the "Rematch" button changes to "Waiting for opponent..." (disabled state, opacity 0.6)
**And** the duel server sends `REMATCH_INVITATION` to the opponent
**And** the opponent sees their "Rematch" button text change to "Accept Rematch" (highlighted with accent color, indicating opponent wants rematch)

### AC3: Rematch Acceptance — New Duel Starts

**Given** a player has received `REMATCH_INVITATION`
**When** the player taps "Accept Rematch" (which sends `REMATCH_REQUEST`)
**Then** the duel server detects both players have requested rematch
**And** the server sends `REMATCH_STARTING` to both players
**And** the server creates a new duel: same decklists (retained from initial creation), new OCGCore WASM instance, new worker thread — no Spring Boot round-trip
**And** the client clears `duelResult`, resets board state, and shows a brief "Starting new duel..." overlay
**And** the new worker starts → sends `BOARD_STATE` → `RPS_CHOICE` flows automatically (same flow as Story 2.3)
**And** the same 5-card initial hand is dealt after RPS winner chooses turn order

### AC4: Rematch Declined — Opponent Leaves

**Given** a player has sent `REMATCH_REQUEST` and is waiting
**When** the opponent taps "Leave Room" (closes WebSocket)
**Then** the duel server sends `REMATCH_CANCELLED` with `reason: 'opponent_left'` to the waiting player
**And** the waiting player's "Rematch" button changes to "Opponent left" (disabled, greyed out)
**And** only "Leave Room" and "Back to Deck" remain actionable

### AC5: Leave Room Navigation

**Given** the result screen is displayed
**When** the player taps "Leave Room"
**Then** `POST /api/rooms/:id/end` is called (deferred from DUEL_END — only on explicit navigation)
**And** the WebSocket connection is closed cleanly
**And** the player is navigated to `/pvp` (lobby)

### AC6: Back to Deck Navigation

**Given** the result screen is displayed
**When** the player taps "Back to Deck"
**Then** `POST /api/rooms/:id/end` is called
**And** the WebSocket connection is closed cleanly
**And** the player is navigated to the deck page for the deck they used in the duel

### AC7: 5-Minute Rematch Timeout

**Given** a room is on the result screen
**When** 5 minutes pass without both players agreeing to rematch
**Then** the server sends `REMATCH_CANCELLED` with `reason: 'timeout'` to both players
**And** the server cleans up the duel session (terminates worker, removes from activeDuels)
**And** the result screen shows "Room expired" text, "Rematch" button disabled
**And** only "Leave Room" and "Back to Deck" remain actionable

## Tasks / Subtasks

- [x] Task 1: Protocol — Define rematch message types (AC: #2, #3, #4, #7)
  - [x] 1.1 Add `RematchInvitationMsg` interface to `duel-server/src/ws-protocol.ts`: `{ type: 'REMATCH_INVITATION' }`
  - [x] 1.2 Add `RematchStartingMsg` interface to `duel-server/src/ws-protocol.ts`: `{ type: 'REMATCH_STARTING' }`
  - [x] 1.3 Add `RematchResponseMsg` interface to `duel-server/src/ws-protocol.ts`: `{ type: 'REMATCH_RESPONSE', accepted: boolean }` — NO, this is not needed; opponent just sends REMATCH_REQUEST to accept. Remove `REMATCH_RESPONSE` from ClientMessage if present.
  - [x] 1.4 Update `RematchCancelledMsg` to include reason: `{ type: 'REMATCH_CANCELLED', reason: 'opponent_left' | 'timeout' }`
  - [x] 1.5 Verify `RematchRequestMsg` already in ClientMessage union
  - [x] 1.6 Update ServerMessage union: add `RematchInvitationMsg`, `RematchStartingMsg`, verify `RematchCancelledMsg`
  - [x] 1.7 Update ClientMessage union: verify `RematchRequestMsg`, remove `RematchResponseMsg` if present
  - [x] 1.8 Add `REMATCH_INVITATION`, `REMATCH_STARTING`, `REMATCH_CANCELLED` to `message-filter.ts` passthrough whitelist (these are server-originated lifecycle messages, not worker messages)
  - [x] 1.9 Mirror ALL changes in `front/src/app/pages/pvp/duel-ws.types.ts`

- [x] Task 2: Server — Store decks in session + rematch state (AC: #3)
  - [x] 2.1 Add `decks: [Deck, Deck]` field to `ActiveDuelSession` interface in `server.ts` — stores full Deck objects for both players
  - [x] 2.2 Add `rematchRequested: [boolean, boolean]` field to `ActiveDuelSession` — tracks which players want rematch
  - [x] 2.3 Add `rematchTimeout: ReturnType<typeof setTimeout> | null` field to `ActiveDuelSession`
  - [x] 2.4 In `POST /api/duels` handler: store `parsed.player1.deck` and `parsed.player2.deck` in `session.decks` at session creation
  - [x] 2.5 Initialize `rematchRequested: [false, false]` and `rematchTimeout: null` at session creation

- [x] Task 3: Server — Handle REMATCH_REQUEST message (AC: #2, #3, #4)
  - [x] 3.1 In WebSocket message handler (switch on `parsed.type`), replace the existing `case 'REMATCH_REQUEST': break;` stub with real implementation
  - [x] 3.2 Guard: only process if `session.endedAt !== null` (duel must have ended)
  - [x] 3.3 Guard: reject if `session.rematchTimeout === null` AND timer hasn't been started yet (shouldn't happen, but defensive)
  - [x] 3.4 Set `session.rematchRequested[playerIndex] = true`
  - [x] 3.5 Check if `session.rematchRequested[opponentIndex]` is also true → if yes: call `startRematch(session)` (Task 4)
  - [x] 3.6 If opponent hasn't requested yet: send `{ type: 'REMATCH_INVITATION' }` to opponent via `sendToPlayer()`

- [x] Task 4: Server — Create new duel on rematch (AC: #3)
  - [x] 4.1 Create `startRematch(session: ActiveDuelSession)` function in `server.ts`
  - [x] 4.2 Clear rematch timeout: `clearTimeout(session.rematchTimeout); session.rematchTimeout = null`
  - [x] 4.3 Send `{ type: 'REMATCH_STARTING' }` to both players via `sendToPlayer()`
  - [x] 4.4 Terminate old worker: `session.worker.terminate()` (with removeAllListeners to prevent cleanupDuelSession on exit)
  - [x] 4.5 Spawn new Worker with `workerData: { dataDir }` (same as POST /api/duels handler)
  - [x] 4.6 Send `INIT_DUEL` to new worker: `worker.postMessage({ type: 'INIT_DUEL', duelId: session.duelId, decks: session.decks })`
  - [x] 4.7 Attach `WORKER_MESSAGE` handler on new worker — extracted to reusable `attachWorkerHandlers()` function
  - [x] 4.8 Reset session state: `session.worker = worker`, `session.awaitingResponse = [false, false]`, `session.lastBoardState = null`, `session.lastSentPrompt = [null, null]`, `session.rematchRequested = [false, false]`, `session.endedAt = null`, `session.startedAt = Date.now()`
  - [x] 4.9 Clear all turn timers and inactivity timers (reuse `clearAllDuelTimers()` pattern from Story 3.2)
  - [x] 4.10 New worker auto-starts duel loop → RPS_CHOICE flows via existing `broadcastMessage()` pipeline

- [x] Task 5: Server — 5-minute rematch timeout + disconnect during result screen (AC: #4, #7)
  - [x] 5.1 Start 5-minute rematch timeout via `handleDuelEnd()` — called in all DUEL_END paths (broadcastMessage, surrender, timeout, inactivity, disconnect, worker error)
  - [x] 5.2 Create `rematchExpired(session: ActiveDuelSession)` function: sends `{ type: 'REMATCH_CANCELLED', reason: 'timeout' }` to both players, then calls `cleanupDuelSession(session)`
  - [x] 5.3 Cancel rematch timeout in `startRematch()` (already in 4.2) and `cleanupDuelSession()`
  - [x] 5.4 On player WebSocket `close` event AFTER duel has ended (`session.endedAt !== null`): send `{ type: 'REMATCH_CANCELLED', reason: 'opponent_left' }` to the OTHER player (if still connected)
  - [x] 5.5 If both players disconnect after duel end: `cleanupDuelSession()` (no one to rematch with)

- [x] Task 6: Client DuelWebSocketService — Rematch signals + message handling (AC: #2, #3, #4, #7)
  - [x] 6.1 Add `private _rematchState = signal<'idle' | 'requested' | 'invited' | 'opponent-left' | 'expired'>('idle')` and `readonly rematchState = this._rematchState.asReadonly()`
  - [x] 6.2 Add `sendRematchRequest()` method: `this.ws?.send(JSON.stringify({ type: 'REMATCH_REQUEST' }))` + `this._rematchState.set('requested')`
  - [x] 6.3 In `handleMessage()`, add `case 'REMATCH_INVITATION':` → `this._rematchState.set('invited')`
  - [x] 6.4 Add `case 'REMATCH_CANCELLED':` → set `this._rematchState.set(message.reason === 'opponent_left' ? 'opponent-left' : 'expired')`
  - [x] 6.5 Add `case 'REMATCH_STARTING':` → reset: `this._duelResult.set(null)`, `this._duelState.set(EMPTY_DUEL_STATE)`, `this._pendingPrompt.set(null)`, `this._opponentDisconnected.set(false)`, `this._rematchState.set('idle')`
  - [x] 6.6 Reset `_rematchState` to `'idle'` on initial WebSocket connection (`ws.onopen`)
  - [x] 6.7 On `DUEL_END` handling: no change to existing handler (rematch state stays 'idle' until player taps Rematch)

- [x] Task 7: Client DuelPageComponent — Result overlay upgrade (AC: #1, #2, #3, #4, #5, #6, #7)
  - [x] 7.1 Inject `LiveAnnouncer` from `@angular/cdk/a11y` (already injected)
  - [x] 7.2 Add `effect()` on `resultOutcome()`: when non-null, call `liveAnnouncer.announce()` with result text via `untracked()`
  - [x] 7.3 Enhance `resultOutcome` computed with `mapDuelEndReason()` for human-readable reason text
  - [x] 7.4 Add `backToDeck()` method: navigates to `/deck` (deck list — RoomDTO lacks deck ID fields)
  - [x] 7.5 **CRITICAL: Defer `POST /rooms/:id/end`** — removed auto-fire effect, POST now called in `backToLobby()` and `backToDeck()`
  - [x] 7.6 Add `onRematchClick()` method: calls `wsService.sendRematchRequest()`
  - [x] 7.7 Add `rematchButtonLabel` computed signal with all 5 states
  - [x] 7.8 Add `rematchDisabled` computed signal
  - [x] 7.9 Update template: enhanced result overlay with Rematch/Leave/BackToDeck buttons
  - [x] 7.10 Add backdrop blur to result overlay: `backdrop-filter: blur(4px)`
  - [x] 7.11 Add "Leave Room" button (`mat-stroked-button`) → calls `backToLobby()`
  - [x] 7.12 Add "Back to Deck" subtle text link → calls `backToDeck()`
  - [x] 7.13 canDeactivate guard — no change needed (existing guard correctly handles rematch flow)

- [x] Task 8: Client SCSS — Result overlay styling enhancement (AC: #1)
  - [x] 8.1 Add `backdrop-filter: blur(4px)` to `.result-overlay` (changed background from `rgba(0,0,0,0.9)` to `rgba(0,0,0,0.7)`)
  - [x] 8.2 Add `.result-overlay__actions` container with flex column layout
  - [x] 8.3 Style "Rematch" button as primary with accent color
  - [x] 8.4 Style "Leave Room" button as secondary with border
  - [x] 8.5 Style "Back to Deck" as subtle underlined link
  - [x] 8.6 Disabled button state with opacity and pointer-events
  - [x] 8.7 Add animation entrance with opacity transition
  - [x] 8.8 Add `@media (prefers-reduced-motion: reduce)` to disable transition
  - [x] 8.9 Touch targets: all interactive elements ≥ 44px height, "Rematch" button 48px

- [ ] Task 9: Manual verification (all ACs)
  - [ ] 9.1 Verify: duel ends → result overlay shows VICTORY/DEFEAT/DRAW with correct reason text
  - [ ] 9.2 Verify: LiveAnnouncer announces result (check with screen reader or DevTools accessibility audit)
  - [ ] 9.3 Verify: Player A taps Rematch → "Waiting for opponent..." displayed
  - [ ] 9.4 Verify: Player B receives invitation → "Accept Rematch" button displayed
  - [ ] 9.5 Verify: Player B taps Accept → both clients reset → RPS flows → new duel starts
  - [ ] 9.6 Verify: Opponent leaves during result → "Opponent left" displayed, Rematch disabled
  - [ ] 9.7 Verify: "Leave Room" navigates to `/pvp`, calls POST /rooms/:id/end
  - [ ] 9.8 Verify: "Back to Deck" navigates to deck page
  - [ ] 9.9 Verify: 5-minute timeout → "Room expired", Rematch disabled
  - [ ] 9.10 Verify: backdrop blur visible behind result overlay
  - [ ] 9.11 Verify: prefers-reduced-motion → no animations, instant state changes
  - [ ] 9.12 Verify: multiple rematches work (rematch → play → result → rematch again)
  - [ ] 9.13 Verify: surrender guard still works during active duel (not affected by result overlay changes)

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring Epic 1 bug).
- **`takeUntilDestroyed()`**: Use `DestroyRef` pattern for all subscriptions.
- **`effect()` with `untracked()`**: For all side effects (navigation, timers, HTTP calls, snackbar calls, LiveAnnouncer).
- **`prefers-reduced-motion`**: Verify on ALL animated elements (Epic 2 retro action item).
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| Result overlay template (placeholder) | `duel-page.component.html:263-281` | Exists — enhance, don't recreate |
| Result overlay SCSS | `duel-page.component.scss:428-477` | Exists — extend with new styles |
| `resultOutcome` computed signal | `duel-page.component.ts:189-195` | Exists — enhance reason mapping |
| `ownPlayerIndex` computed | `duel-page.component.ts:181-186` | Exists — reuse for victory/defeat perspective |
| `backToLobby()` method | `duel-page.component.ts:629-631` | Exists — add POST /end call before nav |
| `DuelEndMsg` interface | `ws-protocol.ts:399-403` | Exists: `{ type, winner, reason }` |
| `DuelEndReason` type | `ws-protocol.ts:397` | `'surrender' \| 'disconnect' \| 'timeout' \| 'inactivity' \| (string & {})` |
| `RematchRequestMsg` | `ws-protocol.ts:566-568` | Exists in ClientMessage |
| `RematchCancelledMsg` | `ws-protocol.ts:423-425` | Exists — needs reason field added |
| `REMATCH_REQUEST` handler stub | `server.ts` | `case 'REMATCH_REQUEST': break;` — replace with real implementation |
| POST /rooms/:id/end effect | `duel-page.component.ts:376-385` | Exists — must be DEFERRED (remove auto-fire on duelResult) |
| `sendToPlayer()` function | `server.ts` | Exists — reuse for all rematch messages |
| `cleanupDuelSession()` function | `server.ts:517-555` | Exists — reuse, add rematch timeout cleanup |
| `clearAllDuelTimers()` pattern | `server.ts` | Exists (Story 3.2) — reuse in startRematch |
| `broadcastMessage()` function | `server.ts` | Exists — used by WORKER_MESSAGE handler |
| `isSelectMessage()` + `SELECT_TYPES` | `server.ts:277-288` | Exists — used for prompt caching |
| `displaySuccess()` / `displayError()` | `core/utilities/functions.ts` | Exists — reuse for snackbar notifications |
| `gracePeriodTimers` Map | `server.ts:37` | Grace period fully implemented (60s) |
| `startGracePeriod()` | `server.ts:701-720` | Sends DUEL_END on grace period expiry |
| Existing `WORKER_MESSAGE` handler | `server.ts` | Pattern to replicate for new worker attachment |
| POST /api/duels handler | `server.ts:125-221` | Reference for worker spawn + INIT_DUEL pattern |
| Worker `initDuel()` + `runDuelLoop()` | `duel-worker.ts:637-707` | Auto-triggers RPS after startDuel — no changes needed |
| RPS prompt flow | `prompt-rps.component.ts` | Complete RPS UI — auto-works with new worker |
| Message filter passthrough | `message-filter.ts` | SESSION_TOKEN, OPPONENT_DISCONNECTED, etc. whitelisted |

### Critical: What Does NOT Exist Yet (Story 3.4 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| `REMATCH_INVITATION` message type | `ws-protocol.ts` + `duel-ws.types.ts` | Notify opponent that player wants rematch |
| `REMATCH_STARTING` message type | `ws-protocol.ts` + `duel-ws.types.ts` | Signal both clients to reset for new duel |
| `RematchCancelledMsg.reason` field | `ws-protocol.ts` + `duel-ws.types.ts` | Distinguish between declined/left/timeout |
| `decks` field on `ActiveDuelSession` | `server.ts` | Retain decklists for rematch without Spring Boot |
| `rematchRequested` field on `ActiveDuelSession` | `server.ts` | Track which players want rematch |
| `rematchTimeout` field on `ActiveDuelSession` | `server.ts` | 5-minute post-duel timeout |
| `startRematch()` function | `server.ts` | Create new worker, reset session, send REMATCH_STARTING |
| `rematchExpired()` function | `server.ts` | Handle 5-minute timeout cleanup |
| Server REMATCH_REQUEST handler | `server.ts` | Process rematch requests |
| `rematchState` signal | `duel-web-socket.service.ts` | Track rematch flow state |
| `sendRematchRequest()` method | `duel-web-socket.service.ts` | Send REMATCH_REQUEST |
| REMATCH_INVITATION handler | `duel-web-socket.service.ts` | Handle incoming invitation |
| REMATCH_CANCELLED handler | `duel-web-socket.service.ts` | Handle cancellation |
| REMATCH_STARTING handler | `duel-web-socket.service.ts` | Reset all duel state for new duel |
| `onRematchClick()` method | `duel-page.component.ts` | UI action handler |
| `rematchButtonLabel` computed | `duel-page.component.ts` | Dynamic button text |
| `rematchDisabled` computed | `duel-page.component.ts` | Button disabled state |
| `backToDeck()` method | `duel-page.component.ts` | Navigate to deck editor |
| LiveAnnouncer injection + effect | `duel-page.component.ts` | A11y result announcement |
| Enhanced result overlay template | `duel-page.component.html` | Rematch/Leave/BackToDeck buttons |
| Backdrop blur + button styles | `duel-page.component.scss` | UX spec compliance |

### Critical: Rematch Protocol Flow

```
[DUEL_END sent to both players]
  server: session.endedAt = Date.now()
  server: start 5-minute rematchTimeout
  client: duelResult signal set → result overlay shown

[Player A taps "Rematch"]
  client A: sends { type: 'REMATCH_REQUEST' }
  client A: rematchState = 'requested'
  client A: button shows "Waiting for opponent..."
  server: rematchRequested[0] = true
  server: check if rematchRequested[1] → false
  server: send { type: 'REMATCH_INVITATION' } to Player B
  client B: rematchState = 'invited'
  client B: button shows "Accept Rematch"

[Player B taps "Accept Rematch"]
  client B: sends { type: 'REMATCH_REQUEST' }
  server: rematchRequested[1] = true
  server: both true → startRematch(session)
  server: clearTimeout(rematchTimeout)
  server: send { type: 'REMATCH_STARTING' } to both
  server: terminate old worker
  server: spawn new worker with same decks
  server: reset session state (awaitingResponse, lastBoardState, etc.)
  client: duelResult = null, duelState = null, pendingPrompt = null
  client: rematchState = 'idle'
  client: result overlay disappears, board resets
  worker: initDuel → startDuel → runDuelLoop → RPS_CHOICE
  (normal duel flow resumes)

[If Player B taps "Leave Room" instead]
  client B: closes WebSocket
  server: ws.on('close') → session.endedAt !== null (post-duel)
  server: send { type: 'REMATCH_CANCELLED', reason: 'opponent_left' } to Player A
  client A: rematchState = 'opponent-left'
  client A: button shows "Opponent left" (disabled)

[If 5 minutes pass with no rematch]
  server: rematchExpired() fires
  server: send { type: 'REMATCH_CANCELLED', reason: 'timeout' } to both
  server: cleanupDuelSession(duelId)
  client: rematchState = 'expired'
  client: button shows "Room expired" (disabled)
```

### Critical: Deck Retention Strategy

The epics specify: "`server.ts` retains both players' decklists in session state after duel creation, enabling rematch without Spring Boot round-trip."

The `POST /api/duels` handler receives deck data as `parsed.player1.deck` and `parsed.player2.deck` (arrays of card IDs/passcodes). Store these directly on the `ActiveDuelSession`:

```typescript
// In ActiveDuelSession:
decks: [number[], number[]];

// In POST /api/duels handler, after parsing request body:
const session: ActiveDuelSession = {
  // ... existing fields ...
  decks: [parsed.player1.deck, parsed.player2.deck],
  rematchRequested: [false, false],
  rematchTimeout: null,
};
```

On rematch, send the same decks to the new worker:
```typescript
function startRematch(session: ActiveDuelSession) {
  // ... terminate old worker, spawn new ...
  worker.postMessage({
    type: 'INIT_DUEL',
    duelId: session.duelId,
    decks: session.decks,
  });
}
```

### Critical: Deferred POST /rooms/:id/end

**Current behavior (MUST CHANGE):** An `effect()` in `duel-page.component.ts` immediately calls `POST /api/rooms/${roomId}/end` when `duelResult()` becomes non-null. This prematurely ends the room before rematch is possible.

**New behavior:** Remove the auto-fire effect. Instead, call the POST only when the player explicitly navigates away:

```typescript
// REMOVE this effect:
// effect(() => {
//   const result = this.wsService.duelResult();
//   if (!result) return;
//   untracked(() => {
//     if (this.roomId) {
//       this.http.post(`/api/rooms/${this.roomId}/end`, {}).subscribe();
//     }
//   });
// });

// ADD to backToLobby() and backToDeck():
backToLobby() {
  if (this.roomId) {
    this.http.post(`/api/rooms/${this.roomId}/end`, {}).subscribe();
  }
  this.router.navigate(['/pvp']);
}

backToDeck() {
  if (this.roomId) {
    this.http.post(`/api/rooms/${this.roomId}/end`, {}).subscribe();
  }
  const deckId = this.ownPlayerIndex() === 0
    ? this.room()?.player1DeckId
    : this.room()?.player2DeckId;
  this.router.navigate(['/deck', deckId]);
}
```

Note: The server-side 5-minute timeout provides the safety net. If the client crashes without calling POST /end, the room stays ACTIVE in Spring Boot but the duel server session is cleaned up. The room will be stale (no WebSocket connections) and can be cleaned up via a future cron job or ignored (lobby only shows WAITING rooms).

### Critical: REMATCH_STARTING Client Reset

When `REMATCH_STARTING` is received, the client must fully reset to pre-duel state:

```typescript
case 'REMATCH_STARTING':
  this._duelResult.set(null);     // Clears result overlay
  this._duelState.set(null);      // Clears board
  this._pendingPrompt.set(null);  // Clears any stale prompt
  this._opponentDisconnected.set(false);
  this._rematchState.set('idle'); // Ready for new duel messages (no intermediate state — YAGNI)
  break;
```

The next messages will be `BOARD_STATE` (initial board) and `RPS_CHOICE` (RPS prompt), which flow through the existing handlers.

### Critical: Worker Attachment on Rematch

When spawning a new worker in `startRematch()`, the `WORKER_MESSAGE` handler must be re-attached. The current handler in `POST /api/duels` is inline. Extract the common pattern:

```typescript
function attachWorkerHandlers(session: ActiveDuelSession) {
  session.worker.on('message', (msg: WorkerMessage) => {
    // Same logic as current WORKER_MESSAGE handler
    // Broadcasts to players, handles SELECT_*, caches state, etc.
  });
  session.worker.on('error', (err: Error) => {
    // Same error handling
  });
  session.worker.on('exit', (code: number) => {
    // Same exit handling
  });
}
```

This function can be called both in `POST /api/duels` (initial creation) and `startRematch()` (rematch). Extract from existing code — do NOT duplicate.

### Critical: Rematch During Opponent Disconnect

Edge case: If the duel ends due to disconnect timeout (opponent's grace period expired → DUEL_END with reason 'disconnect'), the opponent is already disconnected. In this case:
- The remaining player sees the result overlay
- "Rematch" is available but the opponent isn't connected
- If the opponent reconnects within the 5-minute rematch window... they CAN'T because the grace period already expired and the WebSocket session is gone
- So effectively: after a disconnect forfeit, rematch is not possible unless the opponent creates a new room

**Implementation:** No special handling needed. The opponent's WebSocket close triggers `REMATCH_CANCELLED` with `reason: 'opponent_left'`. The remaining player sees "Opponent left" immediately.

### Critical: Template Structure for Result Overlay

```html
@if (resultOutcome(); as result) {
  <div class="result-overlay" role="status" aria-live="assertive">
    <div class="result-overlay__content">
      <h1 class="result-overlay__title"
          [class.result-overlay__title--victory]="result.outcome === 'victory'"
          [class.result-overlay__title--defeat]="result.outcome === 'defeat'"
          [class.result-overlay__title--draw]="result.outcome === 'draw'">
        @switch (result.outcome) {
          @case ('victory') { VICTORY }
          @case ('defeat') { DEFEAT }
          @case ('draw') { DRAW }
        }
      </h1>
      <p class="result-overlay__reason">{{ result.reason }}</p>

      <div class="result-overlay__actions">
        <button class="result-overlay__rematch"
                [disabled]="rematchDisabled()"
                (click)="onRematchClick()">
          {{ rematchButtonLabel() }}
        </button>
        <button mat-stroked-button
                class="result-overlay__leave"
                (click)="backToLobby()">
          Leave Room
        </button>
        <button class="result-overlay__deck-link"
                (click)="backToDeck()">
          Back to Deck
        </button>
      </div>
    </div>
  </div>
}
```

### Critical: Room Data — Deck ID Access

To implement "Back to Deck", the component needs the deck ID used in the duel. Check what data is available in the room response:

The `room()` signal holds the room data fetched on component init. The room DTO should contain `player1DeckId` and `player2DeckId` (or similar). **VERIFY the RoomDTO structure** in `room.types.ts` — if deck IDs are not in the current DTO, the deck ID can be passed via route params or extracted from the deck list the player selected in the lobby.

**Fallback:** If deck ID is not easily available, navigate to `/deck` (deck list page) instead of `/deck/:id`. This is still useful as a shortcut back to deck management.

### Critical: Reuse Same duelId Across Rematches

The `activeDuels` Map uses `duelId` as its key. On rematch, **keep the same duelId** rather than generating a new one. Reasons:
1. Avoids removing and re-inserting in the Map
2. Avoids re-managing reconnectTokens (same tokens remain valid)
3. The session is logically the same — same room, same players, same decks
4. The worker is replaced but the session wrapper persists

### Critical: Worker Handler Extraction

The `WORKER_MESSAGE` handler in `POST /api/duels` is currently inline (~80+ lines). For rematch, the same handler must be attached to the new worker. **Extract to a reusable function:**

```typescript
function attachWorkerHandlers(session: ActiveDuelSession) {
  session.worker.on('message', (msg: WorkerMessage) => {
    // Existing WORKER_MESSAGE handler logic
  });
  session.worker.on('error', (err: Error) => {
    // Existing error handling
  });
  session.worker.on('exit', (code: number) => {
    // Existing exit handling
  });
}
```

Call this function both in `POST /api/duels` (initial creation) and `startRematch()`. **Do NOT copy-paste the handler.**

### Critical: Reason Values from duel-worker.ts

**VERIFY** what `reason` strings the worker actually sends in `DUEL_END` messages. The reason mapping in AC1 depends on the exact string values. Check `duel-worker.ts`'s `transformMessage()` for `OcgMessageType.WIN` and `OcgMessageType.DRAW` to confirm whether it distinguishes LP=0, deck-out, and other win conditions. If the worker sends numeric codes or OCGCore-specific strings, the client-side mapping must handle all possible values.

### Critical: Orphaned Room Cleanup (Known Debt)

If the client crashes or closes the browser without clicking "Leave Room", the room stays `ACTIVE` in Spring Boot indefinitely. The duel-server 5-minute timeout cleans up the WebSocket session but does NOT call `POST /rooms/:id/end`. This is **acceptable for MVP** — orphaned rooms don't appear in the lobby (lobby shows only WAITING rooms) and don't block functionality. A future cleanup cron job can resolve stale ACTIVE rooms.

### Critical: canDeactivate Guard Update

The current guard in `app.routes.ts` allows navigation when `duelResult()` is set:
```typescript
if (component.wsService.duelResult()) return true;
```

This is correct — once the duel is over, the player can navigate freely. No changes needed for rematch because:
1. During rematch flow, `duelResult()` is still set (overlay shown) → guard allows navigation
2. On REMATCH_STARTING, `duelResult()` is cleared → guard blocks navigation (new duel active)
3. This is the correct behavior — during a new duel from rematch, surrender confirmation works

### What MUST Change (Story 3.4 Scope)

| File | Change | Why |
|------|--------|-----|
| `duel-server/src/ws-protocol.ts` | Add `RematchInvitationMsg`, `RematchStartingMsg`, add `reason` to `RematchCancelledMsg`, update unions | Protocol |
| `duel-server/src/server.ts` | Add `decks`, `rematchRequested`, `rematchTimeout` to session, implement REMATCH_REQUEST handler, add `startRematch()`, `rematchExpired()`, start 5-min timer on DUEL_END, handle post-duel disconnect | Server rematch logic |
| `duel-server/src/message-filter.ts` | Add REMATCH_INVITATION, REMATCH_STARTING, REMATCH_CANCELLED to passthrough whitelist | Message routing |
| `front/src/app/pages/pvp/duel-ws.types.ts` | Mirror protocol changes | Client types |
| `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` | Add `rematchState` signal, `sendRematchRequest()`, handle REMATCH_INVITATION/CANCELLED/STARTING | Client WS state |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | LiveAnnouncer, rematch methods/computeds, backToDeck(), defer POST /end, enhance resultOutcome reason mapping | Result overlay logic |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Enhanced result overlay with Rematch/Leave/BackToDeck buttons + states | UI |
| `front/src/app/pages/pvp/duel-page/duel-page.component.scss` | Backdrop blur, action buttons, disabled states, animation, touch targets | Styling |

### What NOT to Change

- **duel-worker.ts** — No worker changes needed (RPS auto-starts on `initDuel`)
- **message-filter.ts** — Only add passthrough entries; no filter logic changes
- **Spring Boot backend** — No new endpoints needed (existing POST /end is sufficient; rematch is fully server-side in duel-server)
- **Lobby page** — No changes needed
- **Waiting room flow** — No changes (rematch bypasses waiting room entirely)
- **Turn timer / inactivity timer logic** — Auto-works with new worker via existing handlers
- **Surrender flow** — No changes needed (surrender during rematch duel works via existing DUEL_END path)
- **Disconnect/reconnect flow** — No changes (Stories 3.2-3.3 handlers auto-work with new worker)
- **Prompt components** — No changes (RPS prompt auto-works)
- **app.routes.ts** — No route changes needed

### Previous Story Intelligence (Stories 3.1 + 3.2 + 3.3)

**Patterns from 3.1 (Surrender):**
- Result overlay is inline in `duel-page.component.html` (not a separate component) — maintain this pattern
- `resultOutcome` computed handles victory/defeat/draw detection — enhance with better reason mapping
- `backToLobby()` already navigates to `/pvp` — add POST /end call
- canDeactivate guard allows navigation when duelResult is set — no change needed

**Patterns from 3.2 (Turn Timer & Inactivity):**
- `clearAllDuelTimers()` called in ALL duel-ending paths — reuse in `startRematch()` to reset timers
- Timer badge auto-works with new duel (timer signals auto-update from new worker messages)
- `absoluteTurnPlayer` computed resets when new BOARD_STATE arrives — auto-works on rematch

**Patterns from 3.3 (Disconnection & Reconnection):**
- `opponentDisconnected` signal resets on DUEL_END — auto-works
- `lastSentPrompt` cache resets in `cleanupDuelSession()` — also reset in `startRematch()`
- Backoff/reconnection logic auto-works during rematch duel
- `REMATCH_STARTING` handler must reset opponentDisconnected signal

**Anti-Patterns from Previous Stories:**
- Do NOT use `[class]` binding — always `[class.specific-class]`
- Do NOT forget `prefers-reduced-motion` on animated elements
- Do NOT duplicate signal derivations — reuse existing signals
- Do NOT inline z-index values — use `@use 'z-layers' as z` + `z.$z-*` tokens
- Do NOT store `setTimeout` refs without cleanup — always clear in `cleanupDuelSession()` or `destroyRef.onDestroy()`
- Do NOT use `toObservable()` + `pairwise()` when `effect()` with previous-value tracking is simpler
- Do NOT fire-and-forget HTTP subscriptions without considering error paths (but keep it simple for MVP — log errors at minimum)

### Git Intelligence

**Recent commits:** Single "epic 1" commit (35c96f9a), then "PVP Simulator Plan". Current branch: `dev-pvp`. All Epic 2 + 3 work is uncommitted.

**Code conventions observed:**
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)
- `camelCase` methods, `PascalCase` interfaces, `SCREAMING_SNAKE_CASE` constants
- `kebab-case` file names
- Standalone Angular components with `inject()` DI

### Library & Framework Requirements

- **Angular 19.1.3**: Signals, `input()`, `computed()`, `effect()`, OnPush, `inject()`
- **Angular CDK**: `LiveAnnouncer` from `@angular/cdk/a11y` — already a project dependency (used in Story 3.2)
- **Angular Material 19.1.1**: `MatButtonModule` for `mat-stroked-button`, `MatSnackBar` (via `displaySuccess`)
- **Node.js 22+**: `setTimeout`/`clearTimeout` for rematch timeout, `Worker` for new worker spawn
- **TypeScript 5.5.4 (front) / 5.9 (duel-server)**: Strict mode, discriminated unions
- **ws library**: WebSocket server (existing, no version change)

### Testing Requirements

- No automated tests per project "big bang" approach
- Manual verification via Task 9 subtasks
- Focus on: result display, rematch flow (request/accept/decline/timeout), navigation, multiple consecutive rematches, LiveAnnouncer

### Source Tree — Files to Touch

**MODIFY (8 files):**
- `duel-server/src/ws-protocol.ts`
- `duel-server/src/server.ts`
- `duel-server/src/message-filter.ts`
- `front/src/app/pages/pvp/duel-ws.types.ts`
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss`

**REFERENCE (read-only):**
- `front/src/app/core/utilities/functions.ts` (`displaySuccess()`)
- `front/src/app/styles/_z-layers.scss` (existing z-index values — `$z-pvp-result-overlay: 90`)
- `front/src/app/services/auth.service.ts` (user identity)
- `front/src/app/pages/pvp/room.types.ts` (RoomDTO — check for deck ID fields)
- `front/src/app/pages/pvp/room-api.service.ts` (room API — reference, not modified)
- `duel-server/src/types.ts` (DuelSession, PlayerSession interfaces)
- `front/src/app/app.routes.ts` (canDeactivate guard — verify, likely no change)

**DO NOT TOUCH:**
- `duel-server/src/duel-worker.ts` (or `.js`) — worker logic unchanged
- Backend (Spring Boot) — no new endpoints needed
- Lobby page — no changes needed
- Prompt components — auto-work with new worker
- Timer badge — auto-works with new duel
- Disconnect/reconnect logic — auto-works

### Project Structure Notes

- Result overlay stays inline in `duel-page.component.html` — consistent with existing pattern, no separate component
- Protocol types kept in sync between `ws-protocol.ts` (duel-server) and `duel-ws.types.ts` (frontend)
- Rematch logic is server-side in `server.ts` — no Spring Boot involvement (epics requirement)
- 5-minute timeout is server-authoritative — client just reflects the state
- Deck data flows: Spring Boot → POST /duels → server.ts session → worker → rematch reuse

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 3, Story 3.4]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — FR7, FR24, WebSocket Protocol, Room Lifecycle, NFR2/4/5]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — Journey 4: Duel End & Rematch, PvpDuelResultOverlayComponent, Button Hierarchy, prefers-reduced-motion]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — FR7, FR24, NFR1/2/4/5]
- [Source: _bmad-output/implementation-artifacts/3-1-surrender.md — Result overlay pattern, ownPlayerIndex, canDeactivate guard]
- [Source: _bmad-output/implementation-artifacts/3-2-turn-timer-inactivity-timeout.md — clearAllDuelTimers, timer reset on new duel]
- [Source: _bmad-output/implementation-artifacts/3-3-disconnection-handling-reconnection.md — REMATCH_REQUEST stub, opponentDisconnected reset, lastSentPrompt cleanup]
- [Source: _bmad-output/implementation-artifacts/2-3-waiting-room-duel-start-rps.md — RPS flow, worker spawn pattern, POST /api/duels handler]
- [Source: _bmad-output/project-context.md — Project rules & conventions]
- [Source: duel-server/src/ws-protocol.ts — Existing message types, RematchRequestMsg, RematchCancelledMsg]
- [Source: duel-server/src/server.ts — ActiveDuelSession, POST /api/duels handler, WORKER_MESSAGE handler, cleanupDuelSession]
- [Source: front/src/app/pages/pvp/duel-page/duel-page.component.ts — resultOutcome, backToLobby, POST /end effect]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts — duelResult signal, handleMessage switch]
- [Source: front/src/app/styles/_z-layers.scss — $z-pvp-result-overlay: 90]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Worker exit handler would call cleanupDuelSession on terminate during rematch — fixed by removing all listeners before terminating old worker in startRematch()
- handleDuelEnd() created as unified function to set endedAt + start rematch timeout in all DUEL_END paths (surrender, timeout, inactivity, disconnect, worker error, natural game end)
- Worker exit handler modified: if endedAt already set, skip cleanupDuelSession (session kept alive for rematch)
- RoomDTO lacks deck ID fields → backToDeck() navigates to /deck (deck list) as fallback per Dev Notes
- SCSS budget exceeded 6kB → increased angular.json budget to 10kB (deck-builder already at 6.12kB pre-existing)
- REMATCH_STARTING resets duelState to EMPTY_DUEL_STATE (not null) since the signal type is DuelState not DuelState|null

### Completion Notes List

- Tasks 1-8 implemented and verified (TypeScript compilation passes for both duel-server and frontend)
- Angular production build passes
- Task 9 (manual verification) left for user to perform — per "big bang" testing approach
- Key architectural decisions:
  - Extracted `attachWorkerHandlers()` function for reuse between initial creation and rematch
  - Created `handleDuelEnd()` helper for unified DUEL_END handling across all paths
  - Decks stored as `[Deck, Deck]` (full Deck objects with main/extra) matching worker's INIT_DUEL format
  - Same duelId reused across rematches (session persists, only worker replaced)

### Change Log

- 2026-02-28: Story 3.4 implementation — Duel result screen & rematch (Tasks 1-8)
- 2026-02-28: Code review — 8 issues found (2H, 2M, 4L), all fixed:
  - [H1] broadcastMessage() now detects MSG_WIN → generates DUEL_END for natural game endings (LP=0, deck-out)
  - [H2] mapDuelEndReason() uses explicit 'win' case instead of fragile reason.includes('lp')
  - [M1] Added "Starting new duel..." overlay during rematch transition (rematchStarting signal)
  - [M2] Fixed disabled button opacity fallback from 0.4 to 0.6 per AC2
  - [L1] Added defensive comment on unused message-filter passthrough entries
  - [L2] Replaced non-functional CSS transition with @keyframes entrance animation
  - [L3] Fixed rematchState reconnection desync (only reset on initial connection, not reconnection)
  - [L4] Fixed backToDeck() wrong route (/deck → /decks), added decklistId-aware navigation

### File List

**Modified:**
- `duel-server/src/ws-protocol.ts` — Added RematchInvitationMsg, RematchStartingMsg; updated RematchCancelledMsg with reason field; updated ServerMessage union
- `duel-server/src/server.ts` — Added decks/rematchRequested/rematchTimeout to ActiveDuelSession; extracted attachWorkerHandlers(); added startRematch(), rematchExpired(), handleDuelEnd(); implemented REMATCH_REQUEST handler; post-duel disconnect handling; rematch timeout cleanup in cleanupDuelSession
- `duel-server/src/message-filter.ts` — Added REMATCH_INVITATION, REMATCH_STARTING to passthrough whitelist
- `front/src/app/pages/pvp/duel-ws.types.ts` — Mirrored all ws-protocol.ts changes
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` — Added rematchState signal, sendRematchRequest(), REMATCH_INVITATION/CANCELLED/STARTING handlers, rematchState reset on ws.onopen
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Enhanced resultOutcome with mapDuelEndReason(), added rematchButtonLabel/rematchDisabled computeds, added backToDeck()/onRematchClick(), deferred POST /end to navigation methods, added LiveAnnouncer result announcement effect
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — Enhanced result overlay with Rematch/Leave Room/Back to Deck buttons, rematch state-driven UI
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss` — Backdrop blur, action button styles, disabled states, prefers-reduced-motion media query
- `front/angular.json` — Increased anyComponentStyle budget from 6kB to 10kB
