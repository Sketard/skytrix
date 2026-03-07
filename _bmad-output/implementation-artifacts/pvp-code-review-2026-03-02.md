# PvP Code Review — 2026-03-02

**Scope:** Full codebase review of `dev-pvp` branch (152 files, ~24K lines added)
**Focus:** Code quality, DRY, KISS, maintainability, bugs, security
**Layers reviewed:** Duel Server (Node.js/TS), Spring Boot backend, Angular frontend

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **HIGH** | 18 | Must fix before testing — bugs, security, critical DRY/maintainability |
| **MEDIUM** | 28 | Should fix — improves reliability and debuggability |
| **LOW** | 26 | Nice to fix — polish, consistency, minor code smells |

> **Post-review audit (2026-03-02):** +3 HIGH, +8 MEDIUM, +6 LOW added. 1 false positive removed (~~M17~~). 3 findings corrected (H2, H8, M16).

---

## HIGH Severity

### H1 — God Component: `duel-page.component.ts` (1397 lines)

**File:** `front/src/app/pages/pvp/duel-page/duel-page.component.ts`

The single largest maintainability problem. This component handles: room loading, polling, countdown, WebSocket connection, RPS, board state, animations, LP tracking, prompts, card inspection, zone browsing, action menus, surrender, rematch, fullscreen, tab guard, orientation lock, and accessibility announcements. The constructor alone contains 18+ `effect()` calls with complex reactive dependency chains.

**Recommendation:** Extract into dedicated services:
- `AnimationOrchestratorService` — animation queue processing, LP tracking, zone animations (lines 624-806)
- `RoomStateMachineService` — room fetching, polling, countdown, status transitions (lines 808-942)
- `CardInspectionService` — card data loading, generation-based race protection (lines 1121-1167)

This would reduce the component from ~1400 to ~600 lines and make each concern independently testable.

---

### H2 — Board template HTML duplicated ~130 lines

**File:** `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.html`

Three major duplication patterns:
1. **Chain badge rendering** repeated 4 times (opponent zones, EMZ_L, EMZ_R, player zones) — lines 41-59, 95-113, 148-166, 214-232 (~60 extra lines)
2. **EMZ_L and EMZ_R blocks** — lines 78-118 vs 131-171 (differ only in zoneId string, ~40 extra lines)
3. **Zone card rendering** for opponent vs player — lines 20-60 vs 192-232 (~35 shared lines, differ in player index, click handler, actionable class)

**Recommendation:** Extract:
- `PvpChainBadgesComponent` (or `ng-template` with context)
- `PvpFieldSectionComponent` parameterized by player index
- Unify EMZ_L/EMZ_R via a single `@for` over `['EMZ_L', 'EMZ_R']`

---

### H3 — Location→ZoneId mapping duplicated 3 times

The same `location + sequence → ZoneId` logic exists in three places:
- `duel-page.component.ts:789-800` — `mapAnimationZoneId()`
- `duel-page.component.ts:1277-1288` — `placeOptionToZoneId()`
- `duel-web-socket.service.ts:353-361` — `mapChainLocationToZoneId()`

**Recommendation:** Extract a single `locationToZoneId(location: number, sequence: number): ZoneId | null` utility function in `pvp-card.utils.ts`.

---

### H4 — Spring Boot: `IllegalArgumentException` returns 500 to client

**File:** `back/src/main/java/com/skytrix/service/RoomService.java`

`createRoom()` (line 56, 58), `getRoom()` (line 148), and `endRoom()` (line 163) throw `IllegalArgumentException`. There is no `@ControllerAdvice` or `@ExceptionHandler` in the project, so Spring returns a raw 500 Internal Server Error. The client cannot distinguish "deck not found" from a real server crash.

Meanwhile, `joinRoom()` correctly uses `ResponseStatusException` with proper HTTP status codes.

**Recommendation:** Replace all `IllegalArgumentException` throws with `ResponseStatusException`:
- `"Deck not found"` → `ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, ...)`
- `"Room not found"` → `ResponseStatusException(HttpStatus.NOT_FOUND, ...)`
- `"Deck does not belong to user"` → `ResponseStatusException(HttpStatus.FORBIDDEN, ...)`

---

### H5 — Spring Boot: No deck validation in `createRoom()`

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:53-68`

`joinRoom()` validates deck size (main 40-60, extra 0-15, side 0-15) at lines 93-109, but `createRoom()` performs no deck validation at all. Player 1 can create a room with an empty or oversized deck — the error only surfaces when the duel server rejects it (or worse, crashes silently).

**Recommendation:** Extract a private `validateDeck(Long decklistId, Long userId)` method called from both `createRoom()` and `joinRoom()`.

---

### H6 — Spring Boot: Secrets hardcoded in `application.properties`

**File:** `back/src/main/resources/application.properties`

```
jwt.secret=NyfG9bT0gZtOnVlnuZ5UQwyEuN5HEZcm23WxEIZskjPSqxIvNG275FLvo46Ovmbq
spring.datasource.password=root
```

Both values are committed to source control in plain text. The `docker-compose.yml` already uses `${JWT_SECRET}` and `${POSTGRES_PASSWORD}`, but the properties file has hardcoded fallback values.

**Recommendation:** Use environment variable substitution: `${JWT_SECRET:default-dev-only}` and `${DB_PASSWORD:root}`.

---

### H7 — Spring Boot: `joinRoom()` can save room as ACTIVE with null `duelServerId`

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:116-143`

If the duel server returns a 200 with unexpected JSON shape where `getDuelId()` returns null, line 130 sets `duelServerId = null` on the Room entity and saves it as ACTIVE. This creates a broken room — WebSocket tokens exist but point to no duel.

**Recommendation:** Add a null check on `response.getDuelId()` and throw `ResponseStatusException(503)` if null.

---

### H8 — Unsafe `as` casts in prompt sub-components

**Files:** `PromptCardGridComponent` (4 casts), `PromptNumericInputComponent` (3 casts)

The `PromptSubComponent` interface types `promptData` as `Prompt | null` (a wide union of 20+ types). Two of the five sub-components use unsafe `as` casts:
- `PromptCardGridComponent` uses `'cards' in` structural checks followed by ad-hoc `as { cards: CardInfo[] }` — does not narrow via discriminant, so any future prompt type with a `cards` field would hit the wrong path.
- `PromptNumericInputComponent` uses `as AnnounceNumberMsg` / `as SelectCounterMsg` after `type === '...'` checks — the casts are redundant (TS already narrows on discriminant) but not unsafe.

The remaining 3 (OptionList, Rps, YesNo) use proper `switch`/discriminant narrowing with no `as` casts.

**Recommendation:** Make the interface generic: `PromptSubComponent<T extends Prompt>` so each sub-component can type-narrow at the interface level. Priority: fix `PromptCardGrid` which has actual safety risk.

---

### H9 — `baseLpDuration` computed before CSS is loaded

**File:** `front/src/app/pages/pvp/duel-page/duel-page.component.ts:302-306`

```typescript
private readonly baseLpDuration = (() => {
  const style = getComputedStyle(document.documentElement);
  const raw = style.getPropertyValue('--pvp-transition-lp-counter').trim();
  return parseFloat(raw) || 0;
})();
```

This field initializer runs during construction, before the component is attached to the DOM. If CSS variables are not yet loaded (first page load, lazy-loaded styles), `getPropertyValue` returns empty string and `parseFloat('')` returns `NaN`, falling back to `0`. All LP animations would have zero duration.

**Recommendation:** Move to `ngOnInit()` or make it a lazy `computed()`.

---

### H10 — `PvpBoardContainerComponent` is a secondary god component

**Files:** `pvp-board-container.component.ts` (266 lines) + `.html` (250 lines) + `.scss` (370 lines)

This component handles: field zone rendering for both players, EMZ rendering, LP badges, timer badge, phase badge, card interactions, zone highlighting, actionable card glow, chain badges, zone animations, action menus, zone pills, and card inspect events. It has 10 `input()` signals, 5 `output()` signals, and 12 `computed()` signals.

**Recommendation:** Extract `PvpFieldSectionComponent` (per player) and `PvpCentralStripComponent` (EMZ + LP + timer + phase).

---

### H11 — `highlightBadgeNumber` creates new Array on every call

**File:** `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts:122-124`

```typescript
highlightBadgeNumber(zoneId: ZoneId): number {
  return Array.from(this.highlightedZones()).indexOf(zoneId) + 1;
}
```

Called from the template for each highlighted zone on every change detection. `Array.from(Set)` creates a new array each time. Iteration order from `Set` is insertion order so the result is deterministic, but the allocation is wasteful.

**Recommendation:** Pre-compute a `Map<ZoneId, number>` in a `computed()` signal.

---

### H12 — RPS timer can flash `-1` in UI

**File:** `front/src/app/pages/pvp/duel-page/prompts/prompt-rps/prompt-rps.component.ts:39-44`

The `setInterval` callback decrements `secondsLeft` unconditionally before checking `<= 0`. If `selectRandom()` → `selectChoice()` → `clearTimer()` runs, the interval may have already decremented on that tick. The signal can momentarily hold `-1` for one render frame.

**Recommendation:** Guard the decrement: `this.secondsLeft.update(s => Math.max(0, s - 1))`.

---

### H13 — Spring Boot: `createRoom()` double DB query for deck

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:93-96, 118`

In `joinRoom()`, the joiner's deck cards are fetched at line 93 for validation, then fetched again at line 118 via `extractDeck(dto.getDecklistId())`. Two identical DB queries for the same data within the same method.

**Recommendation:** Pass the already-fetched `List<CardDeckIndex>` to `extractDeck()` instead of re-querying.

---

### H14 — `backToLobby()` / `backToDeck()` duplicate room-end call

**File:** `front/src/app/pages/pvp/duel-page/duel-page.component.ts:987-1003`

Both methods contain `this.http.post(/api/rooms/${this.roomId}/end, {}).subscribe()` as duplicated fire-and-forget logic.

**Recommendation:** Extract a private `endRoomIfNeeded()` method.

---

### H15 — Image prefetch pattern duplicated

**File:** `front/src/app/pages/pvp/duel-page/duel-page.component.ts:1298-1355`

`preFetchDeckThumbnails()` and `preFetchHandThumbnails()` duplicate the same image preloading pattern (create `new Image()`, set `onload/onerror`, wait for `Promise.allSettled`). They differ only in the source of card codes.

**Recommendation:** Extract `preloadImages(codes: number[]): Promise<void>` utility.

---

### H16 — Duel Server: No authentication on HTTP API

**Files:** `duel-server/src/server.ts:164-177` (`POST /api/duels`), `GET /api/duels/active`

The duel server's HTTP endpoints have zero authentication — no shared secret, no API key, no IP allowlist. Any process that can reach the port can create duels, list active duel IDs, or check health/status. While the architecture describes these as "server-to-server", the lack of any auth means a malicious client on the same network can create arbitrary duels or enumerate active sessions.

**Recommendation:** Add a shared secret header (`X-Internal-Key`) validated on all mutating endpoints, injected via environment variable.

---

### H17 — Duel Server: Memory leak — abandoned duels never cleaned

**Files:** `duel-server/src/server.ts:44-46, 217-218`

When a duel is created via `POST /api/duels`, two tokens are added to `pendingTokens` and an `ActiveDuelSession` is added to `activeDuels`. If neither player ever connects via WebSocket (e.g., client crashes after room creation), no disconnect/grace-period logic fires. The worker sits idle forever — there is no stale-session reaper in the main thread. The `RoomCleanupScheduler` on Spring Boot side can close the DB room, but the duel server session + worker + pending tokens persist in memory indefinitely.

**Recommendation:** Add a connection timeout (e.g., 60s after duel creation) — if both players haven't connected, terminate the worker and cleanup the session.

---

### H18 — Spring Boot: `CREATING_DUEL` rooms never cleaned up

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:113`, `back/src/main/java/com/skytrix/scheduler/RoomCleanupScheduler.java`

If `joinRoom()` throws an exception between `room.setStatus(RoomStatus.CREATING_DUEL)` (line 113) and the end of the try block (e.g., a JSON parsing error from the duel server response, or any exception type other than `RestClientException`), the room stays in `CREATING_DUEL` status permanently. The `RoomCleanupScheduler` only cleans `WAITING` rooms (older than 30 min) and `ACTIVE` rooms not found on the duel server — it **never** cleans `CREATING_DUEL` rooms.

**Recommendation:** Add a cleanup clause in `RoomCleanupScheduler` for rooms in `CREATING_DUEL` status older than 2 minutes.

---

## MEDIUM Severity

### M1 — Duel Server: 6+ separate Maps for session state

**File:** `duel-server/src/server.ts:44-49`

State is fragmented across `activeDuels`, `pendingTokens`, `reconnectTokens`, `gracePeriodTimers`, `timerContexts`, `inactivityTimers`, and `raceWindowTimers`. All are keyed on duelId-derived strings. This makes cleanup error-prone — forgetting to clear one Map creates a memory leak.

**Recommendation:** Consider consolidating timer state into `ActiveDuelSession` or creating a `DuelTimerManager` class that owns all timer lifecycle.

---

### M2 — Duel Server: `toCardInfo` and `toCardInfoFromPos` nearly identical

**File:** `duel-server/src/duel-worker.ts:71-77`

Both functions produce the same output shape. The only difference is the input type (`OcgCardLoc` vs `OcgCardLocPos`). Since both have the same fields used, a single function with a broader input type would suffice.

---

### M3 — Duel Server: Deck content not deeply validated

**File:** `duel-server/src/server.ts:173-177`

POST `/api/duels` validates that `main` and `extra` are arrays, but does not check that array elements are numbers. A malicious client could send `["hello", null, {}]` — this would reach the worker and potentially cause OCGCore to crash or behave unpredictably.

**Recommendation:** Add `deck.main.every(c => typeof c === 'number')` check.

---

### M4 — Duel Server: `worker.terminate()` called on already-terminated worker

**File:** `duel-server/src/server.ts:793-795`

After reconnecting during the preservation period (post-duel), `cleanupDuelSession(session)` is called followed by `session.worker.terminate()`. But the worker was already terminated when `handleDuelEnd` ran. Calling `terminate()` on an already-exited worker is a no-op in Node.js but is confusing for maintainers.

---

### M5 — Spring Boot: N+1 queries in `listOpenRooms()`

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:152-157`

`findTop10ByStatusOrderByCreatedAtDesc()` returns up to 10 `Room` entities, each with `@ManyToOne` player1 and player2. No `JOIN FETCH` or `@EntityGraph` — this triggers up to 20 additional SELECT queries.

**Recommendation:** Add a `@Query("SELECT r FROM Room r JOIN FETCH r.player1 LEFT JOIN FETCH r.player2 WHERE r.status = ?1")` method.

---

### M6 — Spring Boot: Mix of `roomCode` vs `id` in REST endpoints

**File:** `back/src/main/java/com/skytrix/controller/RoomController.java`

- `GET /{roomCode}` uses the 6-char room code (external identifier)
- `POST /{id}/end` uses the database Long ID (internal identifier)

This leaks internal DB IDs to the client and creates inconsistency in the API surface.

**Recommendation:** Use `roomCode` as the sole external identifier for all room endpoints.

---

### M7 — Spring Boot: `DuelServerClient.getActiveDuelIds()` returns `null` on failure

**File:** `back/src/main/java/com/skytrix/service/DuelServerClient.java:57-68`

Returning `null` to signal failure forces callers to null-check. An `Optional<List<String>>` or empty list would be a safer API contract.

---

### M8 — Spring Boot: Naming inconsistency `duelServerId` vs `duelId`

**Files:** `Room.java` field `duelServerId`, `RoomDTO.java` field `duelId`, `DuelCreationResponse.java` field `duelId`

The entity calls it `duelServerId`, but the DTO and duel server response call it `duelId`. Pick one name consistently.

---

### M9 — Spring Boot: Missing `@Transactional(readOnly = true)` on read methods

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:146-157`

`getRoom()` and `listOpenRooms()` have no `@Transactional`. They rely on OSIV being enabled. If OSIV is ever disabled, `LazyInitializationException` will occur.

---

### M10 — Spring Boot: `extractDeck()` uses `intValue()` — silent truncation risk

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:179`

`c.getCard().getPasscode().intValue()` — if passcode is a `Long`, values above `Integer.MAX_VALUE` would be silently truncated.

---

### M11 — Spring Boot: `generateUniqueRoomCode()` throws `RuntimeException`

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:188-196`

Only 3 attempts are made. Failure throws unhandled `RuntimeException` → 500. Should be `ResponseStatusException(503)`.

---

### M12 — Angular: Counter distribution puts all counters on card[0]

**File:** `front/src/app/pages/pvp/duel-page/prompts/prompt-numeric-input/prompt-numeric-input.component.ts:91-97`

For `SELECT_COUNTER`, the response assigns ALL counters to card index 0. If the game engine expects distributed counters across multiple cards, this is incorrect.

**Recommendation:** Implement proper multi-card counter distribution UI or validate that single-card is the only use case.

---

### M13 — Angular: Timer badge CSS — `.timer--active` overwrites color backgrounds

**File:** `front/src/app/pages/pvp/duel-page/pvp-timer-badge/pvp-timer-badge.component.scss`

`.timer--green`, `.timer--yellow`, `.timer--red` each set a `background`, but `.timer--active` (line 33) also sets a `background` and appears later in source order. Since both classes are applied simultaneously, the active background always wins — color-coded backgrounds are never visible during normal timer operation.

**Recommendation:** Remove the conflicting `background` from `.timer--active` or restructure the class hierarchy.

---

### M14 — Angular: Zombie listener in `PvpZoneBrowserOverlay`

**File:** `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.ts:35-42`

The `setTimeout` in the constructor registers a `document.addEventListener('click', ...)`. If the component is destroyed before the timeout fires (rapid open/close), `ngOnDestroy` runs first (finding `null` listener), then the timeout fires and registers a listener on a dead component reference — a zombie listener that persists on `document` forever.

**Recommendation:** Guard the timeout with a `destroyed` flag, or use `DestroyRef.onDestroy()` to clear the pending timeout.

---

### M15 — Angular: `canDeactivate` guard uses `any`

**File:** `front/src/app/app.routes.ts:29-33`

```typescript
canDeactivate: [(component: any) => { ... }]
```

Using `any` bypasses all type checking. If `DuelPageComponent` renames `roomState`, `wsService`, or `confirmSurrender`, this guard silently breaks at runtime.

**Recommendation:** Type the parameter as `DuelPageComponent`.

---

### M16 — Angular: Outside-click listener pattern duplicated 3 times

**Files:** `pvp-phase-badge.component.ts`, `pvp-zone-browser-overlay.component.ts`, and `duel-page.component.ts` (card action menu, line 1028)

All three use the identical pattern: `setTimeout` defer → `document.addEventListener('click', ...)` → `el.nativeElement.contains(event.target)` check → `removeEventListener` on destroy. Character-for-character identical `removeOutsideListener()` methods.

**Recommendation:** Extract a shared `ClickOutsideDirective` or utility function.

---

### ~~M17 — RETRACTED (false positive)~~

~~`overlayMaterials` could be `undefined`.~~ Verified: `CardOnField.overlayMaterials` is typed as required `number[]` and always initialized to `[]` server-side (`duel-worker.ts:440` via `info.overlayCards ?? []` and `message-filter.ts:173`). Never `undefined` in PvP context.

---

### M18 — Angular: `buildActionableCardsFromIdle` and `buildActionableCardsFromBattle` share identical `add` closure

**File:** `front/src/app/pages/pvp/duel-page/idle-action-codes.ts:31-37, 49-55`

The inner `add` helper function is copy-pasted between the two exports. Extract as a shared private function.

---

### M19 — Angular: `.btn--primary` mixin inclusion repeated in 4 SCSS files

**Files:** `prompt-card-grid.component.scss`, `prompt-numeric-input.component.scss`, `prompt-option-list.component.scss`, `prompt-yes-no.component.scss`

Each prompt component independently includes the `.btn { &--primary { @include btn.prompt-btn-primary; } }` block.

**Recommendation:** Move to a shared utility class injected from the parent prompt sheet.

---

### M20 — Angular: `pvp-actionable-pulse` keyframe defined globally, used in scoped components

**File:** `front/src/app/styles/_tokens.scss:146-149`

The keyframe is defined on `:root` and referenced by component-scoped selectors. This works with Angular's default ViewEncapsulation but would break under Shadow DOM encapsulation.

---

### M21 — Spring Boot: `DuelServerClient.isServerHealthy()` swallows exceptions silently

**File:** `back/src/main/java/com/skytrix/service/DuelServerClient.java:46-55`

The `catch (Exception e)` returns `false` without logging. The root cause (connection refused? timeout? DNS failure?) is lost entirely.

**Recommendation:** Add `log.debug("Health check failed", e)`.

---

### M22 — ws-protocol.ts manually synced between duel-server and Angular

**Files:** `duel-server/src/ws-protocol.ts` and `front/src/app/pages/pvp/duel-ws.types.ts`

The file header documents manual copy. Currently both files are identical, but this is error-prone.

**Recommendation:** Add a build-time copy script or checksum verification in CI.

---

### M23 — Angular: Unguarded `JSON.parse` in WebSocket message handler

**File:** `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts:136-138`

```typescript
this.ws.onmessage = event => {
  const message: ServerMessage = JSON.parse(event.data);
  this.handleMessage(message);
};
```

No try/catch around `JSON.parse`. A malformed server message (network corruption, proxy injection) throws an unhandled exception and breaks the entire WS message loop. The duel server's own handler (`server.ts:836-841`) correctly wraps its parse in try/catch, but the client does not.

**Recommendation:** Wrap in try/catch, log the error, and continue listening.

---

### M24 — Angular: Missing `readyState` check before `ws.send()`

**File:** `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts:60-63, 70, 74, 78`

`sendResponse()`, `sendSurrender()`, `sendRequestStateSync()`, and `sendRematchRequest()` all use `this.ws?.send()` with optional chaining (handles `null`), but do not check `ws.readyState === WebSocket.OPEN`. If the WebSocket is in CLOSING or CLOSED state, `send()` throws `DOMException`. Worse, `_pendingPrompt.set(null)` runs unconditionally — the UI clears the prompt even though the response never reached the server.

**Recommendation:** Guard with `if (this.ws?.readyState === WebSocket.OPEN)` before sending. Only clear prompt state on successful send.

---

### M25 — Spring Boot: `endRoom()` does not notify the duel server

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:160-173`

`endRoom()` sets the room status to ENDED in the database but makes no HTTP call to the duel server to terminate the active duel. The duel continues running server-side until disconnect grace period expires, inactivity timeout fires, or `RoomCleanupScheduler` runs (every 5 min). During testing, each abandon/back-to-lobby leaves a zombie duel consuming memory.

**Recommendation:** Add a `DELETE /api/duels/{duelId}` call (or fire-and-forget POST) before setting status to ENDED.

---

### M26 — Spring Boot: CORS wildcard origin

**File:** `back/src/main/java/com/skytrix/config/SecurityConfig.java:101`

`config.setAllowedOrigins(List.of("*"))` allows requests from any origin. Overly permissive for any non-local deployment.

**Recommendation:** Restrict to `${CORS_ALLOWED_ORIGINS:http://localhost:4200}` via environment variable.

---

### M27 — Spring Boot: `getConnectedUser()` hits DB on every call

**File:** `back/src/main/java/com/skytrix/service/AuthService.java:53-54`

`getConnectedUser()` does `userRepository.findById(userDetail.getId()).orElseThrow()` every time. The user ID is already available in the JWT via `CustomUserDetails`. `getConnectedUserId()` (line 48-49) also calls `getConnectedUser().getId()`, loading the full User entity just to return the ID.

**Recommendation:** `getConnectedUserId()` should return `userDetail.getId()` directly. Only use `getConnectedUser()` when the full entity is needed.

---

### M28 — Duel Server: No validation on `PLAYER_RESPONSE` data

**File:** `duel-server/src/server.ts:944-1011`

`PLAYER_RESPONSE` messages check `awaitingResponse` but the `promptType` and `data` fields are forwarded to the worker without schema validation. In the worker, `transformResponse()` accesses `data` properties by name — invalid/missing fields produce `undefined` values sent to `core.duelSetResponse()`, which could cause OCGCore to crash or behave unpredictably.

**Recommendation:** Validate `promptType` matches the currently awaited prompt type, and validate `data` shape per prompt type before forwarding to worker.

---

### M29 — Angular: Impure methods called from template `@for` loops

**File:** `front/src/app/pages/pvp/duel-page/pvp-board-container/pvp-board-container.component.ts`

Methods `getChainBadges()` (line 228), `isZoneAnimating()` (line 245), `isEmzAnimating()` (line 251), `getEmzChainBadges()` (line 256) are called inside `@for` loops in the template. Each call creates new filtered arrays via `.filter()`. With OnPush change detection, this fires on every input change — ~30+ method calls + allocations per change detection cycle.

**Recommendation:** Pre-compute these as `computed()` signals (e.g., `chainBadgesByZone = computed(() => ...)` returning a `Map<ZoneId, ChainBadge[]>`).

---

### M30 — Duel Page: Timer threshold comparison inconsistency

**File:** `front/src/app/pages/pvp/duel-page/duel-page.component.ts:525-535`

The pre-seed loop (line 525) uses strict `<` (`totalSec < t`), but the announcement loop (line 530) uses `<=` (`totalSec <= t`). At exactly `totalSec === 30`, the 30s threshold is NOT pre-seeded, so the announcement fires even on a reconnect where the timer happens to be exactly at 30s.

**Recommendation:** Use consistent comparison operator (`<=`) in both loops.

---

## LOW Severity

### L1 — Magic numbers in `openCardActionMenu`

**File:** `front/src/app/pages/pvp/duel-page/duel-page.component.ts:1018-1023`

Values `160`, `200`, `164`, `204` are hardcoded menu dimensions used for viewport bounds checking. Should be constants with descriptive names.

---

### L2 — `environment.prod.ts` contains placeholder domain

**File:** `front/src/environments/environment.prod.ts:3`

```typescript
wsUrl: 'wss://domain/ws'
```

Will fail in production if not replaced. Should use an environment variable or build-time substitution.

---

### L3 — `z-index: 2` hardcoded in 3 components

**Files:** `pvp-card-inspector-wrapper.component.scss:4`, `pvp-phase-badge.component.scss:55`, `pvp-board-container.component.scss:212`

The project has a well-organized `_z-layers.scss` token file, but these 3 components use raw `z-index: 2` instead.

---

### L4 — Colors hardcoded instead of using design tokens

**Files:** Multiple component SCSS files use `#eee`, `rgba(20, 20, 40, ...)` directly instead of tokens from `_tokens.scss` (`--text-primary: #EAEAEA`, `--surface-base: #121212`).

Affected: `pvp-activation-toggle`, `pvp-card-inspector-wrapper`, `pvp-zone-browser-overlay`, `pvp-board-container`, `prompt-zone-highlight`.

---

### L5 — Zone browser close button below touch target minimum

**File:** `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.scss:57-58`

Button is 28px, below the 44px WCAG 2.5.8 minimum and below the app's own `--pvp-min-touch-target-primary: 48px` token.

---

### L6 — `CreateRoomDTO` and `JoinRoomDTO` are identical

**Files:** `back/src/main/java/com/skytrix/model/dto/room/CreateRoomDTO.java`, `JoinRoomDTO.java`

Both contain a single `@NotNull Long decklistId`. Functionally identical code. Acceptable for future evolution but adds unnecessary cognitive load.

---

### L7 — Dead methods in `RoomRepository`

**File:** `back/src/main/java/com/skytrix/repository/RoomRepository.java`

- `findByStatusOrderByCreatedAtDesc()` — never called (replaced by `findTop10By...`)
- `findByIdForUpdate()` — never called (only `findByRoomCodeForUpdate()` is used)
- `findByStatusAndPlayerId()` — never called

---

### L8 — `prompt-zone-highlight.component.scss` uses hardcoded `#fff`

**File:** `front/src/app/pages/pvp/duel-page/prompts/prompt-zone-highlight/prompt-zone-highlight.component.scss:22`

Should use `var(--text-primary)` to respect theme and forced-colors modes.

---

### L9 — `RoomMapper` uses MapStruct annotation but manual mapping

**File:** `back/src/main/java/com/skytrix/mapper/RoomMapper.java`

Annotated `@Mapper(componentModel = "spring")` and extends `abstract class`, but `toRoomDTO()` is entirely hand-written. The MapStruct annotation is dead weight — a plain `@Component` would be simpler.

---

### L10 — `tokens` field name ambiguous in `DuelCreationResponse`

**File:** `back/src/main/java/com/skytrix/model/dto/room/DuelCreationResponse.java:11`

`private String[] tokens` — in a project with JWT tokens, "tokens" is ambiguous. `wsTokens` would be clearer.

---

### L11 — `roomCode` path variable not validated at controller level

**File:** `back/src/main/java/com/skytrix/controller/RoomController.java:41, 53`

No `@Pattern(regexp = "[A-Z2-9]{6}")` validation. Malformed room codes reach the DB query before returning 404.

---

### L12 — Spring Boot: Race condition on room code uniqueness

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:188-196`

Check-then-save pattern without constraint violation handling. The DB `UNIQUE` constraint catches collisions but throws `DataIntegrityViolationException` which is unhandled → 500.

---

### L13 — Spring Boot: `cleanupOrphanedActiveRooms()` has redundant `saveAll`

**File:** `back/src/main/java/com/skytrix/scheduler/RoomCleanupScheduler.java:62-68`

The method is `@Transactional`, so Hibernate dirty checking flushes all modified entities automatically. The explicit `saveAll(toClose)` is redundant.

---

### L14 — Spring Boot: Field injection everywhere

All Spring services and controllers use `@Inject` field injection. Constructor injection is the Spring-recommended pattern for immutability, explicit dependencies, and testability.

---

### L15 — Spring Boot: Hardcoded deck size limits

**File:** `back/src/main/java/com/skytrix/service/RoomService.java:98-109`

Values `40`, `60`, `15` are hardcoded. The existing `DeckKeyword` enum already defines `minSize` and `maxSize`. Should use `DeckKeyword.MAIN.getMinSize()` etc.

---

### L16 — Inconsistent border-radius values across SCSS

Various components use `2px`, `3px`, `4px`, `6px`, `8px`, `12px`, `50%` without tokenization. Should define `--pvp-radius-sm`, `--pvp-radius-md`, `--pvp-radius-lg` in `_tokens.scss`.

---

### L17 — `pvp-board-container.component.scss:112` — magic `scale(0.69)`

Has a comment but no CSS variable. Should be tokenized as `--pvp-opponent-scale` for maintainability.

---

### L18 — `pvp-card-inspector-wrapper.component.scss` — hardcoded card dimensions

`width: 60px; height: 87px` should reference `--pvp-hand-card-width` / `--pvp-hand-card-height` tokens.

---

### L19 — `getCardImageUrl` and `getCardImageUrlByCode` overlap

**File:** `front/src/app/pages/pvp/pvp-card.utils.ts:14-27`

`getCardImageUrl(card)` does `getCardImageUrlByCode(card.cardCode)` with a null check. One should delegate to the other.

---

### L20 — `PromptSubComponent` interface uses `EventEmitter` — coupling concern

**File:** `front/src/app/pages/pvp/duel-page/prompts/prompt.types.ts:11`

The interface references `EventEmitter` from `@angular/core`. Acceptable since all consumers are Angular components, but should be documented as intentional (required for `ComponentPortal` dynamic instantiation).

---

### L21 — `PvpCardInspectorWrapperComponent` uses `window.matchMedia` directly

**File:** `front/src/app/pages/pvp/duel-page/pvp-card-inspector-wrapper/pvp-card-inspector-wrapper.component.ts:28-33`

Angular provides `BreakpointObserver` from `@angular/cdk/layout` which is more testable and SSR-safe.

---

### L22 — Angular: `screen.orientation` cast to `any`

**File:** `front/src/app/pages/pvp/duel-page/duel-page.component.ts:1382`

```typescript
(screen.orientation as any).lock?.('landscape-primary')?.catch(() => {});
```

Uses `as any` to bypass typing for the non-standard `screen.orientation.lock` API. Suppresses all type checking.

**Recommendation:** Use `declare` augmentation or `@ts-expect-error` with an explanatory comment.

---

### L23 — Angular: `fetchRoom` HTTP subscription not guarded

**File:** `front/src/app/pages/pvp/duel-page/duel-page.component.ts:808-825`

`roomApiService.getRoom(roomCode).subscribe()` is not guarded by `takeUntilDestroyed`. If the component is destroyed while in-flight, callbacks still fire, mutating signals and calling `handleRoomStatus` on a dead component.

**Recommendation:** Add `pipe(takeUntilDestroyed(this.destroyRef))`.

---

### L24 — Angular: `ActivationToggle` internal state can drift from parent

**File:** `front/src/app/pages/pvp/duel-page/pvp-activation-toggle/pvp-activation-toggle.component.ts:30`

The component has an internal `mode` signal and emits `modeChange` as output. There is no `input()` binding to synchronize with the parent's `activationMode`. If the parent needs to reset the mode (e.g., on rematch), the toggle's internal state won't update.

**Recommendation:** Accept a `model()` input or use a two-way binding pattern.

---

### L25 — Angular: Zone browser close `setTimeout` can emit on destroyed component

**File:** `front/src/app/pages/pvp/duel-page/pvp-zone-browser-overlay/pvp-zone-browser-overlay.component.ts:68`

`setTimeout(() => { this.visible.set(false); this.closed.emit(); }, 150)` — if the component is destroyed during the 150ms fade animation, `closed.emit()` fires on a dead component.

**Recommendation:** Guard with `DestroyRef` or clear the timeout on destroy.

---

### L26 — Duel Server: Worker DB connections not explicitly closed

**File:** `duel-server/src/duel-worker.ts:648, 713-718`

`loadDatabase(dbPath)` opens a `better-sqlite3` connection. The `cleanup()` function destroys the duel handle but never calls `db.close()`. The connection is garbage-collected on worker exit, but file handles can accumulate if workers take time to GC.

**Recommendation:** Add `db.close()` in `cleanup()`.

---

### L27 — Duel Server: `readBody()` has no timeout

**File:** `duel-server/src/server.ts:81-101`

If a client disconnects mid-body, the Promise may never resolve. `req.on('error', reject)` handles TCP errors, but an aborted connection could leave the Promise hanging.

**Recommendation:** Add a `setTimeout` rejection (e.g., 10s) inside `readBody()`.

---

## Prioritized Action Plan

### Phase 1 — Critical fixes (before testing)

1. **Fix Spring Boot bugs** (H4, H5, H6, H7) — `ResponseStatusException`, deck validation, externalize secrets, null duelId guard
2. **Fix Angular bugs** (H9, H12, M12, M13, M14) — baseLpDuration timing, RPS timer guard, counter distribution, timer CSS, zombie listener
3. **Type safety** (M15) — canDeactivate guard
4. **Orphan cleanup** (H17, H18) — duel server connection timeout for abandoned duels, Spring Boot scheduler for `CREATING_DUEL` rooms
5. **WS client robustness** (M23, M24) — try/catch on JSON.parse, readyState check before send
6. **`endRoom()` → duel server notification** (M25) — prevent zombie duels during testing

### Phase 2 — DRY refactoring (improves debuggability)

7. **Extract `locationToZoneId` utility** (H3) — 5 minutes, removes 3 copies
8. **Extract `endRoomIfNeeded` + `preloadImages`** (H14, H15) — quick wins
9. **Merge `toCardInfo`/`toCardInfoFromPos`** (M2) and `add` helper (M18)
10. **Pre-compute template data** (M29) — replace impure methods with `computed()` signals in board-container

### Phase 3 — Structural refactoring (improves maintainability)

11. **Board template extraction** (H2, H10) — new sub-components for chain badges and field sections
12. **God component decomposition** (H1) — extract AnimationOrchestrator, RoomStateMachine, CardInspection services
13. **Generic `PromptSubComponent<T>`** (H8) — type-safe prompt interface
14. **Duel server session consolidation** (M1) — consolidate 7 Maps into `ActiveDuelSession` or `DuelTimerManager`

### Phase 4 — Security & hardening

15. **Duel server internal auth** (H16) — shared secret header on HTTP endpoints
16. **CORS restriction** (M26) — environment-variable-based origin allowlist
17. **PLAYER_RESPONSE validation** (M28) — schema validation per prompt type before forwarding to worker
18. **`getConnectedUser()` optimization** (M27) — avoid DB hit when only ID is needed

### Phase 5 — Polish

19. **CSS token alignment** (L3, L4, L5, L8, L16, L17, L18)
20. **Spring Boot cleanup** (L7, L9, L13, L14, L15)
21. **Build-time ws-protocol sync** (M22)
22. **Angular lifecycle cleanup** (L22, L23, L24, L25)
23. **Duel server cleanup** (L26, L27)
