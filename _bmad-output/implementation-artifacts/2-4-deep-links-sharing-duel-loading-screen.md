# Story 2.4: Deep Links, Sharing & Duel Loading Screen

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to share a room link easily and see a loading screen while the duel prepares,
So that my friend can join instantly and I'm never confused by a blank screen.

## Acceptance Criteria

### ~~AC1: Web Share API (Mobile Share Sheet) — ALREADY DONE (Story 2.1)~~

> **No work needed.** `shareRoom()`, `copyRoomLink()`, `canShare` flag, Share/Copy buttons in template, and `SHARE_TEXT_TEMPLATE` were all delivered in Story 2.1. Verify during Task 6 (manual verification) that they still work correctly.

### AC2: Deep Link — Authentication & Join Flow

**Given** a player opens a deep link `/pvp/duel/:roomCode`
**When** they are not authenticated
**Then** they are redirected to login with `returnUrl` query param preserving the original deep link
**And** post-login, they are automatically redirected back to `/pvp/duel/:roomCode`
**When** they are authenticated and NOT yet a participant in the room
**Then** they are prompted with `DeckPickerDialogComponent` to select a deck, then join the room
**When** they are authenticated and already a participant (creator or joiner)
**Then** they reconnect directly to their existing session (WAITING → waiting room, ACTIVE → WebSocket connect)

### AC3: Deep Link — Room Not Found or Ended

**Given** a player opens a deep link `/pvp/duel/:roomCode`
**When** the room does not exist or its status is `ENDED`
**Then** the player is redirected to `/pvp` (lobby) with `mat-snackbar` "Room not found or already ended"

### AC4: Duel Loading Screen

**Given** both players have joined and RPS is resolved
**When** the duel is initializing
**Then** a duel loading screen displays: both player names + LP (8000 vs 8000) + "Preparing duel..." + `mat-progress-spinner` (indeterminate, 64px)
**And** the client pre-fetches card thumbnails for the player's **own deck only** (card IDs from submitted decklist; opponent thumbnails fetched on-demand per NFR6)
**And** the loading screen holds until first board state arrives from server AND critical thumbnails are pre-cached
**And** if a thumbnail fails to load: card back is used as fallback
**And** if 15 seconds pass without first board state arriving: display "Taking longer than expected..." + "Return to lobby" button

## Tasks / Subtasks

- [x] Task 1: Auth guard returnUrl support (AC: #2)
  - [x] 1.1 Modify `AuthService.canActivate()` to pass `returnUrl: state.url` as query param when redirecting to `/login`
  - [x] 1.2 Modify login page component to read `returnUrl` from `ActivatedRoute.snapshot.queryParams` and redirect there post-login instead of default `/decks`
  - [x] 1.3 Ensure `returnUrl` only accepts internal paths (starts with `/`) — never external URLs (XSS prevention)
  - [x] 1.4 Verify default login redirect still works when `returnUrl` is absent (existing routes like `/decks`, `/search` must not break)

- [x] Task 2: Deep link join flow in DuelPageComponent (AC: #2, #3)
  - [x] 2.1 In `handleRoomStatus()` WAITING case: remove the `isCreator` gate that redirects non-creators away
  - [x] 2.2 When user lands on WAITING room and is NOT a participant (neither player1 nor player2): open `DeckPickerDialogComponent`, on confirm call `RoomApiService.joinRoom(roomCode, decklistId)`, on success update `room` signal with response
  - [x] 2.3 When user lands on WAITING room and IS a participant (creator or already joined): show waiting room as-is (existing behavior)
  - [x] 2.4 Handle edge cases: dialog dismissed (cancel) → redirect to lobby; joinRoom 409 (room full) → snackbar + redirect to lobby; joinRoom 422 (deck invalid) → snackbar, re-open dialog. **Anti-leak pattern**: use `dialogRef.afterClosed().pipe(switchMap(...))` — do NOT nest subscriptions when re-opening dialog on 422
  - [x] 2.5 `fetchRoom()` 404 error already redirects to lobby with snackbar — verify ENDED status also redirects (already implemented)

- [x] Task 3: Duel loading screen (AC: #4)
  - [x] 3.1 Add new `RoomState` value: `'duel-loading'`
  - [x] 3.2 In the `boardReady` effect: instead of directly transitioning `'connecting'` → `'active'`, transition `'connecting'` → `'duel-loading'`. **Critical timing guard**: only transition when `!wsService.rpsResult()` — do NOT enter loading screen while RPS result overlay is still displayed (3s auto-dismiss). The condition must be: `boardReady() && !wsService.rpsResult() && roomState() === 'connecting'`
  - [x] 3.3 Add `duelLoadingReady` computed signal: `true` when first BOARD_STATE received AND own deck thumbnails pre-cached (or all failed with fallback)
  - [x] 3.4 Add effect: when `duelLoadingReady()` is true and roomState is `'duel-loading'` → transition to `'active'`
  - [x] 3.5 Add template section for `'duel-loading'` state: player names (from `room()` signal), LP 8000 vs 8000, "Preparing duel..." text, `mat-progress-spinner` (indeterminate, 64px)
  - [x] 3.6 Add SCSS for loading screen (centered, full-viewport, dark background, same style as waiting room)

- [x] Task 4: Card thumbnail pre-fetching (AC: #4)
  - [x] 4.1 Create `preFetchOwnDeckThumbnails()` method: use card codes from the player's own deck (available from the `duelState` first BOARD_STATE — own hand + deck zone card IDs, or extract from the submitted decklist ID via a new endpoint / stored client-side)
  - [x] 4.2 Strategy: use `Image()` constructor to pre-load thumbnails, track completion via Promise.allSettled()
  - [x] 4.3 Set `thumbnailsReady` signal to `true` when all promises settle (success or failure — failures use card back fallback)
  - [x] 4.4 Use `getCardImageUrlByCode()` from `pvp-card.utils.ts` for URL generation (already exists)

- [x] Task 5: 15-second loading timeout (AC: #4)
  - [x] 5.1 Start a 15s timer when entering `'duel-loading'` state
  - [x] 5.2 If timer fires before `duelLoadingReady()`: show "Taking longer than expected..." message + "Return to lobby" button
  - [x] 5.3 Store timeout ref, clear on destroy and on successful transition to `'active'`

- [ ] Task 6: Manual verification
  - [ ] 6.1 Verify: unauthenticated deep link → login → redirect back → deck picker → join → duel
  - [ ] 6.2 Verify: authenticated deep link to WAITING room (non-participant) → deck picker → join
  - [ ] 6.3 Verify: authenticated deep link to ACTIVE room (participant) → connects directly
  - [ ] 6.4 Verify: deep link to non-existent/ENDED room → snackbar + lobby redirect
  - [ ] 6.5 Verify: loading screen shows player names + LP + spinner after RPS
  - [ ] 6.6 Verify: loading screen transitions to board when board state + thumbnails ready
  - [ ] 6.7 Verify: 15s timeout shows fallback message with "Return to lobby" button
  - [ ] 6.8 Verify: Web Share API on mobile triggers native share sheet (Story 2.1 — already done)
  - [ ] 6.9 Verify: share fallback (clipboard) works on desktop (Story 2.1 — already done)

## Dev Notes

### Architecture Patterns & Constraints

- **Signal-based state**: All component state via `signal()`, `computed()`, `effect()`. No global store.
- **Standalone components**: `standalone: true`, `ChangeDetectionStrategy.OnPush`, modern `inject()` DI pattern.
- **Angular 19 control flow**: `@if`, `@for`, `@switch` — NOT `*ngIf`/`*ngFor`.
- **Immutable signal updates**: Never mutate signal arrays/objects — always `.set()` or `.update()` with new reference.
- **`[class.specific-class]` binding**: NEVER use `[class]` (wipes base CSS classes — recurring Epic 1 bug).
- **`takeUntilDestroyed()`**: Use `DestroyRef` pattern for all subscriptions.
- **`effect()` with `untracked()`**: For all side effects (navigation, timers, HTTP calls). Same pattern used in Stories 2.1–2.3.

### Critical: AuthService.canActivate() Gap Analysis

The current `AuthService.canActivate()` (`front/src/app/services/auth.service.ts:40-51`) does NOT preserve the original URL:
```typescript
// CURRENT (broken for deep links):
canActivate(): boolean {
  // ... checks token ...
  this.router.navigate(['/login']); // No returnUrl!
  return isTokenPresent;
}
```

**Problem**: Angular's `CanActivateFn` signature provides `(route: ActivatedRouteSnapshot, state: RouterStateSnapshot)` — the current implementation uses the class-based `CanActivate` interface but doesn't accept `state`. The guard must be updated to capture `state.url` and pass it as a `returnUrl` query parameter.

**Recommended approach**: Since `AuthService` implements the class-based interface, add the `state` parameter to `canActivate(route?, state?)` and use `this.router.createUrlTree(['/login'], { queryParams: { returnUrl: state?.url } })` for the redirect. Alternatively, return `UrlTree` instead of `boolean` for cleaner router integration. **Do NOT convert to functional guard** — the AuthService is used as both a service and a guard across the app; changing the signature would be too invasive.

**Security**: Validate that `returnUrl` starts with `/` before using it (prevent open redirect / XSS).

### Critical: Deep Link Join Flow for Non-Participant

The current `handleRoomStatus()` (`duel-page.component.ts:332-358`) blocks non-creators from WAITING rooms:
```typescript
case 'WAITING':
  if (!isCreator) {
    displayError(this.snackBar, 'Room not found or already ended');
    this.router.navigate(['/pvp']);
    return;
  }
```

**This must change for deep-link joiners.** The logic should be:
1. Check if current user is already a participant (player1 or player2)
2. If YES → show waiting room as-is (existing behavior)
3. If NO → open `DeckPickerDialogComponent` for deck selection, then call `joinRoom()`
4. On successful join → refresh room signal, continue to waiting/polling

**Reuse `DeckPickerDialogComponent`** from `lobby-page/deck-picker-dialog.component.ts` — it's a standalone component. Import it in `DuelPageComponent`.

**Import MatDialog**: `DuelPageComponent` doesn't currently import `MatDialog`. Add `inject(MatDialog)`.

### Critical: RPS → Duel Loading Transition Timing

The state flow with loading screen is: `'connecting'` → RPS plays → BOARD_STATE arrives → `'duel-loading'` → thumbnails ready → `'active'`.

**The `boardReady` effect (current line 273-278) must be guarded**: BOARD_STATE can arrive while the RPS result overlay is still auto-dismissing (3s timeout). If we transition to `'duel-loading'` immediately, the loading screen will render UNDER the RPS overlay, causing a visual flash when RPS dismisses. **Fix**: add `!wsService.rpsResult()` to the transition condition. The full condition becomes:
```typescript
if (boardReady() && !this.wsService.rpsResult() && this.roomState() === 'connecting') {
  untracked(() => this.roomState.set('duel-loading'));
}
```
This ensures the loading screen only appears AFTER the RPS overlay has auto-dismissed.

### Critical: Duel Loading Screen — Data Source for Player Names

The loading screen needs **both player names** + LP (8000 vs 8000). Data sources:
- **Player names**: From `room()` signal (RoomDTO has `player1.username` and `player2.username`) — available as soon as both players join
- **LP**: Hardcoded 8000 for the loading screen (initial LP is always 8000 per game rules; actual LP comes in BOARD_STATE which is what we're waiting for)

### Critical: Card Thumbnail Pre-Fetching Strategy

**Own deck only** (per NFR6 — no opponent decklist leakage):
- The player's own card codes are NOT directly available client-side after joining. The client sends `decklistId` to the server, and card codes only arrive in `BOARD_STATE` messages.
- **Simplest approach**: Extract own hand card codes from the first `BOARD_STATE` (5 cards in hand zone). For the rest of the deck, use the `decklistId` — but there's no current endpoint that returns card codes for a decklist.
- **Practical decision**: Pre-fetch ONLY the 5 hand cards visible in the first `BOARD_STATE`. The remaining deck cards are face-down and invisible — their thumbnails will be fetched on-demand when drawn/revealed. This avoids needing a new API endpoint and matches the UX spec ("client pre-fetches thumbnails for its own deck only" — the hand IS the immediately visible portion).
- **Alternative (if more thorough pre-fetch needed)**: Add `GET /api/decklists/:id/cards` endpoint to Spring Boot. But this is over-engineering for MVP — hand cards are what the player sees first.
- **Code path for hand card codes**: `duelState().players[0].zones.find(z => z.zoneId === 'HAND').cards.map(c => c.cardCode)` — own hand cards have visible `cardCode` (not null). Deck zone cards have `cardCode: null` (filtered by `message-filter.ts` for anti-cheat).
- **⚠️ TECH DEBT**: UX spec says "pre-fetches thumbnails for its own deck only" but implementation only pre-fetches the 5 hand cards. Full deck pre-fetch would require a new API endpoint. Document this gap for future iteration.

### What NOT to Change (Already Implemented)

| Component | File | Status |
|-----------|------|--------|
| `copyRoomLink()` | `duel-page.component.ts:406-412` | ✅ Done (Story 2.1) |
| `shareRoom()` | `duel-page.component.ts:414-422` | ✅ Done (Story 2.1) |
| `canShare` flag | `duel-page.component.ts:81` | ✅ Done (Story 2.1) |
| `SHARE_TEXT_TEMPLATE` | `room.types.ts:17-18` | ✅ Done (Story 2.1) |
| Share/Copy buttons in waiting room template | `duel-page.component.html:13-29` | ✅ Done (Story 2.1) |
| `fetchRoom()` 404 handling | `duel-page.component.ts:322-329` | ✅ Done (Story 2.1) — already shows snackbar + redirects |
| ENDED status redirect | `duel-page.component.ts:353-356` | ✅ Done (Story 2.1) |
| RPS flow | `duel-web-socket.service.ts:156-165` | ✅ Done (Story 2.3) |
| `DeckPickerDialogComponent` | `lobby-page/deck-picker-dialog.component.ts` | ✅ Done (Story 2.2) — standalone, reusable |
| `RoomApiService.joinRoom()` | `room-api.service.ts:22-24` | ✅ Done (Story 2.2) |
| `getCardImageUrlByCode()` | `pvp-card.utils.ts` | ✅ Done (Story 1.5) |

### What MUST Change (Story 2.4 Scope)

| File | Change | Why |
|------|--------|-----|
| `front/src/app/services/auth.service.ts` | Add `returnUrl` query param to login redirect in `canActivate()` | Deep link auth redirect |
| `front/src/app/pages/login-page/login-page.component.ts` | Read `returnUrl` from queryParams, redirect there post-login | Complete auth redirect loop |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Remove isCreator gate in WAITING; add deck picker flow for non-participants; add `'duel-loading'` state; add thumbnail pre-fetch; add 15s timeout | Deep link join + loading screen |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Add duel loading screen template; update state guards to include `'duel-loading'` | Loading screen UI |
| `front/src/app/pages/pvp/duel-page/duel-page.component.scss` | Add loading screen styles | Loading screen styling |

### Source Tree — Files to Touch

**MODIFY (5 files):**
- `front/src/app/services/auth.service.ts`
- `front/src/app/pages/login-page/login-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
- `front/src/app/pages/pvp/duel-page/duel-page.component.html`
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss`

**REFERENCE (read-only):**
- `front/src/app/app.routes.ts` (verify route config, no changes needed)
- `front/src/app/pages/pvp/lobby-page/deck-picker-dialog.component.ts` (reuse as-is)
- `front/src/app/pages/pvp/room-api.service.ts` (reuse `joinRoom()`)
- `front/src/app/pages/pvp/room.types.ts` (RoomDTO, SHARE_TEXT_TEMPLATE)
- `front/src/app/pages/pvp/pvp-card.utils.ts` (getCardImageUrlByCode)
- `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` (signals for board state)

**DO NOT TOUCH:**
- Backend (Spring Boot) — no new endpoints needed
- Duel server — no changes needed
- PromptRpsComponent, prompt-registry, prompt-sheet — complete from Story 1.6/2.3
- Lobby page — no changes needed
- room-api.service.ts, room.types.ts — no changes needed

### Previous Story Intelligence (Stories 2.1–2.3)

**Reuse These Patterns:**
- `effect()` with `untracked()` for side effects (countdown, fullscreen, navigation) — same pattern for loading screen timeout
- Signal-based state machine: `roomState` transitions are clean and predictable — add `'duel-loading'` to the `RoomState` union type
- `displayError()` snackbar before navigation on error — consistent UX
- `DeckPickerDialogComponent` reuse from lobby — standalone, just inject `MatDialog` and `dialog.open()`

**Avoid These (Fixed in Previous Reviews):**
- C1: Polling error killed subscription → inner `catchError` (already fixed)
- H1: Missing loading overlay → always show feedback during async
- L2: Snackbar 2000ms → 3000ms consistently
- M3: setTimeout leak → always store ref + cleanup in `destroyRef.onDestroy()`
- **[class] binding** — NEVER use `[class]`, always `[class.specific-class]`

**Anti-Patterns:**
- ❌ Don't add unnecessary signals — DuelPageComponent already has ~20 signals; reuse `room()` for player names
- ❌ Don't modify DuelWebSocketService for this story — all changes are in DuelPageComponent + AuthService + LoginPage
- ❌ Don't create new API endpoints — pre-fetch hand cards only (from first BOARD_STATE)
- ❌ Don't modify routes — `canActivate: [AuthService]` already protects `/pvp/duel/:roomCode`

### Duel Loading Screen Design

```
┌──────────────────────────────────────────────┐
│                                              │
│              PREPARING DUEL...               │
│                                              │
│     Player1Name          Player2Name         │
│       8000 LP              8000 LP           │
│                                              │
│            ◌ (spinner, 64px)                 │
│                                              │
│      [15s timeout: "Taking longer            │
│       than expected..."                      │
│       [Return to Lobby] button]              │
│                                              │
└──────────────────────────────────────────────┘
```

- Full-viewport overlay, same `waiting-room` styling pattern
- Player names from `room().player1.username` / `room().player2.username`
- LP hardcoded to `8000` (initial value, actual LP arrives with BOARD_STATE)
- Spinner: `mat-progress-spinner` mode="indeterminate" diameter=64
- Background: dark, consistent with waiting room

### Login Page returnUrl Integration

The login page component needs to:
1. Read `returnUrl` from `this.route.snapshot.queryParams['returnUrl']`
2. On successful login, navigate to `returnUrl` if present and starts with `/`, otherwise navigate to default route (`/decks`)
3. **Security check**: `if (returnUrl && returnUrl.startsWith('/')) { this.router.navigateByUrl(returnUrl); }` — this prevents open redirect attacks

### Testing Standards

- **No automated tests** — "Big bang" approach per project convention
- **Manual verification** — see Task 6 subtasks for complete checklist

### Project Structure Notes

- All changes within existing file structure — no new files created
- `DeckPickerDialogComponent` imported from `lobby-page/` into `duel-page.component.ts` — cross-feature import but acceptable (standalone component, no circular dependency)
- `AuthService` change affects ALL guarded routes (app-wide) — the `returnUrl` parameter is additive and backward-compatible (login page ignores it if absent)

### References

- [Source: _bmad-output/planning-artifacts/epics-pvp.md#Story 2.4]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md#Authentication and Security]
- [Source: _bmad-output/planning-artifacts/architecture-pvp.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Navigation Patterns]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Loading and Transition States]
- [Source: _bmad-output/planning-artifacts/ux-design-specification-pvp.md#Card Image Pre-Fetch]
- [Source: _bmad-output/planning-artifacts/prd-pvp.md#FR1, FR3]
- [Source: _bmad-output/implementation-artifacts/2-1-room-creation-from-decklist.md#Dev Notes]
- [Source: _bmad-output/implementation-artifacts/2-2-room-browsing-joining.md#Dev Notes]
- [Source: _bmad-output/implementation-artifacts/2-3-waiting-room-duel-start-rps.md#Dev Notes]
- [Source: front/src/app/services/auth.service.ts:40-51]
- [Source: front/src/app/pages/pvp/duel-page/duel-page.component.ts:332-358]
- [Source: front/src/app/pages/pvp/lobby-page/deck-picker-dialog.component.ts]
- [Source: front/src/app/pages/pvp/pvp-card.utils.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

No debug issues encountered. All changes compiled on first attempt.

### Completion Notes List

- **Task 1 (Auth guard returnUrl)**: Added `ActivatedRouteSnapshot`/`RouterStateSnapshot` params to `canActivate()`, passes `returnUrl` query param on login redirect. Login page reads `returnUrl`, validates it starts with `/` (XSS prevention), and redirects post-login. Default redirect to `/decks` preserved when no `returnUrl`.
- **Task 2 (Deep link join flow)**: Replaced `isCreator` gate with `isParticipant` check (player1 OR player2). Non-participants get `DeckPickerDialogComponent` → `joinRoom()` flow. Edge cases: dialog cancel → lobby, 409 → snackbar + lobby, 422 → snackbar + re-open dialog. Anti-leak pattern with `switchMap`.
- **Task 3 (Duel loading screen)**: Added `'duel-loading'` state to `RoomState`. Modified board ready effect: `connecting` → `duel-loading` (guarded by `!rpsResult()`). Added `duelLoadingReady` computed signal. Template shows player names (from `room()` signal), 8000 LP vs 8000 LP, `mat-progress-spinner` (indeterminate, 64px). SCSS matches waiting room style.
- **Task 4 (Thumbnail pre-fetch)**: `preFetchOwnDeckThumbnails()` extracts hand card codes from first `BOARD_STATE`, uses `Image()` constructor + `Promise.allSettled()`. Sets `thumbnailsReady` signal on completion (success or error — failures use card back fallback). Uses `getCardImageUrlByCode()` from `pvp-card.utils.ts`.
- **Task 5 (15s timeout)**: 15s `setTimeout` started when entering `'duel-loading'`. Sets `loadingTimeout` signal if fires before `duelLoadingReady()`. Timeout cleared on destroy and on successful transition to `'active'`. Template shows "Taking longer than expected..." + "Return to Lobby" button.
- **TECH DEBT**: UX spec says "pre-fetches thumbnails for its own deck only" but implementation only pre-fetches the 5 hand cards (per Dev Notes analysis). Full deck pre-fetch would require a new API endpoint.

### Implementation Plan

Signal-based state machine extended with `'duel-loading'` state. Three new effects: (1) `connecting` → `duel-loading` on board ready + RPS dismissed, (2) trigger thumbnail pre-fetch on entering `duel-loading`, (3) `duel-loading` → `active` on loading ready. `DeckPickerDialogComponent` reused from lobby-page for deep link join flow.

### File List

**Modified:**
- `front/src/app/services/auth.service.ts` — Added `returnUrl` query param to `canActivate()` login redirect
- `front/src/app/pages/login-page/login-page.component.ts` — Read `returnUrl` from queryParams, redirect post-login
- `front/src/app/pages/pvp/duel-page/duel-page.component.ts` — Deep link join flow, duel loading state, thumbnail pre-fetch, 15s timeout
- `front/src/app/pages/pvp/duel-page/duel-page.component.html` — Duel loading screen template
- `front/src/app/pages/pvp/duel-page/duel-page.component.scss` — Duel loading screen styles

### Change Log

- 2026-02-28: Implemented Story 2.4 — Deep links auth redirect (returnUrl), deep link join flow for non-participants, duel loading screen with player names/LP/spinner, hand card thumbnail pre-fetch, 15s loading timeout with fallback UI
- 2026-02-28: Code Review (AI) — 7 findings (1H, 4M, 2L), all fixed:
  - [H1] Added `prefers-reduced-motion` for duel-loading spinner (accessibility consistency)
  - [M1] Guarded `resetLogin()` when `returnUrl` present (deep link auth redirect fragility)
  - [M2] Moved 15s timeout to effect (separated from pre-fetch — single responsibility)
  - [M3] Added max-retry guard (3) to `openDeckPickerForJoin()` recursion
  - [M4] Removed leftover `console.log(this.authService.user())` from login flow
  - [L1] Replaced `Promise.allSettled` with `Promise.all` (promises never reject)
  - [L2] Removed redundant token storage in `connect()` (authFinished handles it)