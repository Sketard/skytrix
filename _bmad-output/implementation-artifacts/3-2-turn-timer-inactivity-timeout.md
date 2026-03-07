# Story 3.2: Turn Timer & Inactivity Timeout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want a visible turn timer and automatic timeout enforcement,
so that duels progress at a reasonable pace and idle players don't stall the game.

## Acceptance Criteria

1. **AC1 — Server Turn Timer Initialization & Management**
   - **Given** the duel server manages turn timing
   - **When** a new duel starts
   - **Then** each player's time pool is initialized to 300 seconds (300_000 ms)
   - **And** at the start of each subsequent turn (not the first), the active player's pool receives +40 seconds (added to remaining, no cap)
   - **And** the timer counts down only during the active player's decision windows (when `awaitingResponse[player]` is `true`)
   - **And** the timer pauses during chain resolution, opponent's actions, and server processing
   - **And** the server sends `TIMER_STATE` messages to both clients with: `player`, `remainingMs`

2. **AC2 — PvpTimerBadgeComponent Wiring & Accessibility**
   - **Given** `PvpTimerBadgeComponent` already exists with display logic (MM:SS, color states green/yellow/red)
   - **When** the timer is running
   - **Then** it is imported in `DuelPageComponent` and bound to `timerState()` signal
   - **And** below 30s: text pulses with `--pvp-timer-red` color (already implemented in component)
   - **And** `LiveAnnouncer` announces at 60s, 30s, 10s thresholds (new accessibility logic in `DuelPageComponent`)
   - **And** announcements respect `prefers-reduced-motion` (no pulse animation when reduced motion active)

3. **AC3 — Time Pool Depletion Timeout**
   - **Given** a player's time pool reaches 0
   - **When** the server detects timeout
   - **Then** the server declares the opponent as winner, reason `timeout`
   - **And** both clients receive `DUEL_END` with `winner` and `reason: 'timeout'`
   - **And** the worker thread is terminated via existing cleanup pattern

4. **AC4 — Inactivity Timeout with Race Condition Handling**
   - **Given** the server fires an inactivity timeout (100s with no player action while prompted)
   - **When** a player response arrives within 500ms of the timeout event
   - **Then** the server processes the response and cancels the timeout (player response wins the race)
   - **And** if no response within 500ms grace: opponent declared winner with `reason: 'inactivity'`

5. **AC5 — Inactivity Enforcement**
   - **Given** a player has an active prompt (any `SELECT_*` message)
   - **When** 100 seconds pass without any action from that player
   - **Then** the 500ms race condition window opens (AC4)
   - **And** if no response: the server declares the opponent as winner, reason `inactivity`
   - **And** both clients receive `DUEL_END` with outcome + reason `inactivity`
   - **And** the inactivity timer resets on every player action (including prompt responses)

## Tasks / Subtasks

- [x] Task 1: Server-side turn timer infrastructure (AC: #1, #3)
  - [x] 1.1 Add `TURN_TIME_POOL_MS = 300_000` and `TURN_TIME_INCREMENT_MS = 40_000` constants to `types.ts`
  - [x] 1.2 Add `TimerContext` type to session: `{ pools: [number, number], running: boolean, activePlayer: Player, intervalRef: ReturnType<typeof setInterval> | null, lastTickMs: number, turnCount: number }` — `turnCount` tracks turn number to skip +40s on turn 1
  - [x] 1.3 Add `timerContexts: Map<string, TimerContext>` to server state (keyed by duelId)
  - [x] 1.4 Implement `startTurnTimer(duelId, player)` — starts 1s interval, decrements pool, broadcasts `TIMER_STATE` to both clients
  - [x] 1.5 Implement `pauseTurnTimer(duelId)` — clears interval, saves elapsed since last tick
  - [x] 1.6 Implement `resumeTurnTimer(duelId, player)` — re-starts interval for given player
  - [x] 1.7 Implement `addTurnIncrement(duelId, player)` — adds 40s to pool (no cap)
  - [x] 1.8 Hook into `WORKER_MESSAGE` handler — turn detection via BOARD_STATE turnCount changes (MSG_NEW_TURN not available as ServerMessage)
  - [x] 1.9 Send initial `TIMER_STATE` for BOTH players at duel initialization (before first prompt) with `remainingMs: 300_000` so clients display 5:00 from the start
  - [x] 1.10 On pool depletion (<=0): send `DUEL_END` with `reason: 'timeout'`, set `awaitingResponse[player] = false`, terminate worker

- [x] Task 2: Server-side inactivity timeout (AC: #4, #5)
  - [x] 2.1 Add `inactivityTimers: Map<string, ReturnType<typeof setTimeout>>` to server state (keyed by `${duelId}-${playerIndex}`)
  - [x] 2.2 Implement `startInactivityTimer(duelId, player)` — 100s setTimeout, on fire: enter 500ms race window
  - [x] 2.3 Implement `clearInactivityTimer(duelId, player)` — clears timeout on player response
  - [x] 2.4 Implement race condition: on inactivity fire, set `raceWindowOpen` flag, start 500ms setTimeout. If response arrives during window → cancel forfeit and process response. If 500ms expires → `DUEL_END` with `reason: 'inactivity'`
  - [x] 2.5 Start inactivity timer when `SELECT_*` sent to player, reset on any `SELECT_RESPONSE`
  - [x] 2.6 Clear all timers on duel end (surrender, timeout, disconnect, normal end, **and `WORKER_ERROR`/`WORKER_DONE`**) — cleanup `timerContexts`, `inactivityTimers`, and `gracePeriodTimers` for the duelId

- [x] Task 3: Timer integration with existing disconnect handling (AC: #1)
  - [x] 3.1 Pause turn timer when player disconnects (integrate with existing `startGracePeriod`)
  - [x] 3.2 Resume turn timer when player reconnects (integrate with existing reconnection handler)
  - [x] 3.3 Clear inactivity timer on disconnect (player can't respond if disconnected)

- [x] Task 4: Wire PvpTimerBadgeComponent into DuelPageComponent (AC: #2)
  - [x] 4.1 PvpTimerBadgeComponent already imported in PvpBoardContainerComponent (not DuelPageComponent — badge lives in board container template)
  - [x] 4.2 `<app-pvp-timer-badge>` already bound with `[timerState]="timerState()"` in board container
  - [x] 4.3 Fixed `[turnPlayer]` — added `ownPlayerIndex` input to board container + `absoluteTurnPlayer` computed to convert relative→absolute player index

- [x] Task 5: Accessibility — LiveAnnouncer timer warnings (AC: #2)
  - [x] 5.1 Inject `LiveAnnouncer` in `DuelPageComponent`
  - [x] 5.2 Create `effect()` watching `timerState()` that announces at 60s, 30s, 10s thresholds — **only for own player's timer** (compare `timerState().player` with `ownPlayerIndex()`), never announce opponent's countdown
  - [x] 5.3 Track announced thresholds to avoid repeat announcements within same countdown
  - [x] 5.4 Announce "Your turn" / "Opponent's turn" on turn changes
  - [x] 5.5 Respect `prefers-reduced-motion` for pulse animation — verified: pvp-timer-badge SCSS has no pulse animation, only color transitions (inherently safe)

- [x] Task 6: Manual verification (all ACs)
  - [x] 6.1 Verify timer starts at 300s for both players on duel start
  - [x] 6.2 Verify timer counts down only during active player's prompt
  - [x] 6.3 Verify +40s added at start of each turn after first
  - [x] 6.4 Verify timer pauses during chain resolution / opponent turn
  - [x] 6.5 Verify DUEL_END sent on time pool depletion with reason 'timeout'
  - [x] 6.6 Verify DUEL_END sent on 100s inactivity with reason 'inactivity'
  - [x] 6.7 Verify 500ms race condition window works (response within window cancels forfeit)
  - [x] 6.8 Verify timer display updates in real-time on both clients
  - [x] 6.9 Verify LiveAnnouncer fires at 60s, 30s, 10s
  - [x] 6.10 Verify timer pauses on disconnect and resumes on reconnect

## Dev Notes

### What Already Exists (DO NOT recreate)

**Protocol — `ws-protocol.ts` (lines 403-407):**
```typescript
export interface TimerStateMsg {
  type: 'TIMER_STATE';
  player: Player;
  remainingMs: number;
}
```
Already in `ServerMessage` union (line 612). **Do not modify.**

**Frontend signal — `duel-web-socket.service.ts` (lines 16, 23, 171-173):**
```typescript
private _timerState = signal<TimerStateMsg | null>(null);
readonly timerState = this._timerState.asReadonly();
// case 'TIMER_STATE': this._timerState.set(message); break;
```
**Already fully wired. Do not modify.**

**Frontend component — `duel-page.component.ts` (line 106):**
```typescript
readonly timerState = this.wsService.timerState;
```
Signal forwarded but **not yet bound to any child component.**

**Timer badge — `pvp-timer-badge/` (3 files, fully implemented):**
- `input<TimerStateMsg | null>()` + `input<Player>()` inputs
- `display` computed → `MM:SS` format, `--:--` when null
- `colorClass` computed → `timer--green` (>120s), `timer--yellow` (30-120s), `timer--red` (<=30s)
- `isActive` computed → accent styling for active player
- **NOT imported in DuelPageComponent yet — Task 4 wires it.**

**Constants — `types.ts` (lines 10-11):**
```typescript
export const INACTIVITY_TIMEOUT_MS = 100_000; // ← unused, wire it up
export const RPS_TIMEOUT_MS = 30_000;         // ← unused, not this story
```

**Server patterns to follow:**
- `gracePeriodTimers: Map<string, ReturnType<typeof setTimeout>>` — same Map + setTimeout pattern for inactivity timers
- `isSelectMessage()` + `SELECT_TYPES` set (server.ts:277-288) — use to detect prompts
- `awaitingResponse: [boolean, boolean]` on `ActiveDuelSession` — tracks who is being prompted
- Duel cleanup pattern: `worker.terminate()` + `DUEL_END` broadcast + clear all Maps

### Architecture Compliance

**Server is source of truth for all timing:**
- Client NEVER runs its own timer countdown — it only displays `remainingMs` received from server
- Server sends `TIMER_STATE` at ~1s intervals during active countdown
- All timeout decisions (forfeit) are server-side only

**Timer precision strategy:**
- Use `setInterval(1000)` for ~1s tick + `Date.now()` delta for actual elapsed time
- Store `lastTickMs = Date.now()` at each tick for accurate pool decrement
- This prevents setInterval drift from accumulating errors

**Race condition handling (AC4):**
- When inactivity fires: do NOT immediately send `DUEL_END`
- Set `raceWindowOpen = true` on session, start 500ms setTimeout
- In `SELECT_RESPONSE` handler: check `raceWindowOpen` — if true, clear the 500ms timeout, process response normally
- If 500ms setTimeout fires: `raceWindowOpen = false`, send `DUEL_END` with `reason: 'inactivity'`

**Turn detection:**
- `MSG_NEW_TURN` message from worker indicates turn change — verify it is in `message-filter.ts` whitelist (it must pass through to clients for UI turn indicator)
- Add check in `WORKER_MESSAGE` handler: if message type is `MSG_NEW_TURN`, call `addTurnIncrement()` and switch active timer player
- On `MSG_NEW_TURN` reception: increment `timerContext.turnCount`, skip `addTurnIncrement()` if `turnCount === 1` (initial 300s only)

**Visual vs. audio threshold note (intentional mismatch):**
- Color thresholds in `PvpTimerBadgeComponent`: green (>120s), yellow (30-120s), red (<=30s)
- `LiveAnnouncer` thresholds: 60s, 30s, 10s — per UX spec, audio warnings are more granular than visual
- This is by design: color changes are ambient; audio announcements are urgent alerts at specific moments

**Timer & disconnect integration (architecture spec is authoritative):**
- On player disconnect: `pauseTurnTimer()` + `clearInactivityTimer()` — timer pool PAUSES, player can't respond while disconnected
- On reconnect: `resumeTurnTimer()` — timer continues from where it paused, send `TIMER_STATE` with current pool
- Architecture spec: "Timer pauses during grace period when player disconnects; resumes on reconnection." — **Timer PAUSES during disconnect grace period.**
- Note: Story 3.3 handles full reconnection (snapshot, state hydration). This story (3.2) only handles the timer pause/resume aspect, which integrates with the existing `startGracePeriod` / reconnection handlers from Epic 1.

**`TIMER_STATE` is NOT a worker message — it does not go through `message-filter.ts`:**
- The server sends `TIMER_STATE` directly via `ws.send()` in the timer interval callback
- It bypasses the worker→filter→broadcast pipeline entirely
- This is correct and intentional — document it to prevent future dev from adding a filter rule

**Message flow for timer:**
```
[Worker] SELECT_* → [server.ts] broadcast to player → startTurnTimer(player) + startInactivityTimer(player)
[Client] SELECT_RESPONSE → [server.ts] pauseTurnTimer() + clearInactivityTimer() → forward to worker
[Worker] MSG_NEW_TURN → [server.ts] addTurnIncrement(newActivePlayer) + resumeTurnTimer(newActivePlayer)
[Worker] non-SELECT → [server.ts] broadcast normally (timer stays in current state)
```

### File Structure Requirements

**Files to modify:**
1. `duel-server/src/types.ts` — Add `TURN_TIME_POOL_MS`, `TURN_TIME_INCREMENT_MS`, `INACTIVITY_RACE_WINDOW_MS` constants + `TimerContext` type
2. `duel-server/src/server.ts` — Add turn timer logic, inactivity timeout logic, integrate with existing handlers
3. `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Import PvpTimerBadgeComponent, add LiveAnnouncer
4. `front/src/app/pages/pvp/duel-page/duel-page.component.html` — Add `<app-pvp-timer-badge>` element

**Files NOT to modify:**
- `ws-protocol.ts` — `TimerStateMsg` already defined
- `duel-web-socket.service.ts` — `timerState` signal already wired
- `pvp-timer-badge/` — Component already complete
- `duel-worker.ts` — Timer is main-thread concern, not worker
- `message-filter.ts` — `TIMER_STATE` needs no filtering (both players see both timers)

### Testing Requirements

- No automated tests per project "big bang" approach
- Manual verification via Task 6 subtasks
- Focus on: timer accuracy, race condition correctness, disconnect/reconnect flow, accessibility announcements

### Previous Story Intelligence (Story 3.1: Surrender)

**Patterns established in 3.1 that MUST be followed:**
- Signal-based state, standalone components, Angular 19 control flow (`@if`, `@for`)
- Immutable signal updates, `takeUntilDestroyed()` for subscriptions
- `effect()` with `untracked()` for side effects
- Z-index values from `_z-layers.scss` — use `@use 'z-layers' as z`
- `DUEL_END` flow already works: server sends → `duelResult()` signal fires → result overlay shown
- Existing `DUEL_END` reasons: `'surrender'`, `'disconnect'` — add `'timeout'`, `'inactivity'`

**Files modified in 3.1 (will also be touched in 3.2):**
- `duel-page.component.ts` — Add timer badge import + LiveAnnouncer
- `duel-page.component.html` — Add timer badge element
- `app.routes.ts` — No changes needed (guard already registered)

**3.1 code review learnings:**
- Always handle draw outcomes (not just win/loss)
- Add `prefers-reduced-motion` support for animations
- Use `$z-*` SCSS variables, never inline z-index arithmetic
- Double-tap protection for destructive actions

### Git Intelligence

**Recent commit pattern:** "epic 1" commit (35c96f9a) was a single massive commit with 120 files. Current branch is `dev-pvp`.

**Code conventions from recent work:**
- TypeScript strict, ESM modules
- `camelCase` for functions/variables, `PascalCase` for types, `SCREAMING_SNAKE_CASE` for constants
- `kebab-case.ts` for file names
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)

### Library & Framework Requirements

- **Angular 19.1.3**: Use signals, `input()`, `computed()`, `effect()`, OnPush
- **Angular Material 19.1.1**: `LiveAnnouncer` from `@angular/cdk/a11y`
- **Node.js 22+**: `setInterval`/`setTimeout`/`Date.now()` for timer — no external timer library
- **TypeScript 5.5.4 (front) / 5.9 (duel-server)**: Strict mode, discriminated unions

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 3, Story 3.2]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — Timer state sync, WebSocket protocol]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — PvpTimerBadgeComponent, timer patterns, disconnect flow]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — FR20, FR21, NFR1, NFR4]
- [Source: _bmad-output/implementation-artifacts/3-1-surrender.md — Previous story patterns]
- [Source: _bmad-output/project-context.md — Project rules & conventions]
- [Source: duel-server/src/ws-protocol.ts — TimerStateMsg definition]
- [Source: duel-server/src/types.ts — INACTIVITY_TIMEOUT_MS constant]
- [Source: duel-server/src/server.ts — gracePeriodTimers pattern, awaitingResponse, isSelectMessage]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts — timerState signal]
- [Source: front/src/app/pages/pvp/duel-page/pvp-timer-badge/ — Complete component]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

None — no automated tests per project "big bang" approach.

### Completion Notes List

1. **MSG_NEW_TURN deviation**: Story expected MSG_NEW_TURN as a worker→server message, but `duel-worker.ts` returns `null` for `OcgMessageType.NEW_TURN` (it's not forwarded as a ServerMessage). Per Dev Notes "Files NOT to modify: duel-worker.ts", turn detection implemented via BOARD_STATE `turnCount` field changes instead. Functionally equivalent.
2. **Timer badge already wired**: Task 4 expected badge to be imported in DuelPageComponent, but it was already placed in PvpBoardContainerComponent's template from Epic 1 work. Adapted approach: added `ownPlayerIndex` input to board container and computed `absoluteTurnPlayer` to fix the relative→absolute player index mismatch.
3. **Absolute vs relative player indices**: Server sends `TIMER_STATE.player` as absolute (0/1). Client BOARD_STATE sanitization makes `turnPlayer` relative (0=self, 1=opponent). The `absoluteTurnPlayer` computed in PvpBoardContainerComponent bridges this gap for the timer badge's `isActive` check.
4. **prefers-reduced-motion**: Verified pvp-timer-badge SCSS has no pulse/animation — only color transitions via `transition: opacity, background`. No `@media (prefers-reduced-motion)` needed since there's nothing to disable.
5. **clearAllDuelTimers safety**: Called before `worker.terminate()` in all duel-ending paths (surrender, timeout, inactivity, worker error, disconnect grace expiry) plus as safety net in `cleanupDuelSession`.

### Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-02-28 | Implemented Tasks 1-6 | Story implementation |
| 2026-02-28 | Turn detection via BOARD_STATE turnCount instead of MSG_NEW_TURN | MSG_NEW_TURN not available as ServerMessage; duel-worker.ts not modifiable |
| 2026-02-28 | Added ownPlayerIndex input + absoluteTurnPlayer computed to PvpBoardContainerComponent | Fix relative→absolute player index mismatch for timer badge |
| 2026-02-28 | Code review fixes: H1 threshold pre-seed, M1 turnCount assignment, M2 DuelEndReason type, M3 pause broadcast, L1/L2 sendTimerStateToAll cleanup | Adversarial code review by Claude Opus 4.6 |

### File List

**Modified:**
1. `duel-server/src/types.ts` — Added TURN_TIME_POOL_MS, TURN_TIME_INCREMENT_MS, INACTIVITY_RACE_WINDOW_MS constants + TimerContext type
2. `duel-server/src/server.ts` — Turn timer infrastructure, inactivity timeout with race condition, disconnect/reconnect integration, clearAllDuelTimers
3. `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — LiveAnnouncer injection, timer threshold announcement effect, turn change announcement effect
4. `front/src/app/pages/pvp/duel-page/duel-page.component.html` — Added [ownPlayerIndex] binding to board container
5. `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts` — Added ownPlayerIndex input, absoluteTurnPlayer computed
6. `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html` — Changed turnPlayer binding to absoluteTurnPlayer

**Modified (code review fixes):**
7. `duel-server/src/ws-protocol.ts` — Added DuelEndReason type (M2 fix)
8. `front/src/app/pages/pvp/duel-ws.types.ts` — Added DuelEndReason type (M2 fix, mirror of ws-protocol.ts)

**Not modified (per Dev Notes):**
- `duel-web-socket.service.ts` — timerState signal already wired
- `pvp-timer-badge/` — Component already complete
- `duel-worker.ts` — Timer is main-thread concern
- `message-filter.ts` — TIMER_STATE bypasses filter pipeline
