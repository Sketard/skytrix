# Story 2.2: Room Browsing & Joining

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to browse available duel rooms and join one with a valid deck,
so that I can find an opponent to duel.

## Acceptance Criteria

1. **Given** the player navigates to `/pvp` (LobbyPageComponent)
   **When** the lobby page loads
   **Then** `GET /api/rooms` returns a list of rooms with status `WAITING` (backend returns up to 10 rooms, sorted by `createdAt` desc, no client-side pagination needed for MVP)
   **And** each room displays: creator name, creation time (relative — e.g., "2 min ago" — computed via custom utility function using `Date.now() - createdAt`, no external date library)
   **And** if no rooms exist: "No rooms available. Create one!" + Create Room button
   **And** a loading `mat-progress-spinner` is shown during fetch
   **And** the room list auto-refreshes every 10 seconds via polling (`interval(10000)`) to detect new rooms; a manual refresh `mat-icon-button` is also available

2. **Given** available rooms are displayed
   **When** the player taps "Join" on a room
   **Then** the system opens a `mat-dialog` deck picker listing the player's saved decklists (fetched via `DeckBuildService.getAllDecks()` — `providedIn: 'root'`, returns `ShortDeck[]` with `{ id, name, urls }`)
   **And** all decklists are shown (no client-side pre-filter — server performs full TCG validation on join)
   **And** if no decklists exist: dialog shows "No decks available" + link to `/deck` deckbuilder, confirm button disabled
   **And** on deck selected + confirm: `POST /api/rooms/:roomCode/join` with decklistId (path param is `roomCode` 6-char code, NOT database UUID — consistent with deep links and `getRoom()` pattern from Story 2-1)
   **And** if server validation fails (422): `mat-snackbar` with error reason (TCG format, banlist, deck size)
   **And** if validation passes (200): response includes `wsToken` + `duelId`
   **And** the player is navigated to `/pvp/duel/:roomCode` — the `DuelPageComponent.fetchRoom()` will detect room status is `CREATING_DUEL` or `ACTIVE` (not `WAITING`) and proceed accordingly (joiner skips the waiting room display, goes straight to duel connection)

3. **Given** the player taps "Join" on a room
   **When** `POST /api/rooms/:roomCode/join` returns 409 (room already full)
   **Then** `mat-snackbar` displays "Room is full" and the room is removed from the displayed list

## Tasks / Subtasks

- [x] Task 1: Extend RoomApiService + Room Types (AC: #1, #2, #3)
  - [x] 1.1 Add `getRooms(): Observable<RoomDTO[]>` to `RoomApiService` — `GET /api/rooms`
  - [x] 1.2 Add `joinRoom(roomCode: string, decklistId: number): Observable<RoomDTO>` — `POST /api/rooms/:roomCode/join`
  - [x] 1.3 Verify `RoomDTO` in `room.types.ts` includes `player1.name`, `createdAt` for display (already defined in Story 2-1)

- [x] Task 2: Build Room List UI in LobbyPageComponent (AC: #1)
  - [x] 2.1 Replace existing "Create Room" stub with full lobby layout: header + room list + CTA
  - [x] 2.2 Implement loading state: `mat-progress-spinner` centered while `getRooms()` in flight
  - [x] 2.3 Implement empty state: "No rooms available. Create one!" text + "Create Room" `mat-raised-button`
  - [x] 2.4 Implement populated state: `@for` loop over rooms, each card showing creator name + relative time + "Join" button
  - [x] 2.5 Add manual refresh button (`mat-icon-button` with `refresh` icon) to re-fetch room list
  - [x] 2.6 Implement auto-refresh: `interval(10000).pipe(switchMap(() => roomApi.getRooms()), catchError(() => EMPTY), takeUntilDestroyed())` updating `rooms` signal — stop polling when a join request is in flight
  - [x] 2.7 State signals: `rooms = signal<RoomDTO[]>([])`, `loading = signal<boolean>(true)`, `error = signal<string | null>(null)`
  - [x] 2.8 Create `relativeTime(date: string): string` utility function — compute "X min ago" / "X h ago" from `Date.now() - new Date(createdAt).getTime()`, no external date library
  - [x] 2.9 Preserve existing "Create Room" navigation (Story 2-1 pattern: navigate to deck-builder where "Duel PvP" creates room)

- [x] Task 3: Implement Deck Selection for Join (AC: #2)
  - [x] 3.1 On "Join" tap: open `mat-dialog` deck picker (simple scrollable list of decklist names)
  - [x] 3.2 Fetch player's saved decklists via `DeckBuildService.getAllDecks()` (`front/src/app/services/deck-build.service.ts`, `providedIn: 'root'`) — returns `Observable<ShortDeck[]>` where `ShortDeck = { id: number, name: string, urls: string[] }`
  - [x] 3.3 Display decklist names in dialog list; if none exist: "No decks available" message + routerLink to `/deck` deckbuilder, confirm button disabled
  - [x] 3.4 On confirm: close dialog with selected `ShortDeck.id`, proceed to join flow (Task 4)

- [x] Task 4: Wire Join Flow with Validation + Navigation (AC: #2, #3)
  - [x] 4.1 On deck selected: call `joinRoom(roomCode, decklistId)` — server handles full validation
  - [x] 4.2 On success (200): navigate to `/pvp/duel/:roomCode` — joiner's `DuelPageComponent.fetchRoom()` will see room status `CREATING_DUEL` or `ACTIVE`, NOT `WAITING` (joiner skips waiting room display, proceeds to duel connection directly)
  - [x] 4.3 On 409 (room full): `mat-snackbar` "Room is full" (3000ms), `rooms.update(list => list.filter(r => r.roomCode !== code))`
  - [x] 4.4 On 422 (deck validation fail): `mat-snackbar` with server-provided error reason (3000ms)
  - [x] 4.5 On other HTTP errors: generic `mat-snackbar` "Failed to join room" (3000ms)
  - [x] 4.6 Show loading indicator on tapped room card during join request (disable "Join" button, show spinner)

- [x] Task 5: Backend Verification (AC: #1, #2, #3)
  - [x] 5.1 Verify `GET /api/rooms` returns only `WAITING` status rooms with `player1` info + `createdAt`, sorted by `createdAt` desc, limited to 10
  - [x] 5.2 Verify `POST /api/rooms/:roomCode/join` uses `roomCode` (6-char code) as path param — NOT database UUID. Accepts `{ decklistId }`, returns updated `RoomDTO` with `wsToken` + `duelId`
  - [x] 5.3 Verify 409 response on already-full room (player2 already set)
  - [x] 5.4 Verify deck validation (TCG format, banlist, 40-60 main, 0-15 extra, 0-15 side) enforced server-side on join, 422 response with error reason in body
  - [x] 5.5 Verify `GET /api/decks` endpoint returns player's decklists (used by `DeckBuildService.getAllDecks()` for deck picker)
  - [x] 5.6 Add/fix any missing backend logic if endpoints don't match expected contract

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store. Match Story 2-1 exactly.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **RxJS → Signal bridge**: `toSignal()` for observables consumed in templates. Keep `Observable` for HTTP calls, convert at component boundary.
- **Error handling**: All errors via existing `SnackbarComponent` pattern (`displaySuccess()`, `displayError()`). User stays on current page.
- **Navigation**: `Router.navigate(['/pvp/duel', roomCode])` — same as Story 2-1 room creation flow.
- **Immutable signal updates**: Never mutate signal arrays. Use `rooms.update(r => r.filter(...))` or `rooms.set([...newArray])`.
- **takeUntilDestroyed()**: Use `DestroyRef` pattern for all subscriptions.

### Critical: Reuse Story 2-1 Patterns

Story 2-1 established authoritative patterns — MUST follow:

| Pattern | Implementation | Source Fix |
|---------|---------------|------------|
| Polling with error recovery | `catchError(() => EMPTY)` inside `switchMap` | C1 fix |
| Loading overlay during async | `MatProgressSpinner` overlay | H1 fix |
| Snackbar before redirect | `displayError()` before any `router.navigate()` on error | H3 fix |
| HTTP error discrimination | Check `err.status` for 404 vs 409 vs generic | L1 fix |
| Snackbar duration | 3000ms for all snackbars (not default 2000ms) | L2 fix |
| User role check | `authService.user().id === room.player1.id` for creator vs visitor | L3 fix |

### Angular Material Components

| Component | Usage |
|-----------|-------|
| `MatProgressSpinner` | Loading state (room list fetch, join request) |
| `MatButton` / `MatRaisedButton` | "Join", "Create Room" buttons |
| `MatIconButton` | Refresh button |
| `MatIcon` | `refresh`, `add`, `error_outline`, `sports_kabaddi` |
| `MatSnackBar` | Error/success via existing SnackbarComponent |
| `MatCard` or custom styled div | Room list items — evaluate fit with lobby aesthetics |
| `MatDialog` | Deck picker dialog (scrollable list of decklist names + confirm/cancel) |

### UX Requirements (from UX Spec)

- **Lobby page**: Normal document flow, scrollable (NOT fixed/fullscreen like duel view)
- **Loading**: `mat-progress-spinner` centered during fetch
- **Empty state**: "No rooms available. Create one!" with prominent Create Room button
- **Room card**: Creator name + relative creation time ("2 min ago") + "Join" button
- **Join flow**: Deck selection prompt → validation → navigation to duel page
- **3-Tap Lobby target**: Room browsing to duel start in ≤3 taps and ≤30 seconds
- **Error snackbars**: 3000ms duration

### Room REST Endpoints (Backend Contract)

| Route | Method | Purpose | Request | Response |
|-------|--------|---------|---------|----------|
| `/api/rooms` | GET | List WAITING rooms | None (backend defaults: limit=10, sort=createdAt desc) | `RoomDTO[]` |
| `/api/rooms/:roomCode/join` | POST | Join room + trigger duel creation | `{ decklistId: number }` | `RoomDTO { roomCode, wsToken, duelId, status }` |
| `/api/decks` | GET | List player's decklists | None (auth via JWT) | `ShortDeckDTO[] { id, name, urls }` |

**Path param note:** All room endpoints use `roomCode` (6-char alphanumeric code), NOT the database UUID. This is consistent with Story 2-1's `getRoom(roomCode)` and deep link pattern `/pvp/duel/:roomCode`.

**Error Responses:**
- **409 Conflict** → Room already full (player2 already set)
- **422 Unprocessable Entity** → Deck validation failed (reason in response body)
- **404 Not Found** → Room doesn't exist or status is ENDED

### Source Tree — Files to Touch

**MODIFY (primary work):**
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.ts` — Full implementation from stub
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.html` — Room list template
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.scss` — Lobby styling
- `front/src/app/pages/pvp/room-api.service.ts` — Add `getRooms()`, `joinRoom()` methods
- `front/src/app/pages/pvp/room.types.ts` — Extend if needed (DecklistSummary, join response)

**REFERENCE (read-only, for pattern matching):**
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Room polling, state management, navigation patterns, joiner vs creator roomState handling
- `front/src/app/services/deck-build.service.ts` — `DeckBuildService` (`providedIn: 'root'`): `getAllDecks(): Observable<ShortDeck[]>` for deck picker
- `front/src/app/core/model/dto/short-deck-dto.ts` — `ShortDeckDTO = { id: number, name: string, urls: string[] }`
- `front/src/app/core/utilities/functions.ts` — Utility functions (snackbar helpers)
- `front/src/app/pages/pvp/room.types.ts` — Existing RoomDTO, PlayerInfo definitions

**DO NOT TOUCH:**
- `duel-page/` sub-components — Complete from Epic 1
- `duel-web-socket.service.ts` — No changes needed
- Backend files — Verify only, fix if contract mismatch

### Project Structure Notes

- **Lobby page**: `front/src/app/pages/pvp/lobby-page/` — exists as stub from Story 2-1, needs full implementation
- **Room API service**: `front/src/app/pages/pvp/room-api.service.ts` — exists with `createRoom()` + `getRoom()`, extend with `getRooms()` + `joinRoom()`
- **Room types**: `front/src/app/pages/pvp/room.types.ts` — exists with `RoomDTO`, `PlayerInfo`, `SHARE_TEXT_TEMPLATE`
- **Route**: `/pvp` → `LobbyPageComponent` already configured (lazy-loaded, Auth guard)
- **Deck picker dialog**: Will likely need a small dialog component (e.g., `deck-picker-dialog.component.ts`) in `lobby-page/` or inline in lobby component via `MatDialog.open()` with a template ref. Evaluate complexity.
- **Relative time utility**: Add `relativeTime()` function to `front/src/app/core/utilities/functions.ts` or as a local helper in lobby component. No external date library.
- Naming conventions: `kebab-case` files, `PascalCase` components, `camelCase` methods/signals

### Previous Story Intelligence (Story 2-1 Learnings)

**What Worked:**
- Two-tier deck validation (client pre-check + server authoritative) — fast feedback for user
- Polling with `catchError(() => EMPTY)` inside `switchMap` — prevents subscription death on transient errors
- Signal-based room state machine — clear transitions, easy to debug
- Web Share API with clipboard fallback — handles all platforms

**What Had Issues (Fixed in Review):**
- C1 CRITICAL: Polling `switchMap` error killed entire subscription → Fixed with inner `catchError`
- H1 HIGH: Missing loading overlay → Added `MatProgressSpinner` during async ops
- H3 HIGH: Silent redirect on null wsToken → Added `displayError()` snackbar before redirect
- M1 MEDIUM: Fullscreen triggered too early → Deferred to `effect()` on `roomState === 'active'`
- L1 LOW: All HTTP errors showed "Room not found" → Discriminate by `err.status`
- L2 LOW: Snackbar 2000ms → Changed to 3000ms for readability
- L3 LOW: No creator/visitor role check → Compare `authService.user().id === room.player1.id`

**Anti-Patterns to AVOID:**
- ❌ Don't mutate signal arrays directly — always `signal.update(arr => [...newArr])`
- ❌ Don't use `subscribe()` in templates — use `toSignal()` or signal-based approach
- ❌ Don't handle errors outside `switchMap` in polling chains
- ❌ Don't navigate without showing error context first (snackbar → then navigate)
- ❌ Don't trigger fullscreen/orientation lock from lobby — only from active duel

### Git Intelligence

**Recent work context:**
- Story 2-1 (room creation) is DONE — all room management patterns established
- Backend endpoints complete for room CRUD (entities, services, controllers, migrations)
- Lobby page currently a minimal stub with "Create Room" CTA button navigating to deck-builder
- `RoomApiService` has `createRoom()` and `getRoom()` — needs `getRooms()` and `joinRoom()`
- `RoomDTO` already includes: `id`, `roomCode`, `status`, `player1`, `player2`, `duelId`, `wsToken`, `createdAt`

**Code conventions observed in Story 2-1:**
- `inject(HttpClient)` for HTTP calls
- `inject(Router)` for navigation
- `inject(MatSnackBar)` for notifications (via shared SnackbarComponent)
- `inject(DestroyRef)` for cleanup
- Signal-first, RxJS for streams only
- `BreakpointObserver` for responsive checks

### Party Mode Review Findings (9 issues — all resolved)

| # | Sev | Reviewer | Issue | Resolution |
|---|-----|----------|-------|------------|
| 1 | MEDIUM | Bob (SM) | Auto-refresh vs manual-only not specified | Added 10s auto-refresh polling in AC #1 + Task 2.6 |
| 2 | HIGH | Bob (SM) | Deck picker format not decided (dialog/sheet/inline) | Decided: `mat-dialog` with scrollable decklist — Task 3.1 |
| 3 | MEDIUM | Bob (SM) | Validation pre-filter vs on-join unclear | Clarified: all decklists shown, server validates on join (AC #2) |
| 4 | LOW | Winston (Arch) | GET /api/rooms contract under-specified (sort, limit) | Added: backend returns 10 rooms sorted `createdAt` desc (AC #1) |
| 5 | HIGH | Winston (Arch) | :roomCode vs :id path param inconsistency | Harmonized: all endpoints use `roomCode` (6-char code) — AC #2, Task 5.2 |
| 6 | MEDIUM | Winston (Arch) | Deck service exact path not identified | Identified: `DeckBuildService` at `services/deck-build.service.ts`, `providedIn: 'root'` — Task 3.2 |
| 7 | MEDIUM | Amelia (Dev) | Relative time utility missing | Added: Task 2.8 for custom `relativeTime()` utility function |
| 8 | MEDIUM | Amelia (Dev) | Joiner initial roomState not documented | Clarified in AC #2 + Task 4.2: joiner sees `CREATING_DUEL`/`ACTIVE`, skips waiting room |
| 9 | MEDIUM | Amelia (Dev) | Decklist endpoint not verified | Added: Task 5.5 to verify `GET /api/decks` endpoint |

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md#Story 2.2: Room Browsing & Joining]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md#Room REST Endpoints]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md#Room Management Architecture]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md#Component Structure & File Organization]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Lobby Flow & Room Management]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Lobby Page Design]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md#FR3: Browse & Join Rooms]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md#FR2: Deck Validation]
- [Source: _bmad-output/implementation-artifacts/2-1-room-creation-from-decklist.md#Dev Notes]
- [Source: _bmad-output/implementation-artifacts/2-1-room-creation-from-decklist.md#Senior Developer Review]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation, no debug cycles required.

### Completion Notes List

- **Task 1**: Added `getRooms()` and `joinRoom()` to `RoomApiService`. `RoomDTO` already had all required fields (`player1.username`, `createdAt`).
- **Task 2**: Full lobby UI: loading spinner, empty state with CTA, populated room list with `@for`, manual refresh button, 10s auto-polling with `interval(10000)` + `switchMap` + inner `catchError(() => EMPTY)` + `takeUntilDestroyed()`. Polling pauses during join requests via `filter()`.
- **Task 2.8**: `relativeTime()` utility added to `core/utilities/functions.ts` — computes "just now" / "X min ago" / "X h ago" / "X d ago".
- **Task 3**: Created `DeckPickerDialogComponent` as standalone inline-template dialog. Fetches decks via `DeckBuildService.getAllDecks()`, shows scrollable list with selection highlight. Empty state shows "No decks available" + routerLink to deck builder. Confirm button disabled until selection.
- **Task 4**: Join flow wired in `LobbyPageComponent.joinRoom()`. HTTP error discrimination: 409 → "Room is full" + remove from list, 422 → server error message, other → generic message. Loading spinner on join button, all buttons disabled during join. Navigation to `/pvp/duel/:roomCode` on success.
- **Task 5 — Backend fixes**: 4 contract mismatches found and fixed:
  1. `POST /rooms/{id}/join` → `POST /rooms/{roomCode}/join` (roomCode path param)
  2. Added `findByRoomCodeForUpdate()` with pessimistic lock in `RoomRepository`
  3. Proper HTTP status codes: 409 (room full/own room), 422 (deck not found/not owned), 404 (room not found)
  4. Added `.limit(10)` to `listOpenRooms()` query
- **Note on 5.4**: TCG format/banlist validation is delegated to OCGCore duel server during duel creation (not a pre-check on join). ~~Invalid decks would cause duel creation failure → 503 rollback to WAITING. Explicit 422 pre-validation covers deck existence and ownership.~~ **[Review fix H1]**: Added server-side deck size validation (40-60 main, 0-15 extra, 0-15 side) returning 422. TCG format/banlist validation still delegated to OCGCore.

### File List

**Frontend (modified):**
- `front/src/app/pages/pvp/room-api.service.ts` — Added `getRooms()`, `joinRoom()` methods
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.ts` — Full implementation from stub
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.html` — Room list template with loading/empty/populated states
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.scss` — Lobby styling (document flow, responsive)
- `front/src/app/core/utilities/functions.ts` — Added `relativeTime()` utility

**Frontend (new):**
- `front/src/app/pages/pvp/lobby-page/deck-picker-dialog.component.ts` — Deck picker MatDialog component

**Backend (modified):**
- `back/src/main/java/com/skytrix/controller/RoomController.java` — Join endpoint: `{id}` → `{roomCode}`
- `back/src/main/java/com/skytrix/service/RoomService.java` — `joinRoom(String roomCode, ...)`, proper HTTP status codes, deck size validation, DB-level limit 10
- `back/src/main/java/com/skytrix/repository/RoomRepository.java` — Added `findByRoomCodeForUpdate()`, `findTop10ByStatusOrderByCreatedAtDesc()`

## Change Log

- **2026-02-27**: Implemented Story 2.2 — Room Browsing & Joining. Full lobby UI with room list, auto-polling, deck picker dialog, join flow with error handling. Fixed 4 backend contract mismatches (roomCode path param, HTTP status codes, pessimistic lock, limit 10).
- **2026-02-27 [Code Review]**: 10 findings (3H, 4M, 3L). Fixed: H1 (deck size validation server-side), H2 (DB-level LIMIT via findTop10), H3 (documented for post-MVP refactor), M2 (deck picker error state + retry), M3 (refresh error shows snackbar instead of nuking room list), M4 (DeckBuildService direct injection in dialog), L1 (relativeTime null guard). Remaining LOW: L2 (File List accuracy), L3 (no join timeout).
