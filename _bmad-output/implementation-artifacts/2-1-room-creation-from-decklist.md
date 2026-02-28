# Story 2.1: Room Creation from Decklist

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to create a PvP duel room from any valid decklist,
So that I can invite a friend to duel with my prepared deck.

## Acceptance Criteria

### AC1-3: Deck Validation & Room Creation

**Given** the player is inside the deck builder (editing a saved deck)
**When** they tap "Duel PvP" in the deck builder's `mat-menu` (same menu as "Simulateur")
**Then** the client performs a **pre-check** (main deck 40–60, extra 0–15, side 0–15)
**And** if pre-check fails: `mat-snackbar` with size error (player stays in deck builder to fix)
**And** if pre-check passes: a loading overlay/spinner is shown and `POST /api/rooms` with `decklistId` is called
**And** the server performs **full validation** (TCG format, TCG banlist, size constraints)
**And** if server rejects (4xx): `mat-snackbar` with server error reason; loading overlay dismissed (player stays in deck builder to fix)
**And** if server accepts (201): the player is navigated to `/pvp/duel/:roomCode` (waiting room state)

### AC4-5: Waiting Room Display & Polling

**Given** the room is created
**When** the waiting room state renders
**Then**:
- A 6-character room code is displayed prominently (large monospace font)
- A "Copy Link" button copies the deep link to clipboard with `mat-snackbar` "Link copied!" confirmation
- On mobile: a "Share" button triggers Web Share API native share sheet with text `"Duel me on skytrix! Join: <url>"`; falls back to clipboard copy if unavailable
- A `mat-progress-spinner` (indeterminate) + "Waiting for opponent..." is displayed
- A **countdown timer** displays remaining time before room expires (server `createdAt` + 30 minutes); color: green (>60s) → yellow (≤60s) → red (≤30s)
- The component polls `GET /api/rooms/:roomCode` every 3 seconds to detect opponent join
- When poll returns status `CREATING_DUEL` → UI shows "Preparing duel..." (transitional, max 5s)
- When poll returns status `ACTIVE` → the page transitions to WebSocket connection and duel state
- A "Leave Room" button navigates to `/pvp` (no API call — orphaned room cleanup scheduler handles expiration after 30 minutes)

## Tasks / Subtasks

- [x] Task 1 — Add "Duel PvP" entry in deck builder `mat-menu` (AC: #1-3)
  - [x] 1.1 In `DeckBuilderComponent` (`front/src/app/pages/deck-page/components/deck-builder/`): add a `mat-menu-item` "Duel PvP" right after the existing "Simulateur" entry (line 99-102 of `deck-builder.component.html`)
  - [x] 1.2 Use icon `swords` (or `sports_kabaddi`), same `[disabled]="!deckBuildService.deck().id"` guard as Simulateur
  - [x] 1.3 Wire click to `navigateToPvp()` method that runs validation + room creation
- [x] Task 2 — Create `RoomApiService` and `RoomDTO` type (AC: #1-5)
  - [x] 2.1 Create `front/src/app/pages/pvp/room.types.ts` — define `RoomDTO` interface matching backend shape (see Dev Notes)
  - [x] 2.2 Create `front/src/app/pages/pvp/room-api.service.ts` — `providedIn: 'root'` service
  - [x] 2.3 Implement `createRoom(decklistId: number): Observable<RoomDTO>` — POST /api/rooms
  - [x] 2.4 Implement `getRoom(roomCode: string): Observable<RoomDTO>` — GET /api/rooms/:roomCode (for polling)
- [x] Task 3 — Implement deck validation + room creation flow (AC: #1-3)
  - [x] 3.1 Client pre-check: validate deck size (40–60 main, 0–15 extra, 0–15 side) using `DeckBuildService.deck()` data (already loaded in deck builder)
  - [x] 3.2 On pre-check fail → `mat-snackbar` with size error (user is already in deckbuilder, no navigation needed)
  - [x] 3.3 On pre-check pass → show loading overlay/spinner, call `roomApiService.createRoom(decklistId)`
  - [x] 3.4 On server 4xx → dismiss loading, `mat-snackbar` with server error reason (user is already in deckbuilder)
  - [x] 3.5 On server 201 → `router.navigate(['/pvp/duel', response.roomCode])`
- [x] Task 4 — Implement waiting room state in `DuelPageComponent` (AC: #4-5)
  - [x] 4.1 Add `roomState` signal: `'loading' | 'waiting' | 'creating-duel' | 'connecting' | 'active' | 'error'`
  - [x] 4.2 Split existing `fetchRoomAndConnect()` into `fetchRoom()` (GET room) + `connectWhenReady()` (WebSocket)
  - [x] 4.3 If room status is `WAITING` and current user is player1 → set `roomState('waiting')`, start polling
  - [x] 4.4 If room status is `CREATING_DUEL` → set `roomState('creating-duel')`, show "Preparing duel...", continue polling
  - [x] 4.5 If room status is `ACTIVE` → set `roomState('connecting')`, proceed to `connectWhenReady()` (existing WS flow)
  - [x] 4.6 If room not found (404) or `ENDED` → redirect to `/pvp` with snackbar "Room not found or already ended"
- [x] Task 5 — Implement waiting room UI (AC: #4-5)
  - [x] 5.1 Create waiting room template section in duel-page (conditionally shown via `@if (roomState() === 'waiting')`)
  - [x] 5.2 Display room code prominently (large monospace font, centered)
  - [x] 5.3 Display player's deck name (from room fetch response or route state)
  - [x] 5.4 Add "Copy Link" button using `Clipboard` from `@angular/cdk/clipboard` → `mat-snackbar` "Link copied!" (3s)
  - [x] 5.5 Add "Share" button (visible only when `navigator.share` available): share text = `SHARE_TEXT_TEMPLATE` constant with room URL interpolated
  - [x] 5.6 Add `mat-progress-spinner` (indeterminate) + "Waiting for opponent..." text
  - [x] 5.7 Add countdown timer: compute remaining time from `room.createdAt` + 30min; display mm:ss; color: green (>60s), yellow (≤60s), red (≤30s)
  - [x] 5.8 Add "Leave Room" button (secondary style) → `router.navigate(['/pvp'])` — no API call, orphaned room cleanup handles it
  - [x] 5.9 When `roomState() === 'creating-duel'` → replace spinner text with "Preparing duel..."
- [x] Task 6 — Implement opponent polling (AC: #5)
  - [x] 6.1 Start polling `roomApiService.getRoom(roomCode)` every 3s when `roomState()` is `'waiting'` or `'creating-duel'`
  - [x] 6.2 Use `interval(3000).pipe(switchMap(...), takeUntilDestroyed())` — cancel on destroy
  - [x] 6.3 On each poll response: update `roomState` based on `response.status` (WAITING → waiting, CREATING_DUEL → creating-duel, ACTIVE → connecting)
  - [x] 6.4 When `ACTIVE` detected → stop polling, call `connectWhenReady()` with wsToken from response
  - [x] 6.5 Handle polling errors: retry silently up to 3 consecutive failures, then show error state
- [x] Task 7 — Update lobby page with minimal navigation (AC: #1)
  - [x] 7.1 Replace stub "Coming Soon" with basic layout: title "PvP Lobby" + "Create Room" button → `router.navigate(['/decks'])` to select a deck
  - [x] 7.2 Ensure back navigation from duel page waiting room returns to `/pvp` lobby

## Dev Notes

### Critical Context: Backend Already Implemented

**ALL backend code for room management is already complete and committed.** Do NOT create or modify any backend files. The following exist and are ready to use:

| Backend Component | File | Status |
|-------------------|------|--------|
| Room Entity | `back/src/.../model/entity/Room.java` | ✅ Done |
| Room Status Enum | `back/src/.../model/enums/RoomStatus.java` | ✅ Done (WAITING, CREATING_DUEL, ACTIVE, ENDED) |
| Room DTOs | `back/src/.../model/dto/room/*.java` | ✅ Done (RoomDTO, CreateRoomDTO, JoinRoomDTO, DuelCreationResponse, DuelDeckDTO) |
| Room Repository | `back/src/.../repository/RoomRepository.java` | ✅ Done |
| Room Service | `back/src/.../service/RoomService.java` | ✅ Done |
| Room Controller | `back/src/.../controller/RoomController.java` | ✅ Done |
| Room Mapper | `back/src/.../mapper/RoomMapper.java` | ✅ Done |
| Duel Server Client | `back/src/.../service/DuelServerClient.java` | ✅ Done |
| Room Cleanup Scheduler | `back/src/.../scheduler/RoomCleanupScheduler.java` | ✅ Done |
| Flyway Migration | `back/src/.../db/migration/flyway/V008__create_room_table.sql` | ✅ Done |

**Backend API endpoints available:**
- `POST /api/rooms` — Body: `{ decklistId: number }` → Returns `RoomDTO` (201)
- `GET /api/rooms` — Returns `RoomDTO[]` of WAITING rooms (200)
- `GET /api/rooms/:roomCode` — Returns `RoomDTO` with wsToken for authenticated user (200)
- `POST /api/rooms/:id/join` — Body: `{ decklistId: number }` → Returns `RoomDTO` (200)
- `POST /api/rooms/:id/end` — Marks room ENDED (200)

**RoomDTO shape (for TypeScript interface):**
```
{
  id: number,
  roomCode: string,
  status: 'WAITING' | 'CREATING_DUEL' | 'ACTIVE' | 'ENDED',
  player1: { id: number, username: string },
  player2: { id: number, username: string } | null,
  duelId: string | null,
  wsToken: string | null,  // Only populated for the requesting user
  createdAt: string         // ISO datetime
}
```

**Room code generation:** `UUID.randomUUID().toString().substring(0,6).toUpperCase()` — excludes confusing chars (O, I, l, 0). 6 chars, URL-safe, non-sequential.

### Deck Validation Strategy (Two-Tier)

**Client pre-check (fast, offline):** Deck size constraints only (40–60 main, 0–15 extra, 0–15 side). Uses data already available in `DeckBuildService`. Purpose: instant user feedback without server round-trip.

**Server full validation (authoritative):** `RoomService.createRoom()` validates TCG format compliance, TCG banlist compliance, AND size constraints. If server rejects, the response includes error reason. Client must display the server error in a snackbar — do NOT assume client pre-check is sufficient.

### Existing Frontend Code to Reuse/Extend

**DeckBuilderComponent** (`front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts`) — **SOLE ENTRY POINT for PvP:**
- Same pattern as solo simulator: `mat-menu` contains "Simulateur" entry at line 99-102 of template
- **Add** a "Duel PvP" `mat-menu-item` right after "Simulateur" in the same `mat-menu`
- Existing `navigateToSimulator()` method (line 351-354) navigates to `/decks/:id/simulator` — create analogous `navigateToPvp()` that validates + creates room + navigates to `/pvp/duel/:roomCode`
- Already has `inject(MatSnackBar)`, `inject(Router)`, `inject(DeckBuildService)` — all needed for validation + navigation
- `[disabled]="!deckBuildService.deck().id"` guard ensures deck is saved before PvP (same as Simulateur)

**DuelPageComponent** (`front/src/app/pages/pvp/duel-page/duel-page.component.ts`):
- Already has `fetchRoomAndConnect()` which calls `GET /api/rooms/:roomCode` and extracts wsToken
- Already has `connectionStatus` signal and retry logic
- **Refactor:** Split `fetchRoomAndConnect()` into `fetchRoom()` + `connectWhenReady()` to insert waiting room state between fetch and connect
- Add `roomState` signal — keep it as the ONLY new signal to avoid God Component bloat

**LobbyPageComponent** (`front/src/app/pages/pvp/lobby-page/`):
- Currently a stub: `<h1>PvP Lobby</h1><p>Coming Soon</p>`
- Replace with minimal layout: title + "Create Room" CTA navigating to deck selection

**Routes** (`front/src/app/app.routes.ts`):
- `/pvp` → LobbyPageComponent (lazy-loaded, auth-guarded) ✅
- `/pvp/duel/:roomCode` → DuelPageComponent (lazy-loaded, auth-guarded) ✅

**Environment** (`front/src/environments/environment.ts`):
- `apiUrl: 'http://localhost:8080/api'` — base URL for HTTP calls
- `wsUrl: 'ws://localhost:3001'` — WebSocket URL

### Angular Patterns to Follow (Enforced)

1. **Standalone components** — No NgModule declarations
2. **Signal-based state** — All state via `signal()` / `computed()`, no BehaviorSubject
3. **OnPush change detection** — Mandatory for all new components
4. **`[class.specific-class]` binding** — NEVER use `[class]` (wipes base CSS classes; recurring Epic 1 bug)
5. **Touch targets ≥ 44px** — All interactive elements
6. **`prefers-reduced-motion`** — Respect with 0ms transitions
7. **ARIA attributes** — On all interactive elements
8. **Signal inputs/outputs** — Use `input()` / `output()` (not `@Input` / `@Output` decorators)
9. **`takeUntilDestroyed()`** — For all subscriptions in components
10. **`inject()`** — Use `inject()` function (not constructor injection)

### UX Specifications

**Entry Flow (same as Simulator pattern):**
1. Player opens a deck in deck builder → taps `mat-menu` → taps "Duel PvP"
2. Client pre-checks deck size → POST /api/rooms → room code generated
3. Navigate to `/pvp/duel/:roomCode` → waiting room renders

**Waiting Room Layout (Mobile-First):**
```
┌──────────────────────────────────────┐
│         WAITING FOR OPPONENT          │
│                                      │
│  Your Deck: [Deck Name]              │
│  Room Code: [ABCDEF]  (large mono)   │
│                                      │
│  [Share Code]  [Copy Link]           │
│                                      │
│  ⏳ Waiting for opponent...           │
│     (mat-progress-spinner)           │
│                                      │
│  ⏱ 28:45  (countdown, green/yellow/  │
│            red based on remaining)    │
│                                      │
│  [Leave Room]                        │
└──────────────────────────────────────┘
```

**Transitional State (CREATING_DUEL):**
```
┌──────────────────────────────────────┐
│         PREPARING DUEL...             │
│                                      │
│     (mat-progress-spinner)           │
│                                      │
│  Opponent joined! Setting up duel... │
└──────────────────────────────────────┘
```

**Sharing Constants (define in `room.types.ts`):**
```typescript
export const SHARE_TEXT_TEMPLATE = (roomCode: string, baseUrl: string) =>
  `Duel me on skytrix! Join with code: ${roomCode} or tap: ${baseUrl}/pvp/duel/${roomCode}`;
```
- Mobile: `navigator.share({ title: 'skytrix PvP Duel', text: SHARE_TEXT_TEMPLATE(code, url) })`
- Desktop fallback: `Clipboard.copy(roomUrl)` + snackbar "Link copied!"
- Feature detection: `if (navigator.share)` shows Share button, clipboard always available
- Both require HTTPS (or localhost in dev)

**Countdown Timer:**
- Computed from `room.createdAt` (ISO string) + 30 minutes (matches `RoomCleanupScheduler` timeout)
- Display `mm:ss` format, update every second via `interval(1000)`
- Colors: green (>60s remaining), yellow (≤60s), red (≤30s)
- When timer reaches 0 → snackbar "Room expired" → redirect to `/pvp`

**Snackbar Patterns:**
- Client validation error: `mat-snackbar` with size error (player already in deck builder)
- Server validation error: `mat-snackbar` with server error reason (player already in deck builder)
- Link copied: `mat-snackbar` "Link copied!" duration 3000ms
- Room not found: `mat-snackbar` "Room not found or already ended" → redirect to `/pvp`
- Room expired: `mat-snackbar` "Room expired" → redirect to `/pvp`

### Epic 1 Learnings (Apply Here)

1. **No `[class]` binding** — Use `[class.waiting-state]="roomState() === 'waiting'"` pattern
2. **Touch targets ≥ 44px** — Share, Copy, Leave buttons must comply
3. **No new dependencies** — Use existing Angular Material + CDK (Clipboard module is in CDK)
4. **`Clipboard` from `@angular/cdk/clipboard`** — Already available, use `Clipboard.copy(text)` service
5. **Critical remediation items from Story 1.8:**
   - C1 (Player reindexing): Not relevant to this story but be aware
   - C2 (RPS dead code): Will be addressed in Story 2.3
   - C3 (WS reconnection): Already fixed in existing duel-page code (SESSION_TOKEN flow)
   - H1 (Room lifecycle): Already fixed — duel-page calls POST /rooms/:id/end on DUEL_END
6. **DuelPageComponent is a God Component (~20 signals)** — Do NOT add excessive signals. Keep waiting room state minimal (`roomState` signal only).

### File Structure

**New files to create:**
```
front/src/app/pages/pvp/
├── room-api.service.ts          # NEW: Angular HTTP service for /api/rooms
├── room.types.ts                # NEW: RoomDTO interface + SHARE_TEXT_TEMPLATE constant
└── lobby-page/
    ├── lobby-page.component.ts   # MODIFY: Replace stub with basic layout
    ├── lobby-page.component.html # MODIFY: Add create room CTA
    └── lobby-page.component.scss # MODIFY: Add styles
```

**Files to modify:**
```
front/src/app/pages/deck-page/components/deck-builder/
├── deck-builder.component.ts         # MODIFY: Add navigateToPvp() + inject RoomApiService
└── deck-builder.component.html       # MODIFY: Add "Duel PvP" mat-menu-item after "Simulateur"

front/src/app/pages/pvp/duel-page/
└── duel-page.component.ts/html/scss  # MODIFY: Add waiting room state + UI + polling + countdown
```

### Testing Standards

- **No automated tests** — "Big bang" approach per project convention
- **Manual verification:** Test room creation, code sharing, polling, opponent detection, and navigation flow end-to-end with two browser tabs
- **Edge cases to verify manually:**
  - Invalid deck (size) → client pre-check snackbar, stays in deck builder
  - Invalid deck (banlist) → server rejects → snackbar with server error, stays in deck builder
  - Room code copy on desktop → clipboard has correct full URL
  - Share on mobile → native share sheet opens with correct text/URL
  - Leave room → navigates to `/pvp`, room still exists (30-min cleanup handles it)
  - Polling detects opponent → status transitions WAITING → CREATING_DUEL → ACTIVE → WebSocket connect
  - CREATING_DUEL state → UI shows "Preparing duel..." briefly (max 5s)
  - Navigate directly to `/pvp/duel/INVALID` → redirect to `/pvp` with snackbar
  - Countdown timer reaches 0 → snackbar "Room expired" → redirect to `/pvp`
  - Polling error (3 consecutive failures) → error state displayed

### Project Structure Notes

- All PvP code lives under `front/src/app/pages/pvp/` (feature-scoped lazy-loaded module pattern)
- Backend code is under standard Spring Boot package structure: `com.skytrix.{controller,service,model,repository,mapper,scheduler}`
- Environment-specific URLs in `front/src/environments/`
- No shared types package between frontend and backend — TypeScript interfaces manually mirror Java DTOs

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md — Epic 2, Story 2.1]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md — REST API, Room State Machine, Frontend State Flow]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md — Journey 1: Lobby Flow, Waiting Room]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md — FR1, FR2]
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-02-27.md — Angular Dev Checklist]
- [Source: _bmad-output/implementation-artifacts/1-8-epic1-cross-story-coherence-remediation.md — Remediation Items]
- [Source: _bmad-output/implementation-artifacts/epic-1-cross-story-adversarial-review.md — 12 Findings]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- No blocking issues encountered. Build passed on first attempt after all tasks completed.

### Completion Notes List

- **Task 1**: Added "Duel PvP" `mat-menu-item` with `sports_kabaddi` icon in deck builder, same disabled guard as Simulateur
- **Task 2**: Created `RoomDTO` interface (mirrors Java DTO), `PlayerInfo` interface, `SHARE_TEXT_TEMPLATE` constant, and `RoomApiService` (providedIn root) with `createRoom()` and `getRoom()` methods
- **Task 3**: Implemented `navigateToPvp()` in DeckBuilderComponent with client-side pre-check (40-60 main, 0-15 extra, 0-15 side), loading signal, server error handling via snackbar, and navigation to `/pvp/duel/:roomCode` on success
- **Task 4**: Refactored DuelPageComponent — replaced `fetchRoomAndConnect()` with `fetchRoom()` + `handleRoomStatus()` + `connectWhenReady()`. Added `roomState` signal with 6 states. Room status WAITING/CREATING_DUEL starts polling, ACTIVE connects WS, ENDED/404 redirects with snackbar
- **Task 5**: Waiting room UI with room code (large monospace), Copy Link (CDK Clipboard), Share (Web Share API with fallback), mat-progress-spinner, countdown timer (mm:ss with green/yellow/red color transitions), Leave Room button. Creating-duel transitional state shows "Preparing duel..." text. Loading and error states included. All duel UI gated behind `@if (roomState() === 'active' || roomState() === 'connecting')`
- **Task 6**: Polling via `interval(3000).pipe(takeUntil(stopPolling$), takeUntilDestroyed(), switchMap(...))`. Updates roomState on each poll. Stops polling on ACTIVE (triggers WS connect) or ENDED. 3 consecutive errors trigger error state. Countdown effect auto-expires room after 30 minutes
- **Task 7**: Replaced lobby stub with "Create Room" button navigating to `/decks`. Leave Room navigates back to `/pvp`

### File List

**New files:**
- `front/src/app/pages/pvp/room.types.ts`
- `front/src/app/pages/pvp/room-api.service.ts`

**Modified files:**
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.html`
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.ts`
- `front/src/app/pages/deck-page/components/deck-builder/deck-builder.component.scss`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss`
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.ts`
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.html`
- `front/src/app/pages/pvp/lobby-page/lobby-page.component.scss`
- `front/src/app/core/utilities/functions.ts`

## Senior Developer Review (AI)

**Reviewer:** Claude Opus 4.6 | **Date:** 2026-02-27 | **Outcome:** Approved (all issues fixed)

**9 findings identified and fixed:**

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| C1 | CRITICAL | Polling `switchMap` error kills interval subscription — first HTTP error permanently stops polling | Moved error handling inside `switchMap` with `catchError(() => EMPTY)` |
| H1 | HIGH | `pvpLoading` signal exists but no loading overlay in deck builder template | Added `MatProgressSpinner` overlay in deck-builder template + SCSS |
| H2 | HIGH | "Your Deck" displays `player1.username` instead of deck name | Pass `deckName` via route state from `navigateToPvp()`, display with fallback |
| H3 | HIGH | `connectWhenReady()` silently redirects when `wsToken` is null | Added `displayError` snackbar before redirect |
| M1 | MEDIUM | Fullscreen + landscape lock triggered during waiting room | Deferred `requestFullscreenAndLock()` to effect on `roomState === 'active'` |
| M2 | MEDIUM | `prefers-reduced-motion` CSS rule doesn't reach spinner internals | Target `::ng-deep .mdc-circular-progress__*` classes |
| L1 | LOW | `fetchRoom` catch-all shows "Room not found" for all HTTP errors | Distinguish 404 from other errors via `err.status` |
| L2 | LOW | "Link copied!" snackbar duration 2000ms vs spec 3000ms | Added optional `duration` param to `displaySuccess`, pass 3000 |
| L3 | LOW | No creator vs visitor role check in `handleRoomStatus` | Check `authService.user().id === room.player1.id` before showing waiting room |

## Change Log

- **2026-02-27**: Story 2.1 implementation — Room creation from decklist. Added PvP entry point in deck builder, room API service, deck validation, waiting room with polling/countdown/sharing, and lobby page update. All 7 tasks completed.
- **2026-02-27**: Code review — 9 findings (1C, 3H, 2M, 3L) all fixed. Critical polling bug, missing loading overlay, deck name display, error messages, fullscreen timing, reduced-motion, role check.
