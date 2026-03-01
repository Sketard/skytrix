# Story 5.2: Reconnection Edge Cases

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->
<!-- Technical debt source: Epic 3 Story 3-3 scope reduction (3-3b) — BroadcastChannel, visibilitychange, dual disconnect -->

## Story

As a player,
I want robust reconnection handling for edge cases (multi-tab, background tab, simultaneous disconnection),
So that duels survive unusual but realistic network and browser scenarios.

## Acceptance Criteria

### AC1: Single-Tab Enforcement via BroadcastChannel

**Given** the player has the duel open in multiple browser tabs (BroadcastChannel scenario)
**When** both tabs attempt to reconnect simultaneously
**Then** only one tab successfully reconnects, the other receives a clear "session active in another tab" message
**And** the duel continues normally in the active tab

**Implementation detail (from UX spec):**
- **Primary:** `BroadcastChannel` API for inter-tab communication
- **Fallback:** `localStorage` `storage` event listener (Safari < 15.4, WebViews)
- Newest tab takes control (last session active wins)
- Previous tab displays overlay: "Duel active in another tab" + button "Take control here"
- No simultaneous duel in two tabs — one interactive session at a time

### AC2: Background Tab Recovery via visibilitychange

**Given** the player's browser tab goes to background (visibilitychange)
**When** the tab becomes visible again after a brief background period (< 60s)
**Then** the WebSocket connection is verified and reconnected if needed
**And** the board state is re-synced via `STATE_SYNC` message (animation queue is cleared — existing behavior in `duel-web-socket.service.ts:163`)
**And** if prompts were auto-resolved during absence: display snackbar "N actions were auto-resolved while away"
**And** if a prompt is currently pending: display immediately (skip Beat 1 — direct render to save time)

### AC3: Simultaneous Disconnection Handling

**Given** both players disconnect simultaneously
**When** both players reconnect within the 60-second grace period
**Then** the duel resumes normally for both players
**And** if neither reconnects within 60s, the duel is ended with `reason: 'draw_both_disconnect'` (distinct from OCGCore native `'draw'` for simultaneous LP=0 — different reason string for result screen messaging)
**And** duel state is preserved server-side for up to 4 hours before automatic cleanup (NFR5)

### AC4: Accessibility

**Given** any reconnection edge case occurs
**When** the user has a screen reader active
**Then** LiveAnnouncer announces connection state changes ("Connection restored", "Duel active in another tab", "N actions were auto-resolved")
**And** the "Take control here" button in the blocked-tab overlay is keyboard-accessible (focusable, Enter/Space activates)
**And** any new animations respect `prefers-reduced-motion` (CSS, rAF, setTimeout — expanded checklist per Epic 4 retro)

## Tasks / Subtasks

**Task dependency order:** Task 1 (server) → Task 2 (client BroadcastChannel) → Task 3 (visibilitychange) → Task 4 (server dual disconnect). Tasks 2-4 are largely independent after Task 1 server changes. Task 5 (manual verification) depends on all.

- [x] Task 1: Server — Both-disconnect grace period + 4-hour session preservation (AC: #3)
  - [x] 1.1 In `duel-server/src/server.ts`, modify `startGracePeriod()`: when the second player disconnects (both `session.players[0].connected === false && session.players[1].connected === false`), cancel BOTH individual grace timers and start a single combined grace timer (60s from the LATER disconnect timestamp)
  - [x] 1.2 On combined grace expiry: if NEITHER player has reconnected → send `DUEL_END` with `reason: 'draw_both_disconnect'` to any reconnecting player later (store result in session) and call `handleDuelEnd(session)`. Do NOT terminate worker immediately — preserve for 4h
  - [x] 1.3 Add `BOTH_DISCONNECTED_CLEANUP_MS = 4 * 60 * 60 * 1000` (4 hours) constant in `types.ts`
  - [x] 1.4 When both players disconnect, start a 4-hour cleanup timer (`session.preservationTimer`). On expiry: `cleanupDuelSession(session)` + `session.worker.terminate()`
  - [x] 1.5 If any player reconnects during the 4h window (after grace expired, duel already ended): send the stored `DUEL_END` result so the client knows the outcome, then cleanup
  - [x] 1.6 Add fields to the inline `ActiveDuelSession` in `server.ts`: `preservationTimer: ReturnType<typeof setTimeout> | null`, `bothDisconnected: boolean` (flag for combined grace mode), `combinedGraceTimer: ReturnType<typeof setTimeout> | null`, `storedDuelResult: ServerMessage | null` (for late reconnectors), `lastStateSyncAt: [number, number]` (rate-limit per player). Clear all in `cleanupDuelSession()`
  - [x] 1.7 When first player reconnects during the combined grace period: cancel combined timer, restart individual grace timer for the still-disconnected player. Resume turn timer + re-send cached prompt to the reconnected player (existing logic)

- [x] Task 2: Frontend — Single-Tab Enforcement via BroadcastChannel (AC: #1, #4)
  - [x] 2.1 Create `front/src/app/pages/pvp/duel-page/duel-tab-guard.service.ts` — injectable service scoped to `DuelPageComponent` (provided in component `providers` array)
  - [x] 2.2 Implement BroadcastChannel-based tab detection:
    - On init: create `BroadcastChannel('skytrix-pvp-duel')`
    - Broadcast `{ type: 'TAB_ACTIVE', tabId: crypto.randomUUID(), roomId }` on WebSocket connect
    - Listen for incoming `TAB_ACTIVE` messages: if `roomId` matches AND `tabId` differs → this tab is superseded
    - Expose `readonly isBlocked = signal(false)` — set `true` when superseded
  - [x] 2.3 Implement `localStorage` fallback for browsers without BroadcastChannel:
    - Key: `skytrix-pvp-active-tab-${roomId}`
    - Value: `{ tabId, timestamp }`
    - Listen to `window.storage` event for cross-tab updates
    - Same logic: newest tab wins, older tab blocked
  - [x] 2.4 In `DuelPageComponent`, inject `DuelTabGuardService`. When `isBlocked()` becomes `true`:
    - Display a full-screen overlay: "Duel active in another tab" (centered text)
    - Button: "Take control here" → calls `tabGuard.takeControl()` which re-broadcasts `TAB_ACTIVE` with new timestamp
    - WebSocket is NOT closed on blocked tab — just UI overlay + prompts suppressed
    - LiveAnnouncer: "Duel active in another tab"
  - [x] 2.5 Cleanup: close BroadcastChannel + remove localStorage listener on service destroy
  - [x] 2.6 Button accessibility: `mat-raised-button`, auto-focused via `cdkFocusInitial` or manual `focus()`, keyboard-accessible

- [x] Task 3: Frontend — Background Tab Recovery via visibilitychange (AC: #2, #4)
  - [x] 3.1 In `DuelPageComponent`, add `visibilitychange` event listener (registered in constructor, removed on destroy):
    - On `document.hidden === false` (tab becomes visible):
      1. Check `wsService.connectionStatus()` — if NOT `'connected'`, let existing reconnect logic handle it (no duplicate attempt)
      2. If connected: send `{ type: 'REQUEST_STATE_SYNC' }` via WebSocket to request fresh board state
      3. Track `lastVisibilityHiddenAt: number` timestamp when tab goes hidden
  - [x] 3.2 In `duel-server/src/server.ts`, add handler for `REQUEST_STATE_SYNC` client message:
    - Validate player is connected
    - Send `STATE_SYNC` (full board state snapshot for that player, filtered via message filter) + `TIMER_STATE`
    - Send current pending prompt if `awaitingResponse[player]` is true (re-send `lastSentPrompt[player]`)
    - Lightweight: no grace period changes, no timer changes, just a data refresh
    - **Rate-limit:** Max 1 `REQUEST_STATE_SYNC` per 5 seconds per session — track `lastStateSyncAt` timestamp on the session. Ignore (silently drop) if throttled. Prevents spam vector from malicious clients
    - **DRY:** Extract the snapshot-sending logic from the reconnection handler (server.ts lines ~730-760) into a reusable `sendStateSnapshot(session, playerIndex)` function. Both reconnection and `REQUEST_STATE_SYNC` should call this function
  - [x] 3.3 Add `RequestStateSyncMsg` to ws-protocol.ts: `{ type: 'REQUEST_STATE_SYNC' }` as a `ClientMessage`
  - [x] 3.4 Mirror in `duel-ws.types.ts`
  - [x] 3.5 Auto-resolved snackbar: if server sends a `STATE_SYNC` and the `turnCount` or `phase` has advanced since client's last known state → display snackbar "Actions were auto-resolved while away" (3s auto-dismiss). **Implementation note:** Store `lastKnownTurnCount` as a plain `number` variable (NOT a signal) before STATE_SYNC arrives. Compare in the STATE_SYNC handler — signals update atomically so you must capture the pre-update value in a local variable before `.set()` overwrites it
  - [x] 3.6 Skip Beat 1 on re-presented prompts: in `DuelPageComponent`, track a `returningFromBackground` flag. When `visibilitychange` fires (hidden→visible) + a pending prompt is (re-)received within 500ms → skip the `MSG_HINT` Beat 1 delay and render prompt immediately
  - [x] 3.7 LiveAnnouncer: "Board state refreshed" on successful STATE_SYNC after background recovery

- [x] Task 4: Protocol — Add new message types (AC: #1, #2, #3)
  - [x] 4.1 In `duel-server/src/ws-protocol.ts`:
    - Add `RequestStateSyncMsg`: `{ type: 'REQUEST_STATE_SYNC' }` to `ClientMessage` union
    - No new server messages needed — existing `STATE_SYNC`, `DUEL_END` cover responses
  - [x] 4.2 Mirror in `front/src/app/pages/pvp/duel-ws.types.ts`
  - [x] 4.3 In `duel-server/src/message-filter.ts`: no changes needed — `REQUEST_STATE_SYNC` is a client→server message, not filtered
  - [x] 4.4 Add `'draw_both_disconnect'` to the `DuelEndReason` type (or use existing `'draw'` with extended reason string if already a string union)

- [x] Task 5: Frontend — Connection Status & DuelPage Integration (AC: #2, #3, #4)
  - [x] 5.1 In `duel-page.component.ts`, map `draw_both_disconnect` reason in `mapDuelEndReason()`: display "Both players disconnected"
  - [x] 5.2 Add `@if (tabGuard.isBlocked())` overlay in `duel-page.component.html` — full-viewport overlay with z-index above everything (z-index 400, above prompt sheet at 300)
  - [x] 5.3 Overlay SCSS: use `--pvp-*` design tokens for background, text color, button styling. `prefers-reduced-motion` for entrance animation (fade in)
  - [x] 5.4 LiveAnnouncer calls for all state transitions: "Connection restored", "Board state refreshed", "Duel active in another tab", "Actions were auto-resolved while away"

- [ ] Task 6: Manual Verification (all ACs)
  - [ ] 6.1 Verify: open duel in 2 tabs → second tab shows "Duel active in another tab" overlay
  - [ ] 6.2 Verify: click "Take control here" on blocked tab → that tab takes over, previous tab shows overlay
  - [ ] 6.3 Verify: switch tab to background → return → board state refreshes (STATE_SYNC received)
  - [ ] 6.4 Verify: switch tab to background for >5s → return → if actions auto-resolved, snackbar shown
  - [ ] 6.5 Verify: disconnect both players (close both WS connections) → reconnect one within 60s → duel resumes
  - [ ] 6.6 Verify: disconnect both players → neither reconnects within 60s → duel ends as draw
  - [ ] 6.7 Verify: disconnect both players → both reconnect within 60s → duel resumes normally
  - [ ] 6.8 Verify: BroadcastChannel not available (simulate) → localStorage fallback works
  - [ ] 6.9 Verify: "Take control here" button keyboard-accessible (Tab, Enter/Space)
  - [ ] 6.10 Verify: prefers-reduced-motion → overlay fade-in instant (0ms)
  - [ ] 6.11 Verify: SCSS budget not exceeded after changes
  - [ ] 6.12 Verify: LiveAnnouncer fires for all connection state transitions

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring bug caught in Epics 1-3).
- **`effect()` with `untracked()`**: For all side effects (navigation, HTTP calls, animation triggering).
- **TypeScript strict**: `strict: true`, `noImplicitReturns`, single quotes, 2-space indent, trailing comma es5.
- **Naming**: `camelCase` functions/variables, `PascalCase` types, `SCREAMING_SNAKE_CASE` constants, `kebab-case.ts` files.
- **DRY KISS**: Minimal code, no over-engineering (Axel directive from Epic 3 retro — maintained through Epic 5).
- **No new dependencies**: Angular Material, CDK, standard CSS only. BroadcastChannel + localStorage are native Web APIs.
- **prefers-reduced-motion**: Verify on ALL animated elements — expanded checklist covers CSS `@keyframes`, `requestAnimationFrame`, `setTimeout`-based animations (per Epic 4 retro action item).
- **Token compliance**: All colors via `var(--pvp-*)` design tokens, all durations via SCSS tokens. Zero hardcoded values (per Epic 4 retro action item).

### Critical: What Already Exists (DO NOT Recreate)

| Feature | Location | Status |
|---------|----------|--------|
| `ConnectionStatus` type | `front/src/app/pages/pvp/types/connection-status.types.ts` | Exists — `'connected' \| 'reconnecting' \| 'lost'` |
| `DuelWebSocketService` | `duel-page/duel-web-socket.service.ts` | Exists — reconnect with exponential backoff (1s-30s, 6 retries), `reconnectToken`, `connectionStatus` signal, `opponentDisconnected` signal |
| `STATE_SYNC` handling | `duel-web-socket.service.ts:160-165` | Exists — hydrates `_duelState`, clears chain links + animation queue |
| Opponent disconnect/reconnect signals | `duel-web-socket.service.ts:243-249` | Exists — `OPPONENT_DISCONNECTED` → `true`, `OPPONENT_RECONNECTED` → `false` |
| Connection snackbar effects | `duel-page.component.ts:493-514` | Exists — "Connection restored" on reconnect, "Opponent reconnected" on opponent return |
| `PvpTimerBadgeComponent` opponent indicator | `pvp-timer-badge.component.ts:41-43` | Exists — "Opponent connecting..." text + spinner |
| Server grace period (60s) | `duel-server/src/server.ts:818-837` | Exists — per-player grace timer, forfeit on expiry |
| Server reconnection handler | `duel-server/src/server.ts:674-770` | Exists — token validation, timer resume, prompt re-send, opponent notification |
| Server disconnect handler | `duel-server/src/server.ts:790-815` | Exists — mark disconnected, pause timer, notify opponent, start grace |
| `lastSentPrompt` caching | `duel-server/src/server.ts:32,366-369` | Exists — cached on SELECT_* forward, cleared on PLAYER_RESPONSE, re-sent on reconnect |
| `RECONNECT_GRACE_MS = 60_000` | `duel-server/src/types.ts:9` | Exists — 60s constant |
| `cleanupDuelSession()` | `duel-server/src/server.ts:596-640` | Exists — clears all timers, removes tokens, deletes from map |
| Message filter (whitelist) | `duel-server/src/message-filter.ts:129-130` | Exists — OPPONENT_DISCONNECTED/RECONNECTED in passthrough |
| `sendToPlayer()` utility | `duel-server/src/server.ts` | Exists — sends filtered message only if player connected |

### Critical: What Does NOT Exist Yet (Story 5.2 Scope)

| Feature | Where to Add | Why |
|---------|-------------|-----|
| `DuelTabGuardService` | `duel-page/duel-tab-guard.service.ts` | **NEW** — BroadcastChannel + localStorage tab detection |
| `REQUEST_STATE_SYNC` client message | `ws-protocol.ts` + `duel-ws.types.ts` | Client-initiated state refresh after background tab recovery |
| `REQUEST_STATE_SYNC` handler | `duel-server/src/server.ts` | Server sends STATE_SYNC + TIMER_STATE + pending prompt on request |
| Both-disconnect combined grace period | `duel-server/src/server.ts` | Server has per-player grace only, no combined handling |
| 4-hour session preservation timer | `duel-server/src/server.ts` + `types.ts` | Sessions cleaned up immediately on grace expiry, not preserved |
| `preservationTimer` on session | `duel-server/src/server.ts` (inline type) | Track 4h cleanup timer |
| `draw_both_disconnect` reason | `ws-protocol.ts` + `duel-ws.types.ts` | New duel end reason for both-disconnect expiry |
| `visibilitychange` listener | `duel-page.component.ts` | Background tab detection + state refresh request |
| Blocked-tab overlay | `duel-page.component.html` + `.scss` | "Duel active in another tab" + "Take control here" |
| Auto-resolved snackbar | `duel-page.component.ts` | "Actions were auto-resolved while away" |
| `returningFromBackground` flag | `duel-page.component.ts` | Skip Beat 1 delay for re-presented prompts |

### Critical: Interaction Between Edge Cases

**BroadcastChannel vs WebSocket reconnection:**
- BroadcastChannel enforcement is CLIENT-SIDE ONLY — the server doesn't know about multiple tabs
- The server's reconnect token system naturally prevents concurrent connections: a new connection invalidates the old token (line 690 in server.ts)
- If two tabs race to reconnect, the server accepts the first one (token consumed) and the second fails (invalid token). The BroadcastChannel prevents this race by blocking the older tab BEFORE it attempts WebSocket reconnection
- Edge case: if BroadcastChannel message is delayed and both tabs attempt WS connection, the server's token invalidation is the safety net

**visibilitychange vs reconnection:**
- Tab goes to background → `hidden = true` (just record timestamp)
- Tab comes back → `hidden = false`:
  - IF WebSocket is still connected → send `REQUEST_STATE_SYNC` to refresh data
  - IF WebSocket is disconnected → existing reconnect logic handles it (exponential backoff already running)
  - Do NOT duplicate reconnection attempts — check `connectionStatus` first

**Both-disconnect vs individual disconnect:**
- Player A disconnects → server starts grace timer A (60s)
- Player B disconnects → server detects both disconnected → cancel timer A, start combined timer (60s from B's disconnect)
- Player A reconnects within combined window → cancel combined timer, start individual timer for B (remaining time)
- Neither reconnects within 60s → duel ended as draw, 4h preservation starts
- Player reconnects during 4h window → receive stored DUEL_END result

### Critical: Z-Index Compliance

Per UX spec z-index hierarchy:
- Blocked-tab overlay: z-index 400 (ABOVE everything — must cover prompts + inspector)
- PvpPromptSheetComponent: z-index 300
- CardInspectorComponent: z-index 150
- Use `_z-layers.scss` tokens if available, otherwise define `--pvp-blocked-tab-z: 400`

### Critical: BroadcastChannel API Compatibility

- **Chrome 54+**: Full support
- **Firefox 38+**: Full support
- **Safari 15.4+**: Full support (released March 2022)
- **Edge 79+**: Full support
- **Safari < 15.4 / WebViews**: Fallback to `localStorage` `storage` event
- **Feature detection**: `typeof BroadcastChannel !== 'undefined'`

### What MUST Change

| File | Change | Why |
|------|--------|-----|
| `duel-server/src/server.ts` | Both-disconnect combined grace period, 4h preservation timer, `REQUEST_STATE_SYNC` handler | Server-side edge case handling |
| `duel-server/src/types.ts` | Add `BOTH_DISCONNECTED_CLEANUP_MS` constant, `preservationTimer` typing | New constants |
| `duel-server/src/ws-protocol.ts` | Add `RequestStateSyncMsg` to `ClientMessage`, `'draw_both_disconnect'` to `DuelEndReason` | Protocol extension |
| `front/src/app/pages/pvp/duel-ws.types.ts` | Mirror protocol changes | Client-side type sync |
| `front/src/app/pages/pvp/duel-page/duel-tab-guard.service.ts` | **NEW** — BroadcastChannel + localStorage tab guard | Single-tab enforcement |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Inject `DuelTabGuardService`, add `visibilitychange` listener, add `returningFromBackground` flag, map new duel end reason, add LiveAnnouncer calls | Client-side edge case orchestration |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Add blocked-tab overlay `@if (tabGuard.isBlocked())` | Tab-blocked UI |
| `front/src/app/pages/pvp/duel-page/duel-page.component.scss` | Add `.blocked-tab-overlay` styles | Overlay styling |

### What NOT to Change

- **DuelWebSocketService** — Reconnect logic, backoff, STATE_SYNC handling all work correctly. Only minor addition: expose `sendMessage()` for `REQUEST_STATE_SYNC` if not already public
- **PvpTimerBadgeComponent** — Opponent disconnect indicator already works. No changes needed
- **PvpBoardContainerComponent** — No changes needed
- **CardInspectorComponent / PvpCardInspectorWrapperComponent** — No changes
- **Prompt sub-components** — No changes
- **Animation system** — No changes
- **message-filter.ts** — `REQUEST_STATE_SYNC` is client→server, not filtered. No changes needed
- **Spring Boot backend** — No changes (reconnection is fully duel-server + Angular)

### Previous Story Intelligence (Story 5.1 — Card Inspector PvP Placeholder)

**Patterns to follow:**
- Signal-based inputs: `input<T>()` + `output<T>()` — use for new `DuelTabGuardService` signals
- `inject()` for DI — use for BroadcastChannel service, LiveAnnouncer
- `effect()` + `untracked()` for side effects — use for visibilitychange detection, tab-blocked overlay
- `[class.specific-class]` binding only — NEVER `[class]`
- `import type` for type-only imports
- Explicit `null` (never `undefined` or field omission)
- `firstValueFrom()` for async HTTP calls (if needed)
- Component-scoped services via `providers` array — `DuelTabGuardService` follows same pattern as `CardDataCacheService`

**Anti-Patterns from previous stories:**
- Do NOT add new npm dependencies — BroadcastChannel + localStorage are native Web APIs
- Do NOT inline z-index values — use `_z-layers.scss` tokens or define new `--pvp-*` token
- Do NOT inline color values — use design tokens
- Do NOT modify existing reconnect logic in DuelWebSocketService — it works correctly, only add `REQUEST_STATE_SYNC` send capability
- Do NOT use `[class]` binding
- Do NOT store subscriptions without cleanup — use `DestroyRef` + `takeUntilDestroyed()` if RxJS needed, or manual cleanup in `destroyRef.onDestroy()`

**Epic 4 Retro findings applied:**
- Token compliance — no hardcoded colors/durations
- prefers-reduced-motion — expanded checklist (CSS + rAF + setTimeout)
- DRY KISS — simple wiring, no complex patterns
- Code review mandatory after implementation

### Git Intelligence

**Recent commits:** `e7485f88 epic 4` (latest on dev-pvp), `d80b721f epic 2 & 3`, `35c96f9a epic 1`. Current branch: `dev-pvp`.

**Code conventions observed:**
- `import type` for type-only imports
- `firstValueFrom()` for async HTTP in components
- `output<T>()` for event emitters (Angular 19 signal-based)
- `inject()` for DI, no constructor injection
- Component-scoped services via `providers` array (e.g., `DuelWebSocketService`, `CardDataCacheService`)
- Server-side: plain Node.js + `ws` library, no framework. Inline session types in `server.ts`
- Protocol changes require updating BOTH `duel-server/src/ws-protocol.ts` AND `front/src/app/pages/pvp/duel-ws.types.ts` (same-commit update rule)

### Library & Framework Requirements

- **Angular 19.1.3**: Signals, OnPush, inject(), output(), input(), DestroyRef
- **BroadcastChannel API**: Native Web API — no dependency
- **localStorage**: Native Web API — no dependency
- **TypeScript 5.5.4**: Strict mode
- **Node.js duel-server**: `ws` library, worker_threads
- **No new dependencies** — zero new packages on both frontend and backend

### Testing Requirements

- No automated tests per project "big bang" approach
- Manual verification via Task 6 subtasks
- Focus on: tab enforcement (BroadcastChannel + localStorage fallback), background recovery (visibilitychange + STATE_SYNC), both-disconnect (combined grace → draw), accessibility (LiveAnnouncer, keyboard, prefers-reduced-motion)

### Source Tree — Files to Touch

**CREATE (1 file):**
- `front/src/app/pages/pvp/duel-page/duel-tab-guard.service.ts`

**MODIFY (7 files):**
- `duel-server/src/server.ts` — both-disconnect handling, 4h preservation, REQUEST_STATE_SYNC handler
- `duel-server/src/types.ts` — new constant
- `duel-server/src/ws-protocol.ts` — add RequestStateSyncMsg, draw_both_disconnect reason
- `front/src/app/pages/pvp/duel-ws.types.ts` — mirror protocol changes
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — inject tab guard, visibilitychange, new effects, new reason mapping
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — blocked-tab overlay
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss` — overlay styles

**REFERENCE (read-only):**
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` — verify sendMessage() is accessible for REQUEST_STATE_SYNC
- `front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.ts` — verify no changes needed
- `duel-server/src/message-filter.ts` — verify no changes needed for new message types
- `front/src/app/pages/pvp/duel-page/card-data-cache.service.ts` — reference for component-scoped service pattern

**DO NOT TOUCH:**
- `duel-server/src/duel-worker.ts` — No worker changes
- `duel-server/src/ocg-callbacks.ts` / `ocg-scripts.ts` — No engine changes
- `back/` (Spring Boot) — No backend changes
- `components/card-inspector/` — No inspector changes
- Prompt sub-components — No prompt changes
- Animation system — No animation changes
- Lobby / waiting room — No changes

### Project Structure Notes

- `DuelTabGuardService` is scoped to `DuelPageComponent` (provided in `providers` array, same lifecycle as duel) — matches `DuelWebSocketService` and `CardDataCacheService` pattern
- BroadcastChannel and localStorage listeners are automatically cleaned up when service is destroyed (tab navigates away from duel)
- No global state pollution — all edge case services die with the duel page
- `REQUEST_STATE_SYNC` is a lightweight message — server responds with existing `STATE_SYNC` + `TIMER_STATE`. No new response types needed
- The `draw_both_disconnect` reason maps through existing `DUEL_END` message flow — no new message type needed, just a new reason variant

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 5, Story 5.2: Reconnection Edge Cases (lines 874-897)]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — NFR4-5 reconnection/preservation, BroadcastChannel, visibilitychange, connectionStatus signal, snapshot reconnection strategy]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — Journey 5 Error Recovery flowchart (lines 689-710), App Background Recovery (lines 1621-1625), Single Tab Enforcement (lines 1627-1634), Timer Badge connection states (lines 1602-1604)]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — FR6 disconnection handling (line 195), NFR4 60s reconnection (line 239), NFR5 4h preservation (line 240)]
- [Source: _bmad-output/implementation-artifacts/3-3-disconnection-handling-reconnection.md — Base reconnection implementation, patterns, code review findings]
- [Source: _bmad-output/implementation-artifacts/5-1-card-inspector-pvp-placeholder.md — Previous story patterns, anti-patterns, component-scoped service pattern]
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-02-28.md — Story 3-3 scope reduction to 3-3a, tech debt carry forward for 3-3b edge cases]
- [Source: _bmad-output/implementation-artifacts/epic-4-retro-2026-03-01.md — Expanded prefers-reduced-motion checklist, token compliance, DRY KISS]
- [Source: duel-server/src/server.ts — Grace period (lines 818-837), reconnect handler (lines 674-770), disconnect handler (lines 790-815), cleanupDuelSession (lines 596-640)]
- [Source: duel-server/src/types.ts — RECONNECT_GRACE_MS constant, PlayerSession/DuelSession interfaces]
- [Source: duel-server/src/ws-protocol.ts — OpponentDisconnected/Reconnected messages, ServerMessage/ClientMessage unions]
- [Source: front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts — connectionStatus signal, STATE_SYNC handling, reconnect backoff, opponent disconnect signals]
- [Source: front/src/app/pages/pvp/duel-page/duel-page.component.ts — Connection status effects (lines 493-514), opponentDisconnected tracking (lines 274-276)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build verified: `ng build` pass (only pre-existing jspdf CommonJS warnings)
- TypeScript verified: `tsc --noEmit` pass

### Completion Notes List

- Task execution reordered: Task 4 (protocol) → Task 1 (server) → Task 2 (tab guard) → Task 3+5 (visibilitychange + integration) for dependency chain
- Created DRY `sendStateSnapshot()` function in server to share logic between reconnection handler and REQUEST_STATE_SYNC handler
- Both-disconnect combined grace interacts with individual grace: cancel individual → start combined → on partial reconnect cancel combined → restart individual for still-disconnected player
- `returningFromBackground` changed from `private boolean` to `readonly signal(false)` for template access
- `skipBeat1` input added to `PvpPromptSheetComponent` to skip hint delay on background recovery
- Used `$z-pvp-blocked-tab-overlay: 95` in `_z-layers.scss` (between result overlay at 90 and orientation lock at 9000)
- Task 6 (manual verification) left unchecked — requires live browser testing

### File List

**Created (1):**
- `front/src/app/pages/pvp/duel-page/duel-tab-guard.service.ts` — BroadcastChannel + localStorage single-tab enforcement

**Modified (10):**
- `duel-server/src/types.ts` — Added `BOTH_DISCONNECTED_CLEANUP_MS`, `STATE_SYNC_RATE_LIMIT_MS` constants
- `duel-server/src/ws-protocol.ts` — Added `'draw_both_disconnect'` to `DuelEndReason`, `RequestStateSyncMsg` interface + `ClientMessage` union
- `front/src/app/pages/pvp/duel-ws.types.ts` — Mirror of ws-protocol changes
- `duel-server/src/server.ts` — Both-disconnect combined grace, 4h preservation, `sendStateSnapshot()` DRY function, `REQUEST_STATE_SYNC` handler with 5s rate limit, extended `ActiveDuelSession` with 5 new fields
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` — Added `sendRequestStateSync()` method
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Injected `DuelTabGuardService`, `visibilitychange` listener, `returningFromBackground` signal, STATE_SYNC auto-resolved snackbar effect, tab guard blocked effect, `draw_both_disconnect` reason mapping
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — Blocked-tab overlay, `[skipBeat1]` binding on prompt sheet
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss` — `.blocked-tab-overlay` styles with fade-in + prefers-reduced-motion
- `front/src/app/styles/_z-layers.scss` — Added `$z-pvp-blocked-tab-overlay: 95`
- `front/src/app/pages/pvp/duel-page/prompts/pvp-prompt-sheet/pvp-prompt-sheet.component.ts` — Added `skipBeat1` input, skip hint delay when returning from background

### Change Log

| Change | Reason |
|--------|--------|
| Added `DuelTabGuardService` with BroadcastChannel + localStorage fallback | AC1: Single-tab enforcement |
| Added `visibilitychange` listener + `REQUEST_STATE_SYNC` flow | AC2: Background tab recovery |
| Added both-disconnect combined grace + 4h preservation on server | AC3: Simultaneous disconnection |
| Added `sendStateSnapshot()` DRY function on server | Shared by reconnection + REQUEST_STATE_SYNC |
| Added `draw_both_disconnect` duel end reason | AC3: Distinct reason for both-disconnect |
| Added blocked-tab overlay with `mat-raised-button` | AC1 + AC4: Accessible tab-blocked UI |
| Added auto-resolved snackbar on STATE_SYNC | AC2: Inform user of missed actions |
| Added `skipBeat1` to prompt sheet | AC2: Skip hint delay on background recovery |
| Added LiveAnnouncer calls for state transitions | AC4: Screen reader accessibility |
| Added `prefers-reduced-motion` for blocked-tab overlay | AC4: Motion accessibility |
