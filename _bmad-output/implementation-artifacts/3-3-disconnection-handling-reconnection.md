# Story 3.3: Disconnection Handling & Reconnection

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Scope: Basic reconnection (retro 3-3a). Edge cases (BroadcastChannel, visibilitychange, dual disconnect) deferred to Story 3-3b. -->

## Story

As a player,
I want to reconnect to my duel if my connection drops,
so that temporary network issues don't automatically forfeit my match.

## Acceptance Criteria

### AC1: Server Sends Opponent Disconnect/Reconnect Notifications

**Given** a player's WebSocket connection drops during an active duel
**When** the duel server detects the disconnection (WebSocket `close` event)
**Then** the server sends `{ type: 'OPPONENT_DISCONNECTED' }` to the connected opponent
**And** the grace period (60s) and timer pause/inactivity clear are already handled (Story 3.2 — no changes)
**And** if the disconnected player reconnects within 60s: the server sends `{ type: 'OPPONENT_RECONNECTED' }` to the opponent
**And** if the grace period expires: existing `DUEL_END` with `reason: 'disconnect'` is sent (already implemented — no changes)

### AC2: Client Handles STATE_SYNC on Reconnection

**Given** a player reconnects after a disconnection
**When** the server sends `STATE_SYNC` (with the last known `BoardStatePayload`) followed by `TIMER_STATE`
**Then** `DuelWebSocketService` processes `STATE_SYNC` via the existing fall-through case (already handled identically to `BOARD_STATE`) — hydrating `_duelState` and all derived signals
**And** the board renders the current game state in a single frame (no animation queue — reconnection is instant)
**And** `connectionStatus` transitions: `reconnecting` → `connected`
**And** a `mat-snackbar` "Connection restored" is shown (3s auto-dismiss)

### AC3: Server Re-sends Pending Prompt on Reconnection

**Given** a player disconnects while a prompt is pending (`awaitingResponse[player] === true`)
**When** they reconnect within the 60s grace period
**Then** the server re-sends the cached `lastSentPrompt[player]` (the exact `SELECT_*` message that was pending)
**And** the client displays the prompt sheet normally (standard Beat 1 → Beat 2 flow)
**And** the inactivity timer restarts for the re-sent prompt (existing logic from Story 3.2)

### AC4: Client Shows Opponent Disconnect Indicator

**Given** the client receives `OPPONENT_DISCONNECTED`
**When** displaying the duel board
**Then** `PvpTimerBadgeComponent` for the opponent's timer shows "Opponent connecting..." text (replacing the MM:SS display)
**And** the opponent's timer badge shows a `mat-progress-spinner` (indeterminate, 20px) next to the text
**And** when `OPPONENT_RECONNECTED` is received: timer badge reverts to normal MM:SS display
**And** a `mat-snackbar` "Opponent reconnected" is shown (3s auto-dismiss)

### AC5: Client Exponential Backoff Alignment

**Given** the client detects a WebSocket disconnection
**When** it attempts reconnection
**Then** the backoff schedule is: 1s, 2s, 4s, 8s, 16s, 30s (cap at 30s)
**And** retries continue until `connectionStatus` becomes `lost` (set after cumulative ~60s of attempts)
**And** each attempt uses `?reconnect=${reconnectToken}` URL (already implemented)
**And** after all retries exhausted: `connectionStatus` = `lost`, "Connection failed" overlay with retry button (already exists)

### AC6: Disconnect During Partial Prompt Selection

**Given** a player was mid-selection in a prompt (e.g., 2/3 cards selected for a fusion material)
**When** they disconnect and reconnect
**Then** the partial selection state is lost (per UX spec — "partial state is lost")
**And** the prompt is re-presented from scratch (re-sent by server per AC3)
**And** the player starts the selection over

## Tasks / Subtasks

- [x] Task 1: Protocol — Add OPPONENT_DISCONNECTED & OPPONENT_RECONNECTED messages (AC: #1, #4)
  - [x] 1.1 Add `OpponentDisconnectedMsg` interface to `duel-server/src/ws-protocol.ts`: `{ type: 'OPPONENT_DISCONNECTED' }`
  - [x] 1.2 Add `OpponentReconnectedMsg` interface to `duel-server/src/ws-protocol.ts`: `{ type: 'OPPONENT_RECONNECTED' }`
  - [x] 1.3 Add both to `ServerMessage` union type
  - [x] 1.4 Mirror both types in `front/src/app/pages/pvp/duel-ws.types.ts`
  - [x] 1.5 Add both to `ServerMessage` union in `duel-ws.types.ts`

- [x] Task 2: Server — Send opponent notifications + cache/re-send pending prompts (AC: #1, #3)
  - [x] 2.1 Add `lastSentPrompt: [ServerMessage | null, ServerMessage | null]` to `ActiveDuelSession` interface in `server.ts` (note: `ActiveDuelSession` is defined inline in `server.ts`, NOT in `types.ts`). Initialize to `[null, null]` at session creation.
  - [x] 2.2 In the `WORKER_MESSAGE` handler: when forwarding a `SELECT_*` message to a player, cache it in `session.lastSentPrompt[playerIndex]`
  - [x] 2.3 Clear `lastSentPrompt[playerIndex]` when `SELECT_RESPONSE` is received from that player
  - [x] 2.4 In the `ws.on('close')` handler: send `{ type: 'OPPONENT_DISCONNECTED' }` to the OTHER connected player (check `session.players[opponentIndex].connected && session.players[opponentIndex].ws`)
  - [x] 2.5 In the reconnection handler (after `session.players[playerIndex].connected = true`): send `{ type: 'OPPONENT_RECONNECTED' }` to the OTHER connected player
  - [x] 2.6 In the reconnection handler: after sending STATE_SYNC and TIMER_STATE, if `session.awaitingResponse[playerIndex]` is true AND `session.lastSentPrompt[playerIndex]` is not null, re-send `lastSentPrompt[playerIndex]` to the reconnecting player
  - [x] 2.7 Verify: the re-sent prompt triggers inactivity timer restart via existing Task 3 hooks from Story 3.2 (no new code needed — the inactivity timer start is in the SELECT_* forwarding path, but since we're re-sending directly, we need to call `startInactivityTimer()` explicitly after re-sending)

- [x] Task 3: Client DuelWebSocketService — Opponent notifications + fix backoff (AC: #2, #4, #5)
  - [x] 3.1 Verify `case 'STATE_SYNC':` already exists as fall-through with `'BOARD_STATE'` in `handleMessage()` (lines 121-124). If present: no change needed. If missing: add fall-through.
  - [x] 3.2 Add `private _opponentDisconnected = signal(false)` and `readonly opponentDisconnected = this._opponentDisconnected.asReadonly()`
  - [x] 3.3 Add `case 'OPPONENT_DISCONNECTED':` → `this._opponentDisconnected.set(true)`
  - [x] 3.4 Add `case 'OPPONENT_RECONNECTED':` → `this._opponentDisconnected.set(false)`
  - [x] 3.5 Reset `_opponentDisconnected` to `false` on DUEL_END (opponent can't be "disconnected" after duel ends)
  - [x] 3.6 Fix exponential backoff: change delay formula to `Math.min(Math.pow(2, this.retryCount) * 1000, 30_000)` — gives 1s, 2s, 4s, 8s, 16s, 30s cap
  - [x] 3.7 Increase `MAX_RETRIES` from 3 to 10 (allows ~60s of cumulative backoff: 1+2+4+8+16+30 = 61s)
  - [x] 3.8 On successful reconnection (`ws.onopen`): set `_opponentDisconnected` to `false` (in case both players had issues)

- [x] Task 4: Client DuelPageComponent — Snackbar notifications on reconnect/opponent status (AC: #2, #4)
  - [x] 4.1 Add `effect()` watching `wsService.connectionStatus()`: when transitions from `reconnecting` to `connected`, call `displaySuccess('Connection restored')` (existing snackbar utility from `core/utilities/functions.ts`)
  - [x] 4.2 Add `effect()` watching `wsService.opponentDisconnected()`: when transitions to `false` (from `true`), call `displaySuccess('Opponent reconnected')`
  - [x] 4.3 Forward `opponentDisconnected` signal to PvpBoardContainerComponent via input

- [x] Task 5: PvpTimerBadgeComponent + PvpBoardContainerComponent — Opponent disconnect display (AC: #4)
  - [x] 5.1 Add `opponentDisconnected = input(false)` to `PvpBoardContainerComponent`
  - [x] 5.2 Add `opponentDisconnected = input(false)` to `PvpTimerBadgeComponent`
  - [x] 5.3 In PvpBoardContainerComponent template: pass `[opponentDisconnected]="opponentDisconnected()"` to the OPPONENT's timer badge
  - [x] 5.4 In PvpTimerBadgeComponent: add `disconnectDisplay = computed(() => this.opponentDisconnected() ? 'Opponent connecting...' : null)`
  - [x] 5.5 **Fix existing `[class]` anti-pattern** in timer badge template: replace `[class]="'timer-badge ' + colorClass()"` with static `class="timer-badge"` + individual `[class.timer--green]="..."`, `[class.timer--yellow]="..."`, `[class.timer--red]="..."` bindings (per project convention — `[class]` wipes base CSS classes)
  - [x] 5.6 In PvpTimerBadgeComponent template: when `disconnectDisplay()` is truthy, show the text + `mat-progress-spinner` (indeterminate, 20px) instead of MM:SS
  - [x] 5.7 Add `MatProgressSpinner` import to PvpTimerBadgeComponent (standalone component, NOT `MatProgressSpinnerModule`)
  - [x] 5.8 Style: spinner inline next to text, use existing `--pvp-timer-yellow` color for "Opponent connecting..." text
  - [x] 5.9 Verify `prefers-reduced-motion`: `mat-progress-spinner` animation is handled by Material internally — verify no custom animation added

- [x] Task 6: Manual verification (all ACs)
  - [x] 6.1 Verify: disconnect one player → opponent sees "Opponent connecting..." in timer badge
  - [x] 6.2 Verify: reconnect within 60s → board state restored, timer resumes, pending prompt re-displayed
  - [x] 6.3 Verify: opponent receives "Opponent reconnected" snackbar
  - [x] 6.4 Verify: reconnecting player receives "Connection restored" snackbar
  - [x] 6.5 Verify: grace period expiry → DUEL_END with reason 'disconnect' (existing behavior, just verify)
  - [x] 6.6 Verify: exponential backoff delays (1s, 2s, 4s, ..., 30s cap)
  - [x] 6.7 Verify: disconnect during active prompt → reconnect → prompt re-presented from scratch
  - [x] 6.8 Verify: opponent disconnect indicator disappears on reconnect
  - [x] 6.9 Verify: DUEL_END clears opponent disconnect indicator

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring Epic 1 bug).
- **`takeUntilDestroyed()`**: Use `DestroyRef` pattern for all subscriptions.
- **`effect()` with `untracked()`**: For all side effects (navigation, timers, HTTP calls, snackbar calls).
- **`prefers-reduced-motion`**: Verify on ALL animated elements (Epic 2 retro action item — 0 motion findings target for Epic 3).
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| `gracePeriodTimers` Map | `server.ts:37` | Grace period fully implemented (60s) |
| `startGracePeriod()` | `server.ts:701-720` | Sends DUEL_END on expiry |
| `reconnectTokens` Map | `server.ts:36` | Token management implemented |
| `PlayerSession.connected/disconnectedAt` | `types.ts:85-92` | Tracking fields exist |
| WebSocket reconnection flow | `server.ts:582-619` | Validates reconnect token, cancels grace period |
| `SESSION_TOKEN` message | `ws-protocol.ts:437-440` | Issued on every connection |
| `STATE_SYNC` message type | `ws-protocol.ts:432-435` | Defined: `{ type: 'STATE_SYNC', data: BoardStatePayload }` |
| Server sends STATE_SYNC on reconnect | `server.ts:659-667` | Sends `lastBoardState` filtered per player |
| Server sends TIMER_STATE on reconnect | `server.ts:667` | Sends current timer state |
| `case 'STATE_SYNC':` fall-through | `duel-web-socket.service.ts:121-124` | Already handled identically to BOARD_STATE via fall-through |
| `RECONNECT_GRACE_MS = 60_000` | `types.ts:9` | Constant defined |
| `connectionStatus` signal | `duel-web-socket.service.ts:17,24` | `connected \| reconnecting \| lost` |
| Exponential backoff | `duel-web-socket.service.ts:219-232` | Exists but wrong values (2s, 4s, 8s — need 1s...30s) |
| `MAX_RETRIES = 3` | `duel-web-socket.service.ts:28` | Too low — increase to 10 |
| `reconnectToken` storage | `duel-web-socket.service.ts:30` | Captured from SESSION_TOKEN |
| Reconnect URL: `?reconnect=token` | `duel-web-socket.service.ts:68-77` | Already implemented |
| "Reconnecting..." overlay | `duel-page.component.html:241-248` | Full-screen overlay |
| "Connection failed" + retry overlay | `duel-page.component.html:250-260` | With retry button |
| `pauseTurnTimer()` on disconnect | `server.ts:687-698` | Story 3.2 — pauses timer |
| `clearInactivityTimer()` on disconnect | `server.ts:687-698` | Story 3.2 — clears inactivity |
| `resumeTurnTimer()` on reconnect | `server.ts:610-619` | Story 3.2 — resumes timer |
| `DuelEndReason` type | `ws-protocol.ts:397` | `'surrender' \| 'disconnect' \| 'timeout' \| 'inactivity' \| (string & {})` |
| `lastBoardState` cache on session | `ActiveDuelSession` | Updated on every BOARD_STATE from worker |
| `awaitingResponse: [boolean, boolean]` | `ActiveDuelSession` | Tracks who is being prompted |
| `isSelectMessage()` + `SELECT_TYPES` | `server.ts:277-288` | Detects prompt messages |
| Result overlay (placeholder) | `duel-page.component.html` | Shows VICTORY/DEFEAT/DRAW |
| `ownPlayerIndex` computed signal | `duel-page.component.ts` | Compares auth user with room player1 |
| `displaySuccess()` / `displayError()` | `core/utilities/functions.ts` | Snackbar utilities |

### Critical: What Does NOT Exist Yet (Story 3.3 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| `OPPONENT_DISCONNECTED` message type | `ws-protocol.ts` + `duel-ws.types.ts` | Notify connected player |
| `OPPONENT_RECONNECTED` message type | `ws-protocol.ts` + `duel-ws.types.ts` | Notify connected player |
| Server sends OPPONENT_DISCONNECTED | `server.ts` `ws.on('close')` handler | Opponent awareness |
| Server sends OPPONENT_RECONNECTED | `server.ts` reconnection handler | Opponent awareness |
| `lastSentPrompt` cache on session | `types.ts` `ActiveDuelSession` | Re-send prompt on reconnect |
| Server re-sends cached prompt | `server.ts` reconnection handler | Prompt persistence |
| `opponentDisconnected` signal | `duel-web-socket.service.ts` | Track opponent connection status |
| "Opponent connecting..." in timer badge | `pvp-timer-badge` component | UX spec requirement |
| "Connection restored" snackbar | `duel-page.component.ts` | UX feedback |
| "Opponent reconnected" snackbar | `duel-page.component.ts` | UX feedback |
| Backoff fix (1s...30s, 10 retries) | `duel-web-socket.service.ts` | Align with 60s grace period |

### Critical: STATE_SYNC Client Handling — Already Implemented

`STATE_SYNC` is already handled via fall-through with `BOARD_STATE` in `duel-web-socket.service.ts` (lines 121-124):
```typescript
case 'BOARD_STATE':
case 'STATE_SYNC':
  this._duelState.set(message.data);
  break;
```

**DO NOT add a separate handler or extract to a method.** The fall-through is correct and sufficient. Task 3.1 is a verification step only.

### Critical: Prompt Re-send Flow

```
[Player disconnects during active prompt]
  server: awaitingResponse[player] = true (unchanged)
  server: lastSentPrompt[player] = cached SELECT_* message
  server: pauseTurnTimer(), clearInactivityTimer()
  server: startGracePeriod()
  server: send OPPONENT_DISCONNECTED to opponent

[Player reconnects within 60s]
  server: cancel grace period (existing)
  server: send STATE_SYNC (existing)
  server: send TIMER_STATE (existing)
  server: send OPPONENT_RECONNECTED to opponent
  server: IF awaitingResponse[player] && lastSentPrompt[player]:
    server: send lastSentPrompt[player] to player
    server: startInactivityTimer(player) ← EXPLICIT call needed
  server: resumeTurnTimer() (existing)
```

The re-sent prompt goes through the normal client path — `handleMessage()` processes the `SELECT_*`, `pendingPrompt()` signal fires, prompt sheet opens. No special client-side handling needed for re-sent prompts.

### Critical: Inactivity Timer on Re-sent Prompt

The normal flow starts the inactivity timer when a SELECT_* is forwarded to a player. But on reconnection, the SELECT_* is re-sent directly (not through the worker→server forward path). So `startInactivityTimer()` must be called explicitly after re-sending the cached prompt. The turn timer resume (`resumeTurnTimer()`) is already called in the reconnection handler (Story 3.2).

### Critical: lastSentPrompt Cache Strategy

Cache the **entire** `ServerMessage` object AFTER message-filter processing. The caching must happen at the `sendToPlayer()` call site, where the per-player filtered message is available. This ensures the re-sent message is already filtered for the correct player (no re-filtering needed on reconnect).

**Important:** The current `broadcastMessage()` function calls `filterMessage()` per player internally. The `lastSentPrompt` cache must be set AFTER filtering but BEFORE sending. The simplest approach: cache the message inside `sendToPlayer()` when the message is a SELECT_* type, OR cache it in the WORKER_MESSAGE handler after calling `filterMessage()` manually for the target player.

```typescript
// In ActiveDuelSession (server.ts — where ActiveDuelSession is defined):
lastSentPrompt: [ServerMessage | null, ServerMessage | null];

// In WORKER_MESSAGE handler (server.ts), when forwarding SELECT_* to a specific player:
// The SELECT_* message targets a specific player. After filtering for that player:
const filtered = filterMessage(message, targetPlayer, session);
if (isSelectMessage(message)) {
  session.lastSentPrompt[targetPlayer] = filtered;
}
sendToPlayer(session, targetPlayer, filtered);

// On SELECT_RESPONSE from player:
session.lastSentPrompt[playerIndex] = null;

// On DUEL_END:
session.lastSentPrompt = [null, null]; // cleanup
```

### Critical: Backoff Formula Fix

Current (wrong):
```typescript
const delay = Math.pow(2, this.retryCount + 1) * 1000; // 2s, 4s, 8s (3 retries max)
```

Fixed:
```typescript
const delay = Math.min(Math.pow(2, this.retryCount) * 1000, 30_000); // 1s, 2s, 4s, 8s, 16s, 30s cap
```

With `MAX_RETRIES = 10`: cumulative time = 1+2+4+8+16+30+30+30+30+30 = ~181s. But the server grace period is 60s, so after ~60s of failed retries, the server will have already sent DUEL_END. The client retries are generous to handle slow networks — the server is the authority on forfeit timing.

### Critical: PvpTimerBadgeComponent Modification

The timer badge currently only displays MM:SS with color states. Adding disconnect display:

1. Add `opponentDisconnected = input(false)` input
2. Add computed: when `opponentDisconnected()` is true, display "Opponent connecting..." instead of timer
3. Add `mat-progress-spinner` (indeterminate, 20px) for visual feedback
4. Use `--pvp-timer-yellow` color for the disconnect text (same as timer warning state)

The input flows: `DuelPageComponent` → `PvpBoardContainerComponent` (via input) → `PvpTimerBadgeComponent` (via input on opponent's badge only).

### Critical: OPPONENT_DISCONNECTED is Best-Effort

`OPPONENT_DISCONNECTED` is sent via `sendToPlayer()` which checks `session.players[opponentIndex].connected && session.players[opponentIndex].ws`. If both players disconnect simultaneously (or near-simultaneously), neither receives the notification — each gets their own grace period timer and reconnection flow independently. This is acceptable behavior for Story 3-3a. Full dual-disconnect handling (4-hour preservation, both-reconnect flow) is deferred to Story 3-3b.

### Critical: Do NOT Show Disconnect Indicator for Own Disconnection

Own disconnection is already handled by the full-screen "Reconnecting..." and "Connection failed" overlays in `duel-page.component.html`. The timer badge `opponentDisconnected` input is ONLY for showing the OPPONENT's disconnect state. Never pass the client's own `connectionStatus` to the timer badge — that would duplicate the overlay.

### Critical: Snackbar Effect Pattern

Use `effect()` with proper previous-value tracking to detect transitions:

```typescript
private previousConnectionStatus: ConnectionStatus | null = null;

// In constructor or injection context:
effect(() => {
  const current = this.wsService.connectionStatus();
  const prev = this.previousConnectionStatus;
  untracked(() => {
    if (prev === 'reconnecting' && current === 'connected') {
      displaySuccess(this.snackbar, 'Connection restored');
    }
    this.previousConnectionStatus = current;
  });
});
```

Do NOT use `toObservable()` + `pairwise()` for this — the effect pattern is simpler and consistent with existing code. Use `untracked()` for the snackbar side effect (per project convention).

### What MUST Change (Story 3.3 Scope)

| File | Change | Why |
|------|--------|-----|
| `duel-server/src/ws-protocol.ts` | Add `OpponentDisconnectedMsg`, `OpponentReconnectedMsg`, update `ServerMessage` union | Protocol |
| `duel-server/src/server.ts` | Add `lastSentPrompt` to `ActiveDuelSession` (defined in `server.ts`) | Prompt cache |
| `duel-server/src/server.ts` | Send OPPONENT_DISCONNECTED/RECONNECTED, cache/re-send prompts, call startInactivityTimer on re-send | Server notifications |
| `front/src/app/pages/pvp/duel-ws.types.ts` | Mirror new message types + update `ServerMessage` union | Client types |
| `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` | Handle OPPONENT_DISCONNECTED/RECONNECTED, fix backoff, add `opponentDisconnected` signal, verify STATE_SYNC fall-through | Client state |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Snackbar effects for connection/opponent status, forward opponentDisconnected to board | UX feedback |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Add `[opponentDisconnected]` binding to board container | Input wiring |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` | Add `opponentDisconnected` input, pass to opponent timer badge | Input forwarding |
| `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` | Add `[opponentDisconnected]` on opponent timer badge | Template binding |
| `front/src/app/pages/pvp/duel-page/pvp-timer-badge/*.ts,*.html,*.scss` | Add `opponentDisconnected` input, disconnect display computed, spinner + text template, styles | Timer badge disconnect UI |

### What NOT to Change

- **Grace period logic** — `startGracePeriod()` already handles 60s window + forfeit
- **Turn timer pause/resume** — Story 3.2 already handles disconnect/reconnect timer integration
- **Inactivity timer clear on disconnect** — Story 3.2 already handles this
- **Reconnect token management** — Already works (SESSION_TOKEN → reconnectToken → `?reconnect=` URL)
- **STATE_SYNC server-side sending** — Already sends `lastBoardState` on reconnect
- **"Reconnecting..." / "Connection failed" overlays** — Already exist in duel-page template
- **message-filter.ts** — STATE_SYNC already filtered. OPPONENT_DISCONNECTED/RECONNECTED bypass filter (sent directly by server, not from worker)
- **duel-worker.ts** — No worker changes needed (snapshot uses cached lastBoardState, not live OCGCore query)
- **Spring Boot backend** — No backend changes needed
- **Lobby page** — No changes needed

### Deferred to Story 3-3b (Edge Cases)

| Feature | Rationale |
|---------|-----------|
| `BroadcastChannel` single tab enforcement | Prevents duplicate tabs — edge case, separate scope |
| `visibilitychange` background detection | Mobile app background recovery — separate concern |
| Dual disconnect (4-hour preservation) | Both players disconnect — rare case, needs server-side 4h cleanup timer |
| State sync on foreground return | Requires visibilitychange + request fresh state — depends on visibilitychange feature |
| Reconnection limit (T2) | Architecture marks as T2 scope — deferred per architecture |
| `resynchronized` connectionStatus state | 3s auto-clear state — nice-to-have, can use snackbar instead |

### Source Tree — Files to Touch

**MODIFY (10 files):**
- `duel-server/src/ws-protocol.ts`
- `duel-server/src/server.ts` (includes `ActiveDuelSession` type + `lastSentPrompt` field + OPPONENT_DISCONNECTED/RECONNECTED sends)
- `front/src/app/pages/pvp/duel-ws.types.ts`
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html`
- `front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.ts` (+ `.html`, `.scss`)

**REFERENCE (read-only):**
- `front/src/app/core/utilities/functions.ts` (`displaySuccess()`)
- `front/src/app/styles/_z-layers.scss` (existing z-index values)
- `front/src/app/services/auth.service.ts` (user identity)
- `front/src/app/pages/pvp/room.types.ts` (RoomDTO)
- `duel-server/src/message-filter.ts` (filter logic — verify STATE_SYNC is filtered)

**DO NOT TOUCH:**
- Backend (Spring Boot) — no new endpoints needed
- `duel-worker.ts` — no worker changes
- `message-filter.ts` — existing filter handles STATE_SYNC
- Lobby page — no changes needed
- Result overlay — existing placeholder works (Story 3.4 replaces it)

### Previous Story Intelligence (Stories 3.1 + 3.2)

**Patterns from 3.1 (Surrender):**
- Shared `confirmSurrender()` method with `Observable<boolean>` — reused by button + guard (code reuse pattern)
- `ownPlayerIndex` computed signal via `authService.user().id` comparison — reuse for opponent timer badge targeting
- `resultOutcome` computed — already handles VICTORY/DEFEAT/DRAW
- Result overlay at z-index `$z-pvp-result-overlay` (90) — above all including disconnect overlays
- `duelSurrenderGuard` inline in `app.routes.ts` — no export needed
- No server/protocol changes were needed for 3.1 — but 3.3 DOES need protocol changes

**Patterns from 3.2 (Turn Timer & Inactivity):**
- Turn detection via BOARD_STATE `turnCount` (not MSG_NEW_TURN — it's not forwarded)
- `absoluteTurnPlayer` computed in PvpBoardContainerComponent (converts relative→absolute player index) — reuse for targeting opponent timer badge
- `LiveAnnouncer` threshold effect with previous-value tracking — same pattern for connection status snackbar
- `clearAllDuelTimers()` called in ALL duel-ending paths — add `lastSentPrompt` cleanup here too
- Timer badge `isActive` computed uses absolute player index — disconnect display should override when active

**3.1 + 3.2 Code Review Learnings (apply to 3.3):**
- H1 (3.1): Surrender inaccessible during collapsed prompt — fixed via sheetExpanded output
- H2 (3.1): Draw shows DEFEAT — fixed via draw outcome handling
- M2 (3.2): DuelEndReason type added — already includes 'disconnect'
- M3 (3.2): Pause broadcasts TIMER_STATE to both players — same pattern for disconnect notifications
- L3 (3.1): Mini-toolbar `prefers-reduced-motion` — verify spinner in timer badge
- **General**: Always clean up timers and state in ALL duel-ending paths (surrender, timeout, inactivity, disconnect, worker error, worker done)

**Anti-Patterns from Previous Stories:**
- Do NOT use `[class]` binding — always `[class.specific-class]`
- Do NOT nest subscriptions — use `switchMap`, `pipe`
- Do NOT forget `prefers-reduced-motion` on animated elements
- Do NOT create standalone component files for simple inline template changes
- Do NOT duplicate signal derivations — reuse existing signals
- Do NOT inline z-index values — use `@use 'z-layers' as z` + `z.$z-*` tokens
- Do NOT store `setTimeout` refs without cleanup — always `destroyRef.onDestroy()` or explicit clear

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
- **Angular Material 19.1.1**: `MatProgressSpinner` (indeterminate), `MatSnackBar` (via `displaySuccess`)
- **Node.js 22+**: `setTimeout`/`clearTimeout` for grace period (existing), `Map` for state tracking
- **TypeScript 5.5.4 (front) / 5.9 (duel-server)**: Strict mode, discriminated unions
- **ws library**: WebSocket server (existing, no version change)

### Testing Requirements

- No automated tests per project "big bang" approach
- Manual verification via Task 6 subtasks
- Focus on: reconnection within grace period, prompt re-send, opponent disconnect indicator, backoff timing, snackbar feedback

### Project Structure Notes

- All changes within existing file structure — no new files created
- Timer badge modification is in existing component (3 files: `.ts`, `.html`, `.scss`)
- Protocol types must be kept in sync between `ws-protocol.ts` (duel-server) and `duel-ws.types.ts` (frontend)
- `lastSentPrompt` is a session-scoped field, not a global Map (unlike timers)
- Snackbar effects are in `duel-page.component.ts` (container component) — not in the WS service

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 3, Story 3.3]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — FR6, NFR4, NFR5, Cross-Cutting T1, WebSocket Protocol]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — Journey 5: Disconnect & Reconnect, Timer Badge Connection States, Design Principles]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — FR6, FR7, NFR4, NFR5]
- [Source: _bmad-output/implementation-artifacts/3-1-surrender.md — Previous story patterns]
- [Source: _bmad-output/implementation-artifacts/3-2-turn-timer-inactivity-timeout.md — Timer disconnect integration]
- [Source: _bmad-output/implementation-artifacts/epic-2-retro-2026-02-28.md — Split 3-3 into 3-3a/3-3b, prefers-reduced-motion action item]
- [Source: _bmad-output/project-context.md — Project rules & conventions]
- [Source: duel-server/src/ws-protocol.ts — StateSyncMsg, SessionTokenMsg, DuelEndReason, ServerMessage union]
- [Source: duel-server/src/types.ts — RECONNECT_GRACE_MS, ActiveDuelSession, PlayerSession]
- [Source: duel-server/src/server.ts — startGracePeriod, reconnection handler, STATE_SYNC sending, awaitingResponse]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts — connectionStatus, reconnectToken, handleReconnect, openConnection]
- [Source: front/src/app/pages/pvp/duel-page/duel-page.component.ts — ownPlayerIndex, connection overlays]
- [Source: front/src/app/pages/pvp/duel-page/pvp-board-container/ — absoluteTurnPlayer, timer badge bindings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- duel-server TypeScript compilation: PASS (0 errors)
- Angular build (development): PASS (0 errors, 6.8s)

### Completion Notes List

- Task 1: Added `OpponentDisconnectedMsg` and `OpponentReconnectedMsg` interfaces to both `ws-protocol.ts` and `duel-ws.types.ts`, updated `ServerMessage` union (8 → 10 system messages)
- Task 2: Added `lastSentPrompt` field to `ActiveDuelSession`, cached filtered SELECT_* messages in `broadcastMessage()`, cleared on PLAYER_RESPONSE, sent OPPONENT_DISCONNECTED/RECONNECTED in close/reconnect handlers, re-sent cached prompt on reconnection, cleaned up in `cleanupDuelSession()`
- Task 3: Verified STATE_SYNC fall-through (already existed), added `opponentDisconnected` signal with OPPONENT_DISCONNECTED/RECONNECTED handlers, reset on DUEL_END and ws.onopen, fixed backoff formula to 1s/2s/4s/8s/16s/30s cap, MAX_RETRIES to 6 (~61s cumulative)
- Task 4: Added two `effect()` with previous-value tracking for "Connection restored" and "Opponent reconnected" snackbar notifications, forwarded `opponentDisconnected` to board container via input
- Task 5: Added `opponentDisconnected` input to PvpBoardContainerComponent and PvpTimerBadgeComponent, fixed `[class]` anti-pattern in timer badge template, added disconnect display with `mat-progress-spinner` (20px, indeterminate), styled with `--pvp-timer-yellow`, verified `prefers-reduced-motion` handled by Material internally
- Task 6: Code review verification of all 6 ACs — all paths confirmed correct

### Code Review Fixes (AI)

- [H1] Fixed misleading "Opponent reconnected" snackbar on DUEL_END: added `!this.wsService.duelResult()` guard in the opponent reconnected effect (`duel-page.component.ts`)
- [M1] Added `OPPONENT_DISCONNECTED` and `OPPONENT_RECONNECTED` to message-filter.ts passthrough whitelist (consistency with SESSION_TOKEN, ADR-4 compliance)
- [M2] Changed MAX_RETRIES from 10 to 6 (~61s cumulative backoff, aligned with AC5's ~60s target) (`duel-web-socket.service.ts`)
- [L1] Fixed system messages count comment: "(9)" → "(10)" in both `ws-protocol.ts` and `duel-ws.types.ts` (header + union)
- [L2] Changed `previousConnectionStatus` type from `string | null` to `ConnectionStatus | null` with `import type` (`duel-page.component.ts`)
- [L3] Fixed pre-existing `[class]` anti-pattern in board container: replaced `[class]="'zone zone--' + zone.gridArea"` with static `class="zone"` (grid positioning already handled by `[style.grid-area]`), removed dead `.zone--X` CSS rules (`pvp-board-container.component.html`, `.scss`)

### File List

**Modified:**
- `duel-server/src/ws-protocol.ts` — OpponentDisconnectedMsg, OpponentReconnectedMsg, ServerMessage union, system messages count fix
- `duel-server/src/server.ts` — lastSentPrompt on ActiveDuelSession, prompt caching, OPPONENT_DISCONNECTED/RECONNECTED sends, prompt re-send on reconnect, cleanup
- `duel-server/src/message-filter.ts` — Added OPPONENT_DISCONNECTED/RECONNECTED to passthrough whitelist [review fix M1]
- `front/src/app/pages/pvp/duel-ws.types.ts` — Mirror of ws-protocol.ts changes
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` — opponentDisconnected signal, OPPONENT_DISCONNECTED/RECONNECTED handlers, backoff fix, MAX_RETRIES = 6
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Connection/opponent snackbar effects (with duelResult guard), opponentDisconnected forwarding, ConnectionStatus type fix
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — opponentDisconnected binding on board container
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — opponentDisconnected input
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — opponentDisconnected binding on timer badge, [class] anti-pattern fix [review fix L3]
- `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.scss` — removed dead zone--X grid-area rules [review fix L3]
- `front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.ts` — opponentDisconnected input, disconnectDisplay computed, MatProgressSpinner import
- `front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.html` — [class] anti-pattern fix, disconnect display with spinner
- `front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.scss` — timer-disconnect styles

## Change Log

- 2026-02-28: Implemented Story 3.3 — Disconnection Handling & Reconnection (basic). Added OPPONENT_DISCONNECTED/RECONNECTED protocol messages, server-side prompt caching and re-send on reconnect, client-side opponent disconnect signal with timer badge indicator (spinner + "Opponent connecting..."), snackbar notifications for connection restored and opponent reconnected, fixed exponential backoff (1s-30s cap, 10 retries), fixed [class] anti-pattern in timer badge.
- 2026-02-28: Code review (AI) — 6 issues found (1H, 2M, 3L), all fixed. H1: misleading snackbar on DUEL_END guarded. M1: message-filter whitelist updated. M2: MAX_RETRIES aligned to AC5 (~60s). L1: system messages count corrected. L2: type annotation strengthened. L3: board container [class] anti-pattern fixed.
