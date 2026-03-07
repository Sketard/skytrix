---
title: 'PvP Dev Tools & UX Polish'
slug: 'pvp-dev-tools-ux-polish'
created: '2026-03-03'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Angular 19.1.3', 'Angular Material 19.1.1', 'TypeScript 5.5.4', 'Node.js duel-server', 'Spring Boot 3.4.2', 'Java 21']
files_to_modify:
  - 'front/src/app/components/navbar/navbar.component.ts'
  - 'front/src/app/pages/pvp/lobby-page/lobby-page.component.ts'
  - 'front/src/app/pages/pvp/lobby-page/lobby-page.component.html'
  - 'front/src/app/pages/pvp/lobby-page/deck-picker-dialog.component.ts'
  - 'front/src/app/pages/pvp/room-api.service.ts'
  - 'front/src/app/pages/pvp/duel-page/duel-connection.ts (new)'
  - 'front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts'
  - 'front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts (new)'
  - 'front/src/app/pages/pvp/duel-page/duel-page.component.ts'
  - 'front/src/app/pages/pvp/duel-page/duel-page.component.html'
  - 'front/src/app/pages/pvp/duel-page/duel-page.component.scss'
  - 'back/src/main/java/com/skytrix/controller/DevRoomController.java (new)'
  - 'back/src/main/java/com/skytrix/service/RoomService.java'
  - 'back/src/main/java/com/skytrix/service/DuelServerClient.java'
  - 'back/src/main/java/com/skytrix/model/dto/room/QuickDuelDTO.java (new)'
  - 'back/src/main/java/com/skytrix/model/dto/room/QuickDuelResponseDTO.java (new)'
  - 'front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts'
  - 'front/src/app/pages/pvp/duel-page/room-state-machine.service.ts'
  - 'duel-server/src/server.ts'
  - 'duel-server/src/duel-worker.ts'
code_patterns:
  - 'Angular signals (signal(), computed(), asReadonly())'
  - 'Standalone components with OnPush change detection'
  - 'signal-based inputs: input<T>() / output<T>()'
  - 'environment.production guard for dev-only features'
  - 'DuelConnection plain TS class (no @Injectable)'
  - '@Inject (Jakarta) — never @Autowired'
  - 'Prettier: single quotes, 2-space indent, trailing comma es5, printWidth 120'
  - 'Lombok @Data on DTOs'
test_patterns: ['Big bang — no automated tests until full MVP']
---

# Tech-Spec: PvP Dev Tools & UX Polish

**Created:** 2026-03-03

## Overview

### Problem Statement

Three issues hinder PvP development and testing:
1. **No PvP access in navigation** — the lobby (`/pvp`) is unreachable from the navbar; users must type the URL manually.
2. **Asymmetric host flow** — creating a room requires navigating away to `/decks`, finding a deck, and using a hidden menu item ("Duel PvP"). The guest flow (DeckPickerDialog) is far simpler.
3. **Slow test cycle** — testing a PvP duel requires 2 browser windows, 2 accounts, room creation, joining, and RPS. There is no way to control both players from a single client.

### Solution

Three features in one spec:
1. **Navbar PvP + Symmetric Host Flow (prod):** Add a PvP tab to the navbar with `sports_kabaddi` icon. Make "Create Room" open the same DeckPickerDialog as "Join", eliminating the detour through the deck builder.
2. **Quick Duel Launcher (dev-only):** A lobby button (`bolt` icon, outline style) that opens a DeckPickerDialog with 2 deck slots (P1 + P2, toggle segment, default mirror), skips room creation/lobby/RPS, and launches a solo duel directly.
3. **Solo Debug Mode (dev-only):** Extract `DuelConnection` class from `DuelWebSocketService` (Option C). A `SoloDuelOrchestratorService` creates 2 `DuelConnection` instances (one per player token). Board flips on switch — each WS connection receives its own perspective from the duel server's `message-filter`. A chip toggle `[P1] [P2]` in the mini-toolbar switches the active player.

### Scope

**In Scope:**
- Add PvP tab to navbar (desktop sidebar + mobile drawer), icon `sports_kabaddi`
- "Create Room" opens DeckPickerDialog instead of navigating to `/decks`
- Quick Duel button in lobby (hidden in prod via `environment.production`), icon `bolt`
- DeckPickerDialog extended with toggle segment `[P1 Deck] [P2 Deck]`, mirror default, for Quick Duel mode only
- Refactor: extract `DuelConnection` plain TS class from `DuelWebSocketService`
- `SoloDuelOrchestratorService`: creates 2 `DuelConnection` instances, exposes `switchPlayer()`, computed signals for active player's state
- Board flip on switch (free — each WS connection already receives its own sanitized perspective)
- Chip toggle `[P1] [P2]` in mini-toolbar for player switching
- `POST /api/rooms/quick-duel { decklistId1, decklistId2 }` — dev-only endpoint (`@Profile("!prod")`)
- `skipRps: true` flag in `POST /api/duels` — duel server skips RPS_CHOICE, sends BOARD_STATE directly
- Solo Mode detection via query param `?solo=true` on duel page route
- All dev-only features gated behind `environment.production === false` (frontend) and `@Profile("!prod")` (Spring Boot)

**Out of Scope:**
- Bot / auto-play AI (responses are always manual via Switch Player)
- Network chaos tool (simulate disconnections)
- Board state snapshot viewer
- Debug log viewer (already implemented — `DebugLogService` + `DebugLogPanelComponent` exist in codebase)
- Modifying the guest join flow (already good)
- Removing "Duel PvP" from deck builder menu (kept as secondary shortcut)

## Context for Development

### Codebase Patterns

- Navbar uses `Tab` class (`name`, `icon`, `path`) — tabs array in constructor, template renders via `@for` loop (auto-applies to both desktop sidebar + mobile drawer)
- DeckPickerDialog: standalone inline-template component in `lobby-page/deck-picker-dialog.component.ts`, returns `number` (decklistId) on confirm, `undefined` on cancel. Uses `MatDialog.open()` with `width: '340px'`
- Room creation host flow: `lobby-page.component.ts:72` `goToDecks()` navigates to `/decks`. Deck builder menu item "Duel PvP" calls `RoomApiService.createRoom(decklistId)` → navigates to `/pvp/duel/{roomCode}`
- DuelPageComponent (998 lines): 7 scoped services in `providers` array (line 45-50). `wsService` injected at line 68. Route params read via `ActivatedRoute` (line 64). Constructor triggers `roomService.fetchRoom(code)` (line 292-307). Already has `DebugLogService` in providers, `debugLog` inject (line 75), and `isProduction` property (line 76)
- DuelWebSocketService (376 lines): 13 signal pairs (private + readonly). `handleMessage()` is a 48-case switch. Angular deps: `MatSnackBar` (line 14, auto-select notifications) + `DebugLogService` (line 15, logs server messages and player responses). Debug log hooks: `this.debugLog.logServerMessage(message)` in `handleMessage()` (line 167) and `this.debugLog.logPlayerResponse(promptType, data)` in `sendResponse()` (line 65)
- RoomStateMachineService: `connectWhenReady(room)` at line 177 sets `roomState = 'connecting'` and calls `wsService.connect(room.wsToken)`
- Mini-toolbar: `flex-direction: column`, `position: absolute`, bottom-right corner. Contains surrender button + activation toggle. Gap 8px between items
- Spring Boot: `@Inject` for DI, Lombok `@Data` on DTOs, `@Transactional` on service methods. `RoomMapper.toRoomDTO(room, requestingUserId)` maps wsToken per-user (P1 sees token1, P2 sees token2)
- Duel server: `POST /api/duels` body = `{ player1: { id, deck }, player2: { id, deck } }`. Returns `{ duelId, tokens: [token0, token1] }`. Worker receives INIT_DUEL message with `{ duelId, decks }`. RPS is handled by OCGCore emitting `ROCK_PAPER_SCISSORS` message type

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `front/src/app/components/navbar/navbar.component.ts` | Tab class (line 11-21), tabs array (line 46-48), `addTab()` (line 60-62). Add 4th tab at line 49 |
| `front/src/app/components/navbar/navbar.component.html` | Desktop `@for` loop (line 9-17), mobile `@for` (line 81-86). No changes needed — auto-renders new tab |
| `front/src/app/pages/pvp/lobby-page/lobby-page.component.ts` | `goToDecks()` (line 72-74) → change to open DeckPickerDialog. `joinRoom()` (line 80-106) → reference for dialog pattern. Quick Duel handler to add |
| `front/src/app/pages/pvp/lobby-page/lobby-page.component.html` | "Create Room" button (line 11-18), room list (line 42-63). Add Quick Duel button near Create Room |
| `front/src/app/pages/pvp/lobby-page/deck-picker-dialog.component.ts` | Inline template dialog. Returns `decklistId: number`. Decks loaded via `DeckBuildService.getAllDecks()` → `ShortDeck[]`. Selected via `selectedId` signal. Extend for Quick Duel mode (2 deck slots) |
| `front/src/app/pages/pvp/room-api.service.ts` | `createRoom(decklistId)`, `joinRoom(roomCode, decklistId)`, `getRoom(roomCode)`, `getRooms()`. Add `quickDuel(decklistId1, decklistId2)` |
| `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts` | 376 lines. 13 signal pairs. `connect(wsToken)` (line 57), `openConnection()` (line 104), `handleMessage()` (line 166, 48 cases), `handleReconnect()` (line 329, exponential backoff 2^n*1000ms, max 6 retries), `safeSend()` (line 350), `cleanup()` (line 359). Angular deps: `MatSnackBar` (line 14) + `DebugLogService` (line 15). Debug hooks: `logServerMessage()` in `handleMessage()` (line 167), `logPlayerResponse()` in `sendResponse()` (line 65) |
| `front/src/app/pages/pvp/duel-page/duel-page.component.ts` | Providers (line 45-50, includes `DebugLogService`), `wsService` inject (line 68), `debugLog` inject (line 75), `isProduction` property (line 76), route params (line 64), constructor room fetch (line 292-307), `connectWhenReady()` in RoomStateMachineService (line 177). Rematch effect clears debug logs (line 373-377) |
| `front/src/app/pages/pvp/duel-page/duel-page.component.html` | Mini-toolbar (line 203-214): surrender button + activation toggle. Insert [P1][P2] chip after surrender button (line 210). Debug FAB + panel (line 338-348) already present |
| `front/src/app/pages/pvp/duel-page/duel-page.component.scss` | `.mini-toolbar` (line 305-327): absolute, bottom-right, flex-column, gap 8px, z-index `z.$z-pvp-mini-toolbar`. `.debug-fab` (line 602-630) already present |
| `front/src/app/pages/pvp/duel-page/animation-orchestrator.service.ts` | **(exists)** `AnimationOrchestratorService` — scoped to DuelPageComponent. `init({ wsService, ... })` (line 57-67). Reads `wsService.animationQueue()` (line 101), `wsService.dequeueAnimation()` (line 107/112), `wsService.duelState()` (line 118). Has `destroy()` (line 91-94) that clears `animationTimeouts`. `isAnimating` signal (line 20-21). Add `resetForSwitch()` method for solo mode player switch |
| `front/src/app/pages/pvp/duel-page/debug-log.service.ts` | **(exists)** `DebugLogService` — scoped to DuelPageComponent. `logServerMessage(msg)`, `logPlayerResponse(promptType, data)`, `clearLogs()`, `panelOpen` signal. Uses `CardDataCacheService` for card name resolution. Gated by `!environment.production` |
| `front/src/app/pages/pvp/duel-page/debug-log-formatter.ts` | **(exists)** Pure functions: `formatServerMessage()` (48 cases), `formatPlayerResponse()`, `extractCardCodes()`. Type: `DebugLogEntry { timestamp, category, text }` |
| `front/src/app/pages/pvp/duel-page/debug-log-panel/` | **(exists)** `DebugLogPanelComponent` — standalone, OnPush. Inputs: `entries`, `open`. Outputs: `closed`, `clearRequested`. Auto-scrolls on new entries |
| `back/src/main/java/com/skytrix/controller/RoomController.java` | Endpoints: POST `/rooms` (line 35), POST `/rooms/{roomCode}/join` (line 41), GET `/rooms` (line 49), GET `/rooms/{roomCode}` (line 55), POST `/rooms/{roomCode}/end` (line 63). Reference only — not modified |
| `back/src/main/java/com/skytrix/controller/DevRoomController.java` **(new)** | `@Profile("!prod")` controller with `POST /rooms/quick-duel` endpoint. Separate class ensures endpoint not available in prod (F17) |
| `back/src/main/java/com/skytrix/service/RoomService.java` | `createRoom()` (line 45-58), `joinRoom()` (line 63-116, self-join guard at line 72), `validateDeck()`, `extractDeck()`, `generateUniqueRoomCode()`. Add `quickDuel()` method |
| `back/src/main/java/com/skytrix/service/DuelServerClient.java` | `createDuel(p1Id, deck1, p2Id, deck2)` (line 36-46). Sends `CreateDuelRequest(DuelPlayer, DuelPlayer)`. Add `skipRps` to request |
| `back/src/main/java/com/skytrix/mapper/RoomMapper.java` | `toRoomDTO(room, requestingUserId)` — maps wsToken per-user. Quick-duel needs both tokens → new `QuickDuelResponseDTO` |
| `duel-server/src/server.ts` | POST `/api/duels` handler (line 256-261): sends `INIT_DUEL` to worker. `ActiveDuelSession` interface (line ~45). `startRematch()` (line 379-383). Add `skipRps` to request body, INIT_DUEL message, and session |
| `duel-server/src/duel-worker.ts` | `initDuel()` (line 634-705): loads decks, starts OCGCore, calls `runDuelLoop()`. RPS transform: `ROCK_PAPER_SCISSORS` case (line 371-372). RPS response transform (line 568-569). When skipRps: auto-respond to OCGCore instead of emitting RPS_CHOICE to clients |
| `_bmad-output/project-context.md` | Project rules: standalone, OnPush, signal inputs, `@Inject` not `@Autowired`, Lombok `@Data`, Prettier config |

### Anchor Points (from Deep Investigation)

**Navbar:**
- `navbar.component.ts:49` — insert `this.addTab(new Tab('Duels PvP', 'sports_kabaddi', '/pvp'))` after existing 3 tabs. Template auto-renders in both desktop + mobile via `@for` loop. Zero template/SCSS changes

**Lobby — Host Flow:**
- `lobby-page.component.ts:72-74` — replace `goToDecks()` body: open `DeckPickerDialog` (same as join flow), on confirm call `RoomApiService.createRoom(decklistId)`, on success navigate to `/pvp/duel/{roomCode}`
- `lobby-page.component.html:15` — change `(click)="goToDecks()"` to `(click)="createRoom()"`

**Lobby — Quick Duel:**
- `lobby-page.component.html:11-18` — add Quick Duel button next to Create Room in `.lobby-actions` div, guarded by `@if (!isProduction)`
- `lobby-page.component.ts` — add `quickDuel()` method: open DeckPickerDialog in Quick Duel mode (2 slots), call `RoomApiService.quickDuel(id1, id2)`, navigate to `/pvp/duel/{roomCode}?solo=true`
- `room-api.service.ts` — add `quickDuel(decklistId1, decklistId2): Observable<QuickDuelResponse>`

**DeckPickerDialog — Quick Duel Mode:**
- `deck-picker-dialog.component.ts` — accept optional `data: { quickDuel: boolean }` via `MAT_DIALOG_DATA` injection. When `quickDuel=true`: add toggle segment `[P1 Deck] [P2 Deck]`, second `selectedId2` signal (defaults to mirror of `selectedId`). Return `{ decklistId1, decklistId2 }` instead of `number`

**DuelConnection Extract:**
- `duel-web-socket.service.ts` — extract into new `duel-connection.ts`:
  - 13 signal pairs move to DuelConnection
  - All WS lifecycle: `connect()`, `openConnection()`, `handleMessage()` (48 cases), `handleReconnect()`, `safeSend()`, `cleanup()`
  - All send methods: `sendResponse()`, `sendSurrender()`, `sendRequestStateSync()`, `sendRematchRequest()`
  - Animation queue: `dequeueAnimation()`, `clearAnimationQueue()`, `clearRpsResult()`
  - New: `skipPendingAnimations()` — flush queue, apply final state
  - Constructor: `(wsUrlBase: string, autoReconnect: boolean)`
  - Callbacks: `onAutoSelect?: (type: string) => void` for snackbar notifications; `onMessage?: (msg: ServerMessage) => void` for debug logging; `onResponse?: (promptType: string, data: Record<string, unknown>) => void` for response logging
- `duel-web-socket.service.ts` becomes thin wrapper with **swappable connection**:
  - `inject(MatSnackBar)` + `inject(DebugLogService)` — Angular dependencies
  - `private readonly _defaultConnection = new DuelConnection(environment.wsUrl, true)` — the production connection, owned by this service
  - `private _activeConnection = signal<DuelConnection>(this._defaultConnection)` — writable signal, defaults to `_defaultConnection`
  - Sets callbacks on `_defaultConnection`: `onAutoSelect` → snackbar, `onMessage` → `debugLog.logServerMessage()`, `onResponse` → `debugLog.logPlayerResponse()`
  - All 13 signals become `computed(() => this._activeConnection().signalName())`
  - All send methods delegate to `this._activeConnection().*`
  - **New:** `setActiveConnection(c: DuelConnection)` — called by orchestrator on player switch. All consumers (AnimationOrchestratorService, PvpPromptSheetComponent) auto-follow
  - `ngOnDestroy()` → `this._defaultConnection.cleanup()` — always cleans the owned production connection. Solo connections are cleaned separately by `SoloDuelOrchestratorService.cleanup()` via `DestroyRef`. This avoids double-cleanup of solo connections AND prevents the default connection from being orphaned

**SoloDuelOrchestratorService:**
- New `solo-duel-orchestrator.service.ts` — `@Injectable()` scoped to DuelPageComponent
  - `connections: [DuelConnection, DuelConnection] | null = null` — lazy, created in `init()` only
  - `activePlayerIndex = signal<0 | 1>(0)`
  - `init(token1, token2)`: create 2 `DuelConnection(environment.wsUrl, false)`, set callbacks on both, connect both, call `wsService.setActiveConnection(connections[0])`
  - `switchPlayer()`: flip index, call `skipPendingAnimations()` on outgoing connection, call `animationService.resetForSwitch()` (cancel orphaned timers), then call `wsService.setActiveConnection(connections[newIndex])` — all wsService consumers auto-follow
  - `connectionLost = computed(...)`: true if either connection enters `'lost'`
  - `cleanup()`: close both connections (`connection.cleanup()`)
  - **Lifecycle:** inject `DestroyRef`, register `destroyRef.onDestroy(() => this.cleanup())` in constructor — prevents WS leak on navigation away

**DuelPageComponent Integration:**
- `duel-page.component.ts:292-307` — constructor. Read `?solo=true` query param. If solo: read `history.state` tokens, call `orchestrator.init(token1, token2)` — this swaps wsService's active connection. **No `active*` computed delegates needed** — all template/effect refs to `wsService.*` automatically get the active player's data via the swappable connection. If `history.state` is null (page refresh) or WS connections fail immediately (stale tokens from back-navigation), redirect to `/pvp` lobby with snackbar
- `duel-page.component.ts:45-50` — providers array. Add `SoloDuelOrchestratorService` (always provide, no-op in normal mode). `DebugLogService` already present
- `duel-page.component.ts:76` — `isProduction = environment.production` already declared (used by debug FAB)
- `duel-page.component.ts:373-377` — rematch effect already calls `debugLog.clearLogs()` — this continues to work in solo mode (single `DebugLogService` instance)
- `duel-page.component.html:210` — after surrender button, add `@if (isSoloMode()) { <chip-toggle [P1][P2]> }`

**Mini-Toolbar Chip Toggle:**
- Insert after surrender button (line 210) in `.mini-toolbar` (line 203-214)
- `flex-direction: column` means it stacks vertically
- Use same styling pattern as existing `.mini-toolbar__btn` (44px min dimensions)
- `.mini-toolbar` styles at line 305-327 in SCSS

**Spring Boot — Quick Duel Endpoint:**
- New `DevRoomController.java` — separate `@RestController` with `@Profile("!prod")` at class level (F17). Contains `@PostMapping("/quick-duel")`
- New `QuickDuelDTO.java`: `@NotNull Long decklistId1`, `@NotNull Long decklistId2`
- New `QuickDuelResponseDTO.java`: `String roomCode`, `String wsToken1`, `String wsToken2` (both tokens, unlike RoomDTO which maps per-user)
- `RoomService.quickDuel(dto)`: create room with `player1 = player2 = currentUser`, validate both decks, call `duelServerClient.createDuel()` with `skipRps: true`, store tokens, set status ACTIVE, return `QuickDuelResponseDTO`

**Spring Boot — DuelServerClient:**
- `DuelServerClient.java:36-46` — add `skipRps` field to `CreateDuelRequest` record. New overload or optional param: `createDuel(p1Id, deck1, p2Id, deck2, skipRps)`

**Duel Server — skipRps:**
- `server.ts:192-195` — validate optional `skipRps` boolean in POST body
- `server.ts:234` — store `skipRps` on `ActiveDuelSession`
- `server.ts:257-261` — add `skipRps` to `INIT_DUEL` message
- `server.ts:379-383` — add `skipRps` to rematch `INIT_DUEL` message
- `duel-worker.ts:634-635` — extract `skipRps` from INIT_DUEL message, store as module-level variable
- `duel-worker.ts:371-372` — in `transformMessage()`, when `ROCK_PAPER_SCISSORS` + `skipRps`: return `null` (suppress RPS_CHOICE)
- `duel-worker.ts` — in `runDuelLoop()`'s message loop, when `ROCK_PAPER_SCISSORS` + `skipRps`: auto-respond with `core.duelSetResponse(duel, { type: 20, value: player === 0 ? 1 : 3 })` (P1=rock, P2=scissors → deterministic P1 win, no draw loop). Suppress both `RPS_CHOICE` and `HAND_RES` via `transformMessage()` returning `null`

### Technical Decisions (from Party Mode)

1. **WS Architecture — Option C (Extract Class):**
   - Extract `DuelConnection` as a plain TypeScript class (not `@Injectable`), encapsulating: `connect(wsToken)` (URL from constructor's `wsUrlBase`), `cleanup()`, `safeSend(type, data)`, `skipPendingAnimations()`, and signals (`duelState`, `pendingPrompt`, `animationQueue`, `connectionStatus`, `duelResult`, `rpsResult`, `hintContext`, `timerState`, `opponentDisconnected`, `activeChainLinks`, `rpsInProgress`, `rematchState`, `rematchStarting`).
   - Constructor: `(wsUrlBase: string, autoReconnect: boolean)`. When `autoReconnect: true` (prod), handles reconnect via `SESSION_TOKEN` + exponential backoff (2^n * 1000ms, max 6 retries, 30s cap). When `false` (Solo Mode), `ws.onclose` sets `connectionStatus = 'lost'` with no retry.
   - `skipPendingAnimations()`: clears the animation queue (discards pending `GameEvent` items). `duelState` already has the latest `BOARD_STATE` — no extra apply needed. Called by orchestrator on player switch to avoid replaying stale animations.
   - Callbacks: `onAutoSelect?: (type: string) => void` for snackbar notifications; `onMessage?: (msg: ServerMessage) => void` for debug logging; `onResponse?: (promptType: string, data: Record<string, unknown>) => void` for response logging — set by wrapper services, avoids Angular dependencies in DuelConnection.
   - `DuelWebSocketService` becomes a thin wrapper with a **swappable connection signal**: `private readonly _defaultConnection = new DuelConnection(environment.wsUrl, true)` (owned by the service); `_activeConnection = signal<DuelConnection>(this._defaultConnection)`. All 13 public signals are `computed(() => this._activeConnection().signalName())`. Exposes `setActiveConnection(c: DuelConnection)` method. Sets callbacks on `_defaultConnection`: `onAutoSelect` → `MatSnackBar`, `onMessage` → `DebugLogService.logServerMessage()`, `onResponse` → `DebugLogService.logPlayerResponse()`. `ngOnDestroy()` → `_defaultConnection.cleanup()` (always cleans the owned connection; solo connections cleaned by orchestrator's `DestroyRef`). Zero behavioral change for production (single connection, never swapped).
   - `SoloDuelOrchestratorService` creates 2 `DuelConnection(environment.wsUrl, false)` instances (lazily in `init()`). On `switchPlayer()`, calls `skipPendingAnimations()` on the outgoing connection, then `wsService.setActiveConnection(connections[newIndex])`. All wsService consumers (AnimationOrchestratorService, PvpPromptSheetComponent, DuelPageComponent effects) automatically get the active player's data via the computed signals — **no delegation pattern needed in DuelPageComponent**.
   - **Rationale:** Zero duplication, zero prod regression risk, single source of truth for WS logic. The swappable connection pattern is critical because `AnimationOrchestratorService` and `PvpPromptSheetComponent` inject `DuelWebSocketService` directly (not through DuelPageComponent) — without it, animations and prompt responses would target the wrong player in solo mode. The refactor pays off even without Solo Mode (testability, separation of concerns).

2. **Board Flip on Switch — Free via 2 perspectives:**
   - Each WS connection receives its own `BOARD_STATE` sanitized by `message-filter.ts` (self=0, opponent=1).
   - Switching player = switching which `DuelConnection`'s `duelState` is rendered. The template already renders self at bottom, opponent at top — no template changes needed.
   - Brief CSS transition (~200ms opacity) on switch for visual feedback. **Toggle state change is immediate** (chip switches to active player instantly); the board fade transition is cosmetic only and does NOT block input or disable the toggle.

3. **Quick Duel Backend — Single dev-only endpoint:**
   - `POST /api/rooms/quick-duel { decklistId1, decklistId2 }` on Spring Boot, guarded by `@Profile("!prod")`.
   - Creates room with `player1 = player2 = currentUser`, validates both decks, calls `duelServerClient.createDuel()` with `skipRps: true`.
   - Returns `QuickDuelResponseDTO { roomCode, wsToken1, wsToken2 }` — both tokens (not per-user mapping like normal RoomDTO).
   - This is a **separate flow from `joinRoom()`** — does not reuse `joinRoom()` logic (which has a `player1 != currentUser` guard). Dedicated method in `RoomService` that handles the full lifecycle in one transaction.
   - Frontend navigates to `/pvp/duel/{roomCode}?solo=true`.

4. **Skip RPS — Server-side flag:**
   - `POST /api/duels` accepts optional `skipRps: boolean` in body.
   - When `true`, worker auto-responds to OCGCore's RPS prompt. **P1 picks rock (value 1), P2 picks scissors (value 3)** — deterministic P1 win, avoids draw re-prompt loop. `RPS_CHOICE` and `RPS_RESULT` messages suppressed (never sent to clients).
   - Stored on `ActiveDuelSession` for rematch.
   - **Implementation detail:** In `duel-worker.ts`, RPS auto-respond happens inside the `for (const msg of messages)` loop in `runDuelLoop()`. When `ROCK_PAPER_SCISSORS` is detected + `skipRps`, call `core.duelSetResponse(duel, { type: 20, value: playerIndex === 0 ? 1 : 3 })` immediately. `transformMessage()` returns `null` to suppress client-bound message. The loop continues — OCGCore processes the response and proceeds to the next `duelProcess()` call.

5. **Solo Mode Detection — Query param:**
   - `/pvp/duel/{roomCode}?solo=true` triggers Solo Mode in `DuelPageComponent`.
   - Component reads query param via `ActivatedRoute.snapshot.queryParamMap`.
   - When solo: `orchestrator.init()` swaps `DuelWebSocketService`'s active connection via `setActiveConnection()` — all existing `wsService.*` references in the template, effects, and injecting services (AnimationOrchestratorService, PvpPromptSheetComponent) automatically get the active player's data via the computed signals. **No separate signal delegation to the orchestrator is needed** — `DuelWebSocketService` remains the single source of truth.
   - Solo branch lives entirely in `DuelPageComponent` constructor — it reads `history.state?.wsToken1` + `history.state?.wsToken2` and calls `orchestrator.init(token1, token2)` directly, **bypassing** `RoomStateMachineService.connectWhenReady()` entirely (no room fetch, no tab guard init). `RoomStateMachineService` receives one minor addition: `forceState(state: RoomState)` method (see Task 14) — needed only for solo mode bootstrapping.

6. **DeckPickerDialog — Toggle segment for Quick Duel:**
   - Normal mode (Create/Join): single deck selection (unchanged).
   - Quick Duel mode: inject `{ quickDuel: true }` via `MAT_DIALOG_DATA`. Toggle segment `[P1 Deck] [P2 Deck]` at top. P1 selection required, P2 defaults to mirror (same as P1). User can switch to P2 tab to pick a different deck. Confirm returns `{ decklistId1: number, decklistId2: number }`.

7. **Switch Player UI — Chip toggle in mini-toolbar:**
   - `[P1] [P2]` chip toggle added to existing mini-toolbar (bottom-right), after surrender button.
   - Active player highlighted. Click calls `orchestrator.switchPlayer()`.
   - Dev-only: guarded by `@if (isSoloMode())`.

8. **Navbar — PvP tab:**
   - Add 4th entry to `navbar.component.ts` tabs array: `new Tab('Duels PvP', 'sports_kabaddi', '/pvp')` at line 49.
   - Template `@for` loop auto-renders in desktop sidebar + mobile drawer. Zero template changes.
   - `swords` is NOT a valid Google Material icon — use `sports_kabaddi` (already used in lobby empty state).

## Implementation Plan

### Tasks

Tasks are organized in 3 phases per F11. Each phase can be tested independently before moving to the next.

---

#### Phase A — Prod UX (Navbar + Symmetric Host Flow)

- [x] **Task 1: Add PvP tab to navbar**
  - File: `front/src/app/components/navbar/navbar.component.ts`
  - Action: Insert `this.addTab(new Tab('Duels PvP', 'sports_kabaddi', '/pvp'))` at line 49 (after the 3 existing tabs)
  - Notes: Zero template/SCSS changes — `@for` loop auto-renders in desktop sidebar + mobile drawer

- [x] **Task 2: Replace `goToDecks()` with `createRoom()` using DeckPickerDialog**
  - File: `front/src/app/pages/pvp/lobby-page/lobby-page.component.ts`
  - Action: Rename `goToDecks()` → `createRoom()`. Replace body: open `DeckPickerDialog` (same pattern as `joinRoom()` at line 80-106), on confirm call `RoomApiService.createRoom(decklistId)`, on success navigate to `/pvp/duel/{roomCode}` with `{ state: { deckName } }`. Add `creatingRoom = signal(false)` — set `true` before HTTP call, `false` on error (F12). **deckName source (F20):** The dialog closes with only the `decklistId`. The lobby component should load its own deck list via `DeckBuildService.getAllDecks()` (or cache it as a signal) and look up `deckName` by ID after the dialog closes: `this.decks().find(d => d.id === decklistId)?.name`. Pass it in `history.state.deckName`. Alternatively, change the dialog to return `{ id: number, name: string }` — simpler but changes the return type for all callers
  - File: `front/src/app/pages/pvp/lobby-page/lobby-page.component.html`
  - Action: Update button click handler from `goToDecks()` to `createRoom()`. Disable button when `creatingRoom()`
  - Notes: Dialog import already available (used by `joinRoom()`). Keep the same `width: '340px'` dialog config

---

#### Phase B — Refactor + Backend

- [x] **Task 3: Create `DuelConnection` class**
  - File: `front/src/app/pages/pvp/duel-page/duel-connection.ts` **(new)**
  - Action: Create plain TypeScript class with:
    - Constructor: `(wsUrlBase: string, autoReconnect: boolean)` — creates all signals in the constructor body (`this._duelState = signal(null); this.duelState = this._duelState.asReadonly();` etc.)
    - 13 signal pairs (private `WritableSignal` + public `readonly` via `.asReadonly()`): `duelState`, `pendingPrompt`, `hintContext`, `animationQueue`, `timerState`, `connectionStatus`, `opponentDisconnected`, `activeChainLinks`, `duelResult`, `rpsResult`, `rpsInProgress`, `rematchState`, `rematchStarting`
    - All WS lifecycle methods: `connect(wsToken)`, `openConnection()`, `handleMessage()` (48 cases), `safeSend()`, `cleanup()`
    - Reconnect logic: `handleReconnect()` (exponential backoff 2^n*1000ms, max 6 retries) when `autoReconnect: true`; set `connectionStatus = 'lost'` with no retry when `false`
    - All send methods: `sendResponse()`, `sendSurrender()`, `sendRequestStateSync()`, `sendRematchRequest()`
    - Auto-select methods: `autoSelectSort()` and `autoSelectAnnounceCard()` — **extract as-is from `DuelWebSocketService`** (line 318-327). Both are parameterless methods that read `pendingPrompt` to build a response, call `sendResponse()`, and fire `this.onAutoSelect?.(type)` callback. `autoSelectSort()` auto-picks a card order (sort prompt), `autoSelectAnnounceCard()` auto-picks a card to announce. No signature changes needed — they use internal signals only
    - Reconnect state: `canRetry = computed(() => this._retryCount() < this._maxRetries && this._autoReconnect)` — a `computed` signal (not a plain getter) so that wrapper `computed()` chains in `DuelWebSocketService` properly track the dependency. `retryConnection()` public method — both used by DuelPageComponent
    - Animation queue methods: `dequeueAnimation()`, `clearAnimationQueue()`, `clearRpsResult()`
    - New: `resetRematchStarting()` — sets `_rematchStarting.set(false)`. Called by `SoloDuelOrchestratorService.handleRematchReset` after processing the rematch reset, to ensure the `false→true` transition re-triggers the effect on subsequent rematches
    - New: `skipPendingAnimations()` — clear the animation queue (discard pending `GameEvent` items). `duelState` signal already reflects the latest `BOARD_STATE` — no separate "apply" needed. **Message ordering guarantee:** In the existing `handleMessage()`, `BOARD_STATE` messages update `_duelState` signal immediately (synchronous `.set()`), while `GAME_EVENT` messages are enqueued to `_animationQueue`. Since `BOARD_STATE` is always the last message in a batch from the duel server (after all `GAME_EVENT`s for that turn), `duelState` is guaranteed to reflect the final board state by the time any pending animations remain in the queue. Clearing the queue is therefore safe — the board renders correctly from `duelState` alone
    - Callbacks: `onAutoSelect?: (type: string) => void`, `onMessage?: (msg: ServerMessage) => void`, `onResponse?: (promptType: string, data: Record<string, unknown>) => void`
    - In `handleMessage()`: call `this.onMessage?.(message)` at the start (before switch). In `sendResponse()`: call `this.onResponse?.(promptType, data)` after successful send. These replace the `DebugLogService` calls currently in `DuelWebSocketService` — the debug log service can't be injected in a plain class
  - Notes: No Angular dependency. Move code from `duel-web-socket.service.ts` — do NOT rewrite logic, extract as-is. The `this.debugLog.logServerMessage()` and `this.debugLog.logPlayerResponse()` calls in the current service become `this.onMessage?.()` and `this.onResponse?.()` callbacks. No `sendRematchAccept()` — rematch protocol uses `REMATCH_REQUEST` from both sides (no accept message exists)

- [x] **Task 4: Refactor `DuelWebSocketService` as thin wrapper with swappable connection**
  - File: `front/src/app/pages/pvp/duel-page/duel-web-socket.service.ts`
  - Action: Replace all internal state and WS logic with:
    - **Default connection:** `private readonly _defaultConnection = new DuelConnection(environment.wsUrl, true)` — the production connection, owned by this service
    - **Swappable connection signal:** `private _activeConnection = signal<DuelConnection>(this._defaultConnection)` — writable signal holding the current active connection (defaults to `_defaultConnection`)
    - Set callbacks on `_defaultConnection`: `onAutoSelect` → trigger `MatSnackBar`; `onMessage` → `this.debugLog.logServerMessage(msg)`; `onResponse` → `this.debugLog.logPlayerResponse(promptType, data)`
    - **All signals become computed through `_activeConnection`:** `duelState = computed(() => this._activeConnection().duelState())`, `pendingPrompt = computed(() => this._activeConnection().pendingPrompt())`, etc. for all 13 signals + `canRetry = computed(() => this._activeConnection().canRetry())` — note the `()` call since `canRetry` is now a `computed` signal on `DuelConnection` (not a plain getter), ensuring the dependency chain is properly tracked through the wrapper computed
    - **New method:** `setActiveConnection(connection: DuelConnection): void` — sets `_activeConnection.set(connection)`. Called by `SoloDuelOrchestratorService` on player switch. All computed signals automatically re-evaluate → AnimationOrchestratorService, PvpPromptSheetComponent, and all other wsService consumers transparently get the active player's data
    - Keep `inject(MatSnackBar)` + `inject(DebugLogService)` — the only Angular deps
    - Delegate all public methods to `_activeConnection().*` (e.g., `sendResponse(...) { this._activeConnection().sendResponse(...) }`). This includes `connect(wsToken)` — it delegates to `this._activeConnection().connect(wsToken)`. **Solo mode safety:** In solo mode, `_activeConnection` is swapped to an orchestrator-managed connection before `RoomStateMachineService.connectWhenReady()` runs. However, solo mode **bypasses** `connectWhenReady()` entirely (Task 14 skips the room fetch flow that triggers it), so `wsService.connect()` is never called in solo mode. No guard needed — the code path simply doesn't execute
    - **`ngOnDestroy()` → `this._defaultConnection.cleanup()`** — always cleans the owned production connection. Does NOT call `_activeConnection().cleanup()`. In normal PvP mode, `_activeConnection === _defaultConnection` so this is equivalent. In solo mode, the orchestrator's `DestroyRef.onDestroy()` cleans both solo connections — calling `_activeConnection().cleanup()` here would double-cleanup. The `_defaultConnection` is created in the constructor (even in solo mode) but never connected — `cleanup()` is idempotent (closes WS if open, no-op if not)
    - **Key insight:** `AnimationOrchestratorService` (reads `wsService.animationQueue()`, calls `wsService.dequeueAnimation()`) and `PvpPromptSheetComponent` (calls `wsService.sendResponse()`, reads `wsService.hintContext()`) inject `DuelWebSocketService` directly — they do NOT go through DuelPageComponent's delegates. The swappable `_activeConnection` signal ensures these services automatically follow player switches. Without this, solo mode would send prompt responses to the wrong player and animations wouldn't play. This is the regression-critical step — test normal PvP duel thoroughly after this task

- [x] **Task 5: Add `skipRps` to duel server**
  - File: `duel-server/src/server.ts`
  - Action:
    - Validate optional `skipRps: boolean` in POST `/api/duels` body (line 192-195)
    - Add `skipRps: boolean` to `ActiveDuelSession` interface (line ~45)
    - Store `skipRps` on session (line 234)
    - Include `skipRps` in `INIT_DUEL` message to worker (line 257-261)
    - Include `skipRps` in rematch `INIT_DUEL` message (line 379-383)
  - File: `duel-server/src/duel-worker.ts`
  - Action:
    - Extract `skipRps` from `INIT_DUEL` message, store as module-level variable (line 634-635)
    - In `transformMessage()`: add `if (skipRps)` guard returning `null` for both `ROCK_PAPER_SCISSORS` (line 371) and `HAND_RES` (line 374) cases. **Naming clarification:** `ROCK_PAPER_SCISSORS` and `HAND_RES` are the **OCGCore-level** message types emitted by the engine. `transformMessage()` converts them to **client-facing** types: `ROCK_PAPER_SCISSORS` → `RPS_CHOICE`, `HAND_RES` → `RPS_RESULT`. When `skipRps`, return `null` for both OCGCore types in `transformMessage()` — this prevents both `RPS_CHOICE` and `RPS_RESULT` from ever reaching clients
    - **Critical control flow for auto-respond:** OCGCore's RPS is a **per-player, two-cycle process**: (1) `duelProcess()` → WAITING + `ROCK_PAPER_SCISSORS` for player 0 → auto-respond P1=rock; (2) `duelProcess()` → WAITING + `ROCK_PAPER_SCISSORS` for player 1 → auto-respond P2=scissors; (3) `duelProcess()` → `HAND_RES` result. Each cycle requires a separate `duelProcess()` call.
    - In `runDuelLoop()`: use a per-iteration flag `let skipRpsAutoResponded = false;` **reset at the top of each `while(true)` iteration**. Inside the `for (const msg of messages)` loop, when `ROCK_PAPER_SCISSORS` detected + `skipRps`: call `core.duelSetResponse(duel, { type: 20, value: msg.player === 0 ? 1 : 3 })` and set `skipRpsAutoResponded = true`. At the WAITING return point (after the for loop): `if (status === WAITING && !skipRpsAutoResponded) { return; }` — if flag is `true`, **do NOT return**, `continue` the outer while loop so `duelProcess()` is called again. **Lifecycle across cycles:** (1) P1 RPS iteration: flag=true → continue, suppress BOARD_STATE; (2) P2 RPS iteration: flag reset→true → continue, suppress BOARD_STATE; (3) HAND_RES iteration: flag reset→stays false (no RPS in this batch) → `transformMessage()` returns null for HAND_RES (uses `skipRps` flag, not `skipRpsAutoResponded`). If status is WAITING with a real game prompt, `!skipRpsAutoResponded` → return normally → BOARD_STATE emitted. This ensures no intermediate states leak to clients during the RPS auto-respond phase
    - **Critical: suppress intermediate messages during auto-respond.** When `skipRpsAutoResponded` is `true`, also gate the `buildBoardState()` call at the WAITING point — do NOT emit intermediate `BOARD_STATE` messages between RPS auto-respond cycles. Without this gate, clients receive a premature board state (empty field, 0 LP) before RPS resolution completes. Only emit `BOARD_STATE` after the final `duelProcess()` when `skipRpsAutoResponded` is `false` (RPS fully resolved, game entered normal phase)
  - Notes: When `skipRps = false` (default, omitted), behavior is 100% unchanged. The two-cycle approach handles both players' RPS choices and the final `HAND_RES` result. After both auto-responds, OCGCore proceeds to the normal game phase and the next `duelProcess()` returns messages (BOARD_STATE, etc.) as usual

- [x] **Task 6: Create `QuickDuelDTO` and `QuickDuelResponseDTO`**
  - File: `back/src/main/java/com/skytrix/model/dto/room/QuickDuelDTO.java` **(new)**
  - Action: Create DTO with `@Data`, fields: `@NotNull Long decklistId1`, `@NotNull Long decklistId2`
  - File: `back/src/main/java/com/skytrix/model/dto/room/QuickDuelResponseDTO.java` **(new)**
  - Action: Create DTO with `@Data`, fields: `String roomCode`, `String wsToken1`, `String wsToken2`

- [x] **Task 7: Add `skipRps` parameter to `DuelServerClient` + fix missing auth header**
  - File: `back/src/main/java/com/skytrix/service/DuelServerClient.java`
  - Action: Add `skipRps` boolean field to `CreateDuelRequest` record (line 36-46). Add overloaded `createDuel()` method or add `boolean skipRps` parameter to existing signature. Existing callers pass `false` (default). **Pre-existing bug fix:** Add `.header("X-Internal-Key", internalKey)` to the `createDuel()` HTTP request — currently missing (only `terminateDuel()` sends this header). The duel server's `validateInternalAuth()` checks this header on `POST /api/duels`. **Why it works today:** `INTERNAL_KEY` env var is unset in the current dev environment, so `validateInternalAuth()` skips the check (no key = no enforcement). The bug would only manifest if `INTERNAL_KEY` is set (e.g., staging/production). Fix it here since we're already modifying this method — prevents a future surprise
  - Notes: Update existing call site in `RoomService.joinRoom()` (line ~87-92) to pass `false` explicitly. This is the only caller — verify no other call sites exist before proceeding

- [x] **Task 8: Add `RoomService.quickDuel()` method**
  - File: `back/src/main/java/com/skytrix/service/RoomService.java`
  - Action: Add `@Transactional` method `quickDuel(QuickDuelDTO dto)`:
    1. Get current user
    2. Validate both decks via existing `validateDeck()` method
    3. Extract both decks via existing `extractDeck()` method
    4. Create Room entity: `player1 = player2 = currentUser`, `status = ACTIVE`, `roomCode = generateUniqueRoomCode()`
    5. Call `duelServerClient.createDuel(userId, deck1, userId, deck2, true)` — `skipRps: true`
    6. Store `wsToken1` + `wsToken2` on Room entity
    7. Save and return `QuickDuelResponseDTO { roomCode, wsToken1, wsToken2 }`
  - Notes: Separate flow from `joinRoom()` — no self-join guard. Both tokens returned directly (not per-user mapping)

- [x] **Task 9: Create `DevRoomController` with `POST /rooms/quick-duel` endpoint**
  - File: `back/src/main/java/com/skytrix/controller/DevRoomController.java` **(new)**
  - Action: Create a separate controller class with `@Profile("!prod")` at **class level** (F17 — `@Profile` on a method inside an existing `@RestController` is ignored):
    ```java
    @Profile("!prod")
    @RestController
    @RequestMapping("/rooms")
    @RequiredArgsConstructor
    public class DevRoomController {
        private final RoomService roomService;

        @PostMapping("/quick-duel")
        @ResponseStatus(HttpStatus.OK)
        public QuickDuelResponseDTO quickDuel(@Valid @RequestBody QuickDuelDTO dto) {
            return roomService.quickDuel(dto);
        }
    }
    ```
  - Notes: Entire bean not instantiated in prod — guaranteed no endpoint leak. Active by default when no Spring profile is set (dev mode)

---

#### Phase C — Frontend Solo Mode

- [x] **Task 10: Extend `DeckPickerDialog` for Quick Duel mode**
  - File: `front/src/app/pages/pvp/lobby-page/deck-picker-dialog.component.ts`
  - Action:
    - Add `@Inject(MAT_DIALOG_DATA) @Optional() data: { quickDuel: boolean } | null`
    - Add `quickDuel = computed(() => this.data?.quickDuel ?? false)`
    - Add `activeSlot = signal<'p1' | 'p2'>('p1')` and `selectedId2 = signal<number | null>(null)`
    - In template: when `quickDuel()`, render `mat-button-toggle-group` with `[P1 Deck]` / `[P2 Deck]` toggles above the deck list
    - When P2 has no explicit selection, show hint "(Miroir de P1)" below the toggle
    - On confirm: when `quickDuel()`, return `{ decklistId1: selectedId(), decklistId2: selectedId2() ?? selectedId() }` (mirror default). When normal mode, return `selectedId()` (unchanged)
  - Notes: Import `MatButtonToggle` and `MatButtonToggleGroup` standalone components in `imports` (not `MatButtonToggleModule` — Angular Material 19 standalone pattern). Normal Create/Join flow unaffected — `data` is `null` when not injected. **Return type strategy — no union type needed:** In normal mode (no `data` or `quickDuel=false`), the dialog still calls `dialogRef.close(selectedId())` which returns `number`. In Quick Duel mode, it calls `dialogRef.close({ decklistId1: ..., decklistId2: ... })` which returns an object. **Do NOT change the `MatDialogRef` generic** — keep it untyped or use `any` for the result. Each call site already knows which mode it opened the dialog in: (1) Task 2's `createRoom()` and existing `joinRoom()` open without `data` → result is always `number`, cast directly; (2) Task 13's `quickDuel()` opens with `{ quickDuel: true }` → result is always the object, cast via `as`. This avoids the union type entirely and means **Phase A call sites (Task 2, `joinRoom()`) require zero changes when Task 10 is implemented** — preserving Phase A's "ship independently" promise. **No conflict with Task 2** — Task 2 only changes the *call site* (lobby opens this dialog), Task 10 *extends the dialog itself* for Quick Duel mode

- [x] **Task 11: Add `RoomApiService.quickDuel()` method**
  - File: `front/src/app/pages/pvp/room-api.service.ts`
  - Action: Add method `quickDuel(decklistId1: number, decklistId2: number): Observable<QuickDuelResponse>` — POST to `/rooms/quick-duel`
  - Notes: Add `QuickDuelResponse` interface: `{ roomCode: string, wsToken1: string, wsToken2: string }`

- [x] **Task 12: Create `SoloDuelOrchestratorService`**
  - File: `front/src/app/pages/pvp/duel-page/solo-duel-orchestrator.service.ts` **(new)**
  - Action: Create `@Injectable()` service (scoped — provided in DuelPageComponent's `providers`):
    - `enabled = false` flag (inert when not solo, F9)
    - **Lazy connections:** `private _connections = signal<[DuelConnection, DuelConnection] | null>(null)` — a **signal** (not a plain field) so that `connectionLost` computed properly re-evaluates when connections are created in `init()`. NOT created in constructor (avoids allocating 26 signals + WS setup in production). Created only in `init()`
    - **Public readonly accessor:** `connections = this._connections.asReadonly()` — exposed for `DuelPageComponent` to read in its rematch-reset effect (Task 14). The component needs to watch `connections()?.[0].rematchStarting()` to re-set `roomState` and `thumbnailsReady` after rematch
    - `activePlayerIndex = signal<0 | 1>(0)`
    - Inject `DuelWebSocketService` — needed for `setActiveConnection()` calls
    - Inject `MatSnackBar` — needed for `onAutoSelect` callbacks (snackbar notifications on auto-select)
    - Inject `AnimationOrchestratorService` — needed for `resetForSwitch()` on player switch
    - **Sub-action on `animation-orchestrator.service.ts`:** Add a new public method `resetForSwitch(): void` to `AnimationOrchestratorService`: clear all active `setTimeout` handles from `animationTimeouts` (same handles that `destroy()` clears), set `_isAnimating.set(false)`, set `animatingZone.set(null)`, set `animatingLpPlayer.set(null)`. Without this method, orphaned timers from the outgoing player's animations would dequeue from the wrong connection's queue, and `isAnimating = true` would suppress the incoming player's `visiblePrompt`. This is distinct from `destroy()` — `resetForSwitch()` clears state for a new player perspective, while `destroy()` tears down the service entirely
    - `init(token1: string, token2: string)`: set `enabled = true`, create both `new DuelConnection(environment.wsUrl, false)`, set callbacks on both, **set `_connections.set([conn0, conn1])`**, call `conn0.connect(token1)` + `conn1.connect(token2)`, then `wsService.setActiveConnection(conn0)` — this makes all wsService consumers (AnimationOrchestratorService, PvpPromptSheetComponent, effects) immediately read P1's signals. **Then call `this.setupRematchEffects()`** to wire up rematch detection (see below)
    - `switchPlayer()`: flip `activePlayerIndex`, call `skipPendingAnimations()` on outgoing connection, **call `animationService.resetForSwitch()`** (cancel orphaned animation timeouts, reset `isAnimating`, clear zone/LP animation state — prevents dequeue from wrong connection's queue and `visiblePrompt` suppression), then call `wsService.setActiveConnection(connections[newIndex])` — **this is the key: swapping wsService's active connection makes ALL consumers automatically follow the switch** (no `active*` delegates needed in DuelPageComponent). **Atomicity note:** All three operations (`skipPendingAnimations`, `resetForSwitch`, `setActiveConnection`) are synchronous and execute within a single microtask. Angular's change detection runs after the call stack completes — no intermediate render between steps. This is safe
    - `connectionLost = computed(() => { const conns = this._connections(); return conns !== null && (conns[0].connectionStatus() === 'lost' || conns[1].connectionStatus() === 'lost'); })` — reads `_connections()` signal, so it properly re-evaluates when `init()` sets the connections
    - **Rematch effects (created in `init()` via `setupRematchEffects()`):** Two effects created inside `init()` using `runInInjectionContext(this.injector, () => { ... })` to ensure injection context is available (the service constructor's injection context is no longer on the call stack when `init()` runs from DuelPageComponent's constructor). **Effect 1 — `autoAcceptRematch`:** watches **both** connections' `rematchState` signals explicitly — `conns[0].rematchState()` and `conns[1].rematchState()`. When **either** becomes `'invited'` (server sent `REMATCH_INVITATION`), auto-sends `sendRematchRequest()` on **that specific** connection. **Critical: do NOT derive "inactive" from `activePlayerIndex`** — the user can switch players at any time, so `activePlayerIndex` may not reflect which connection received the invitation. Watch both and respond on whichever got invited. **Idempotent:** if the server has already started rematch (both players sent `REMATCH_REQUEST` near-simultaneously in solo), the late `REMATCH_REQUEST` is harmless — server ignores it. **Effect 2 — `handleRematchReset`:** watches both connections' `rematchStarting` signals — `conns[0].rematchStarting()` and `conns[1].rematchStarting()`. When **both** are `true`, reset `activePlayerIndex` to `0`, call `wsService.setActiveConnection(conns[0])`, then **reset `rematchStarting` to `false` on both connections** (e.g., `conns[0]._rematchStarting.set(false); conns[1]._rematchStarting.set(false)` — requires `_rematchStarting` to be accessible, OR add a `resetRematchStarting()` method on `DuelConnection`). This reset is critical: without it, on the 2nd rematch the `true→true` non-transition would not re-trigger the effect. No cleanup/reconnect needed — WS connections persist, signals reset internally by each `DuelConnection`'s `REMATCH_STARTING` handler
    - Inject `Injector` — needed for `runInInjectionContext()` in `setupRematchEffects()`. **This is the component-scoped injector** (because `SoloDuelOrchestratorService` is listed in DuelPageComponent's `providers`). Effects created via `runInInjectionContext(this.injector, ...)` are therefore tied to the component's lifecycle and automatically cleaned up when the component is destroyed — no manual teardown needed
    - `cleanup()`: close both connections if they exist (`this._connections()?.[0].cleanup()`, `this._connections()?.[1].cleanup()`)
    - **Lifecycle:** inject `DestroyRef` and register `destroyRef.onDestroy(() => this.cleanup())` in constructor — ensures WS connections are closed when DuelPageComponent is destroyed (navigation away). Without this → WebSocket leak
  - Notes: Set callbacks on both connections: `onAutoSelect` → **gated by `activePlayerIndex` at invocation time**: `connections[i].onAutoSelect = (type) => { if (i === this.activePlayerIndex()) this.snackBar.open(...) }` — the callback reads `this.activePlayerIndex()` (the signal) each time it fires, NOT capturing the initial value. This ensures gating follows the current active player even after switches; `onMessage` → `debugLog.logServerMessage()` (**NOT gated** — always log, regardless of active player); `onResponse` → `debugLog.logPlayerResponse()` (**NOT gated** — always log). Inject `DebugLogService`. Both connections share the same `DebugLogService` instance — logs interleave naturally from both connections (timestamps distinguish P1 vs P2 messages). **Only `onAutoSelect` is gated by `activePlayerIndex`; `onMessage` and `onResponse` are unconditional** — this ensures debug logs capture all server/response activity for both players, which is essential for solo debugging. The existing rematch effect in `DuelPageComponent` already calls `debugLog.clearLogs()` on `REMATCH_STARTING` — works for solo too. **No computed signal delegates in this service** — the orchestrator only manages lifecycle + switching; all signal delegation happens transparently via `wsService.setActiveConnection()`

- [x] **Task 13: Add Quick Duel button to lobby**
  - File: `front/src/app/pages/pvp/lobby-page/lobby-page.component.ts`
  - Action: Add `isProduction = environment.production` property. Add `quickDuel()` method:
    1. Open `DeckPickerDialog` with `data: { quickDuel: true }`
    2. On confirm: call `RoomApiService.quickDuel(result.decklistId1, result.decklistId2)`
    3. On success: `router.navigate(['/pvp/duel', response.roomCode], { state: { wsToken1: response.wsToken1, wsToken2: response.wsToken2 }, queryParams: { solo: 'true' } })`
  - File: `front/src/app/pages/pvp/lobby-page/lobby-page.component.html`
  - Action: Add Quick Duel button in `.lobby-actions` div, guarded by `@if (!isProduction)`. Icon `bolt`, outline style
  - Notes: Button next to "Create Room". Navigation passes both tokens via `history.state` (F7)

- [x] **Task 14: Integrate Solo Mode in `DuelPageComponent`**
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
  - Action:
    - Add `SoloDuelOrchestratorService` to `providers` array (line 45-50) — always provided (F9). `DebugLogService` is already in providers (added by debug-log-viewer spec)
    - Inject `SoloDuelOrchestratorService`. `isProduction` property already exists (line 76, used by debug FAB) — reuse it for Quick Duel button guard if needed
    - Add `isSoloMode = signal(false)` — set `true` when `ActivatedRoute.snapshot.queryParamMap.get('solo') === 'true'`
    - In constructor (line 292-307): if solo mode, read `history.state?.wsToken1` and `history.state?.wsToken2`, call `orchestrator.init(token1, token2)` instead of normal room fetch flow. **Critical: after `orchestrator.init()`, manually set `roomState` to `'active'`** via `this.roomStateMachine.forceState('active')` — solo mode bypasses `RoomStateMachineService.connectWhenReady()` (no room fetch, no WS handshake that triggers state transitions), so `roomState` stays at its initial value. `roomState` is owned by `RoomStateMachineService` (injected as `this.roomStateMachine`, line ~70). Add a `forceState(state: RoomState)` method to `RoomStateMachineService` — a simple `this._roomState.set(state)` with **no transition guards, no side effects, no validation**. It bypasses the normal state machine transitions entirely. This is needed only for solo mode bootstrapping (setting `'active'` without going through `connectWhenReady()`). Also **set `this.thumbnailsReady.set(true)` immediately** — `thumbnailsReady` is a writable signal owned by `DuelPageComponent` itself (line 104), set to `true` normally by the thumbnail preload callback. Solo mode has no duel-loading thumbnail pre-fetch phase, so `duelLoadingReady` (which depends on `thumbnailsReady`) would block the board. **Refresh fallback (F9):** If `history.state` is null (page refresh), redirect to `/pvp` lobby with a snackbar "Solo duel session expired — start a new Quick Duel". `history.state` is ephemeral and not preserved on refresh. **Back-navigation guard:** Add an `effect()` in the solo branch that watches `orchestrator.connectionLost()` — when it becomes `true`, redirect to `/pvp` lobby with snackbar "Connection lost — returning to lobby". This handles both immediate WS failure (stale tokens from back-navigation) and mid-duel disconnection. The `connectionLost` computed in the orchestrator reads both connections' `connectionStatus` signals, so it reacts as soon as either connection enters `'lost'` state
    - **NO `active*` computed delegates needed.** The swappable `_activeConnection` signal in `DuelWebSocketService` (Task 4) makes this transparent: when `orchestrator.init()` calls `wsService.setActiveConnection(connections[0])`, ALL existing `wsService.*` references in the template, effects, and methods (35 in TS + 6 in HTML) automatically read the active player's signals. `AnimationOrchestratorService` and `PvpPromptSheetComponent` also auto-follow (they inject `wsService` directly). **Zero migration of `wsService.` references**
    - `canRetry` is a computed signal in both `DuelConnection` (Task 3) and `DuelWebSocketService` (Task 4): in solo mode, `DuelConnection(autoReconnect=false)` has `canRetry() = false`, so the "Retry" button won't appear — only the "Connection lost — reload page" overlay via `orchestrator.connectionLost`
    - Handle rematch in solo mode: orchestrator's `autoAcceptRematch` effect handles it automatically (watches both connections' `rematchState`). The `handleRematchReset` effect detects when both connections receive `REMATCH_STARTING`, resets `activePlayerIndex` to 0, and swaps wsService back to P1's connection. No cleanup/reconnect — WS connections persist (F16 corrected). **After rematch reset, re-set `roomStateMachine.forceState('active')` and `thumbnailsReady.set(true)`.** Implementation: **DuelPageComponent adds its own `effect()`** in the solo branch of the constructor that watches `orchestrator.connections()?.[0].rematchStarting()` — when it becomes `true`, call `roomStateMachine.forceState('active')` and `thumbnailsReady.set(true)`. This keeps the orchestrator free of `RoomStateMachineService` dependency and `thumbnailsReady` access (which is a component-owned signal)
    - Add `connectionLost` overlay in template: `@if (isSoloMode() && orchestrator.connectionLost()) { <overlay "Connection lost — reload page"> }`
  - Notes: Normal PvP flow unchanged — `isSoloMode()` is `false`, orchestrator stays inert, wsService uses its default connection. **This task is dramatically simpler than the original `active*` delegation approach** — no computed wrappers, no signal migration, no risk of missing references. The only solo-specific additions are: init branch in constructor, `isSoloMode` signal, `connectionLost` overlay, and chip toggle (Task 15)

- [x] **Task 15: Add `[P1][P2]` chip toggle to mini-toolbar**
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.html`
  - Action: After surrender button (line 210, inside `.mini-toolbar` at line 203), add:
    ```html
    @if (isSoloMode()) {
      <mat-button-toggle-group [value]="orchestrator.activePlayerIndex() === 0 ? 'p1' : 'p2'"
                               (change)="switchPlayerWithTransition()">
        <mat-button-toggle value="p1">P1</mat-button-toggle>
        <mat-button-toggle value="p2">P2</mat-button-toggle>
      </mat-button-toggle-group>
    }
    ```
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.scss`
  - Action: Style the toggle group in `.mini-toolbar` context — min-height 44px, primary color for active (F15)
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.ts`
  - Action: Add `MatButtonToggle` and `MatButtonToggleGroup` standalone components to component `imports` (not `MatButtonToggleModule`)
  - Notes: `flex-direction: column` in `.mini-toolbar` stacks it vertically with existing buttons

- [x] **Task 16: Add board flip CSS transition**
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.scss`
  - Action: Add `transition: opacity 200ms ease` on the board container. In the component TS, add `switching = signal(false)` and `private switchTimer: ReturnType<typeof setTimeout> | null = null`. Add a **`switchPlayerWithTransition()`** method on `DuelPageComponent` (NOT on the orchestrator): **`clearTimeout(this.switchTimer)`** first (cancel previous timer on rapid re-toggle), then `this.switching.set(true)`, call `this.orchestrator.switchPlayer()`, then `this.switchTimer = setTimeout(() => this.switching.set(false), 200)`. Bind `[class.switching]="switching()"` on the board container. CSS: `.switching { opacity: 0.3; }`. **The `switching` signal is component-owned** — the orchestrator has no awareness of CSS transitions
  - File: `front/src/app/pages/pvp/duel-page/duel-page.component.html`
  - Action: Add `[class.switching]="switching()"` to the board container element
  - Notes: Visual feedback on switch. Lightweight — no layout shift, just a brief fade. The signal toggle + CSS transition is the standard Angular pattern (signals don't trigger CSS transitions directly). **Toggle state change is immediate** — the chip switches active player instantly; the board fade is cosmetic and does NOT disable the toggle or block input

### Acceptance Criteria

#### Phase A — Prod UX

- [ ] **AC-1:** Given a user on any page, when they look at the navbar, then a "Duels PvP" tab with `sports_kabaddi` icon is visible (desktop sidebar + mobile drawer), and clicking it navigates to `/pvp`
- [ ] **AC-2:** Given a user on the lobby page, when they click "Create Room", then a DeckPickerDialog opens (same as join flow) with their deck list
- [ ] **AC-3:** Given a user in the Create Room dialog, when they select a deck and confirm, then a room is created via API and they are navigated to `/pvp/duel/{roomCode}`
- [ ] **AC-4:** Given a user in the Create Room dialog, when the API call is in progress, then the "Create Room" button is disabled (prevents double-click). On error, the button re-enables
- [ ] **AC-5:** Given an existing PvP duel started via the deck builder "Duel PvP" menu, when the duel loads, then it works exactly as before (no regression)

#### Phase B — Refactor + Backend

- [ ] **AC-6:** Given a normal PvP duel (2 players, 2 browsers), when the duel proceeds through all phases (RPS → turns → win/lose → rematch), then behavior is identical to pre-refactor (DuelConnection extract regression check)
- [ ] **AC-7:** Given a normal PvP duel, when a player disconnects and reconnects, then auto-reconnect with exponential backoff works as before (SESSION_TOKEN + max 6 retries)
- [ ] **AC-8:** Given a `POST /api/duels` request with `skipRps: true`, when OCGCore emits RPS prompts, then the worker auto-responds (P1 goes first) and no `RPS_CHOICE` / `RPS_RESULT` messages are sent to clients
- [ ] **AC-9:** Given a `POST /api/duels` request without `skipRps` (or `false`), when OCGCore emits RPS prompts, then RPS proceeds normally (no behavioral change)
- [ ] **AC-10:** Given a `POST /api/rooms/quick-duel { decklistId1, decklistId2 }` request in dev, when both decks are valid, then a room is created with both tokens returned in `QuickDuelResponseDTO { roomCode, wsToken1, wsToken2 }` and the duel starts with `skipRps: true`
- [ ] **AC-11:** Given a `POST /api/rooms/quick-duel` request with an invalid decklistId, when the server validates, then an appropriate error response is returned
- [ ] **AC-12:** Given a production Spring Boot profile (`spring.profiles.active=prod`), when a client calls `POST /api/rooms/quick-duel`, then it returns 404 (endpoint not available)

#### Phase C — Frontend Solo Mode

- [ ] **AC-13:** Given a user on the lobby page in dev mode, when they see the lobby actions, then a Quick Duel button (`bolt` icon) is visible next to "Create Room"
- [ ] **AC-14:** Given a user on the lobby page in production, when they see the lobby actions, then no Quick Duel button is visible
- [ ] **AC-15:** Given a user clicking Quick Duel, when the DeckPickerDialog opens, then it shows a `[P1 Deck] [P2 Deck]` toggle segment at the top with the deck list below
- [ ] **AC-16:** Given a user in Quick Duel dialog with P1 deck selected and P2 unselected, when they confirm, then P2 mirrors P1 (same deck for both players). Selecting the same deck explicitly for both P1 and P2 is also valid (1 deck available → works fine)
- [ ] **AC-17:** Given a user in Quick Duel dialog, when they switch to the P2 tab and select a different deck, then the "(Miroir de P1)" hint disappears and confirm returns both distinct decklistIds
- [ ] **AC-18:** Given a Quick Duel launched successfully (including with mirrored decks where `decklistId1 == decklistId2`), when the duel page loads with `?solo=true`, then both WS connections are established (2 connections to duel server) and the board renders from P1's perspective
- [ ] **AC-19:** Given a solo duel in progress, when the user clicks `[P2]` in the mini-toolbar, then the board flips to P2's perspective (opponent zones swap, P2's hand/prompt shown) with a brief opacity transition
- [ ] **AC-20:** Given a solo duel in progress on P1's turn, when the user switches to P2, then P2's board shows no active prompt (it's not P2's turn). Switching back to P1 restores the prompt
- [ ] **AC-21:** Given a solo duel with animations playing on P1, when the user switches to P2, then P1's pending animations are flushed instantly (final board state applied) and P2's queue plays normally
- [ ] **AC-22:** Given a solo duel where one WS connection drops, when the user sees the board, then an overlay "Connection lost — reload page" is shown (no auto-reconnect in solo mode)
- [ ] **AC-23:** Given a solo duel that ends (win/lose), when the user clicks "Rematch", then the orchestrator auto-sends `REMATCH_REQUEST` on the inactive connection (triggered by `REMATCH_INVITATION`), both connections receive `REMATCH_STARTING` and reset their signals internally (WS connections persist — no reconnect), the board returns to P1 perspective, and a new duel starts (skipping RPS)
- [ ] **AC-24:** Given the DeckPickerDialog opened from "Create Room" or "Join Room" (normal mode), when it renders, then it shows a single deck selection with no toggle segment (no regression)
- [ ] **AC-25:** Given a solo duel in progress on P1, when the user clicks Surrender, then P1 loses, the duel result screen appears, and the user can initiate a rematch or return to lobby
- [ ] **AC-26:** Given a solo duel page URL (`?solo=true`) accessed via page refresh (no `history.state`), when the page loads, then the user is redirected to `/pvp` lobby with a snackbar "Solo duel session expired"

## Additional Context

### Dependencies

- No new dependencies. All components used:
  - `MatButtonToggle` + `MatButtonToggleGroup` standalone components (Angular Material 19 — import directly in component `imports`)
  - `MAT_DIALOG_DATA` injection token (already used elsewhere in the project)
  - `@Profile` annotation (Spring Boot core)
  - `@Optional()` decorator (Angular core)
  - `environment.production` flag (already exists in Angular environment files)

### Testing Strategy

- **Big bang approach** — no automated tests until full MVP (per project convention)
- **Phase A manual test**: Navigate via navbar to lobby, create room via dialog, verify duel starts. Check mobile drawer too
- **Phase B manual test**: Run a normal 2-player PvP duel end-to-end (RPS → turns → win → rematch → reconnect). Compare behavior to pre-refactor. This is the critical regression gate
- **Phase C manual test**: Quick Duel from lobby → solo duel with P1/P2 switching → rematch. Verify board flip, prompt persistence, animation flush, connection lost overlay

### Risk Assessment

- **HIGH: DuelConnection extract (Task 3-4)** — Touching the core WS service affects all PvP duels. Mitigation: extract as-is (no logic rewrite), run full PvP regression after. Phase B is a natural gate — do not proceed to Phase C until normal duels are verified
- **MEDIUM: Rematch in Solo Mode (Task 12, F16)** — Complex orchestration with auto-accept + `wsService.setActiveConnection()` reset. Mitigation: detailed flow documented in F16, test rematch multiple times in succession
- **LOW: skipRps (Task 5)** — Isolated to `skipRps: true` path. Default (`false`/omitted) is untouched. Low regression risk

### Notes

- Quick Duel and Solo Debug Mode are tightly coupled: Quick Duel always launches in Solo Mode
- The DeckPickerDialog enhancement (2 deck slots) only applies when launched from Quick Duel; normal Create/Join flow keeps single deck selection
- The `DuelConnection` extract refactor improves the codebase independently of Solo Mode — cleaner separation of concerns, future testability. The swappable `_activeConnection` signal in `DuelWebSocketService` is the architectural enabler for solo mode: it ensures ALL wsService consumers (AnimationOrchestratorService, PvpPromptSheetComponent, DuelPageComponent effects) transparently follow player switches without any code migration
- "Duel PvP" menu item in deck builder is kept as a secondary shortcut (not modified)
- `DuelConnection` has exactly 13 signal pairs matching current `DuelWebSocketService`: `duelState`, `pendingPrompt`, `hintContext`, `animationQueue`, `timerState`, `connectionStatus`, `opponentDisconnected`, `activeChainLinks`, `duelResult`, `rpsResult`, `rpsInProgress`, `rematchState`, `rematchStarting`. Also includes `canRetry` computed signal, `retryConnection()` method, `autoSelectSort()`, and `autoSelectAnnounceCard()` methods (used by DuelPageComponent / callback)

### Known Limitations (from Adversarial Review)

- **Page refresh in Solo Mode:** `history.state` is ephemeral — refreshing `/pvp/duel/{roomCode}?solo=true` loses tokens. Handled by redirect to lobby with snackbar message. Acceptable for dev-only tool.
- **Same userId for both players:** Quick Duel sets `player1 = player2 = currentUser`. `RoomMapper.toRoomDTO()` would return the same token for both. Solo Mode bypasses `getRoom()` (reads tokens from `history.state`), so this code path is not triggered.
- **SoloDuelOrchestratorService allocates lazily:** connections created in `init()` only (not constructor). In production PvP, the service is provided but `init()` is never called — zero overhead (no signals, no WS setup). The `enabled` flag keeps it inert.
- **TabGuard not initialized in Solo Mode:** `DuelTabGuardService` never called in solo flow. Two tabs could run solo duels simultaneously. Acceptable for dev-only usage.
- **Production bundle includes solo mode code:** `SoloDuelOrchestratorService`, `DuelConnection`, `MatButtonToggle` shipped in prod even if unused. Tree-shaking can't eliminate them (referenced in `providers`/`imports`). Acceptable trade-off.
- **Partial connection loss in Solo Mode:** If one WS connection drops while the other is still active, the `connectionLost` overlay fires immediately (computed reads both connections' `connectionStatus`). No option to continue on the surviving connection — the user must reload. Acceptable for dev-only tool; partial solo play with one dead connection would be confusing.

### Behavioral Notes (from Party Mode Round 2)

- **Switch during active prompt:** Expected behavior. The prompt persists on its `DuelConnection`. Switching to the other player shows a prompt-free board (it's not their turn). Switching back restores the prompt.
- **Switch during animation:** `skipPendingAnimations()` is called on the outgoing connection (queue cleared), then `animationService.resetForSwitch()` cancels any orphaned `setTimeout` timers, resets `isAnimating` to `false`, and clears `animatingZone`/`animatingLpPlayer` signals. Without this reset, the orphaned timer would dequeue from the wrong connection's queue, and `isAnimating = true` would suppress the new player's `visiblePrompt`. The incoming connection plays its own queue normally.
- **No reconnect in Solo Mode:** `autoReconnect: false` — if a WS drops, overlay "Connection lost — reload page". No SESSION_TOKEN management, no backoff, no race conditions on dual reconnect.
- **Surrender in Solo Mode:** Clicking "Surrender" always sends `sendSurrender()` on the **active (viewed) connection** — i.e., the currently displayed player surrenders. This is intentional: the user controls one player at a time, and surrender applies to the player they're currently viewing. Switching to P2 and clicking Surrender makes P2 lose.

### Feasibility & Implementation Notes (from Party Mode Round 3)

- **F6 — `signal()` outside injection context:** Confirmed in Angular 19 — `signal()`, `computed()`, `WritableSignal.set/update()` all work outside injection context. Only `effect()` requires it. `DuelConnection` as a plain TypeScript class with signals is fully viable.
- **F7 — Token passing via `history.state`:** Existing pattern (`deckName` already passed this way in lobby→duel navigation). Quick Duel passes `{ wsToken1, wsToken2 }` via `router.navigate(['/pvp/duel', roomCode], { state: { wsToken1, wsToken2 }, queryParams: { solo: 'true' } })`. Read in DuelPageComponent via `history.state?.wsToken1`.
- **F8 — `@Profile("!prod")` behavior:** Active by default when no Spring profile is explicitly set. Dev endpoint available out of the box during development, hidden only when `spring.profiles.active=prod` is set in production. No additional config needed.
- **F9 — Provider always provided:** Angular cannot conditionally provide services at runtime. `SoloDuelOrchestratorService` is always listed in DuelPageComponent's `providers` array. It initializes with `enabled = false` and `connections = null` — **lazy init** means zero DuelConnection allocation in production. Becomes active only when `init(token1, token2)` is called (creates connections + swaps wsService's active connection). Zero overhead in production flow.
- **F10 — Rematch in Solo Mode:** _(corrected per adversarial review)_ On rematch, WS connections **persist** — no cleanup, no reconnect, no new tokens. The server's `startRematch()` spawns a new worker on the same session. Both `DuelConnection` instances handle `REMATCH_STARTING` by resetting signals (same handler as current `DuelWebSocketService`). The orchestrator must: (1) detect `REMATCH_INVITATION` on the inactive connection, (2) auto-send `REMATCH_REQUEST` on it, (3) reset `activePlayerIndex` to 0 after both connections receive `REMATCH_STARTING`.
- **F11 — Implementation ordering (3 phases):**
  - **Phase A (Prod — zero risk):** Navbar PvP tab + symmetric host flow (DeckPickerDialog for Create Room). Ship independently.
  - **Phase B (Refactor + Backend):** Extract `DuelConnection` class from `DuelWebSocketService` (regression-critical — test thoroughly). Add `skipRps` to duel server. Add `POST /rooms/quick-duel` to Spring Boot. These are prerequisites for Phase C.
  - **Phase C (Frontend Solo):** `SoloDuelOrchestratorService`, Quick Duel lobby button, DeckPickerDialog 2-slot mode, chip toggle in mini-toolbar, solo mode detection in DuelPageComponent.

### UX & Product Notes (from Party Mode Round 4)

- **F12 — Create Room loading state:** Add `creatingRoom = signal(false)` to lobby component. Set `true` on dialog confirm before HTTP call, reset on error. "Create Room" button disabled when `creatingRoom()` is true — prevents double-click/double-room. Follows existing `joiningRoomCode` pattern from `joinRoom()`.
- **F13 — Empty deck list in Quick Duel dialog:** Already handled — confirm button is disabled when no deck is selected (`!selectedId()`). Empty list = no selection possible = button stays disabled. No special "create a deck first" message needed (consistent with join flow).
- **F14 — Toggle segment component:** Use `mat-button-toggle-group` for the P1/P2 deck slot switcher in DeckPickerDialog Quick Duel mode. Same deck list shown for both slots; toggle switches which slot the selection applies to. When P2 has not been explicitly selected, show hint text "(Miroir de P1)" below the toggle. Hint disappears once user selects a P2 deck.
- **F15 — Chip toggle component:** Use `mat-button-toggle-group` for `[P1][P2]` in mini-toolbar (consistency with F14). Active player in `primary` color, inactive in `outline`. Min-height 44px (matches existing `.mini-toolbar__btn` pattern).
- **F16 — Rematch in Solo Mode (detailed flow):** _(corrected per adversarial review — WS connections persist, no new tokens, no REMATCH_ACCEPT)_
  1. User clicks "Rematch" on active connection → sends `REMATCH_REQUEST` via WS
  2. Server sends `REMATCH_INVITATION` to the **inactive** connection (the opponent)
  3. Orchestrator detects `rematchState === 'invited'` on the **inactive** connection → auto-sends `REMATCH_REQUEST` on that same inactive connection (`autoAcceptRematch()`)
  4. Server sees both `rematchRequested[0]` and `rematchRequested[1]` = true → calls `startRematch()`
  5. Both connections receive `REMATCH_STARTING` (no payload — no new tokens, no new duelId)
  6. Both `DuelConnection` instances handle `REMATCH_STARTING` internally: reset signals (`_rematchStarting.set(true)`, `_rematchState.set(null)`, clear duelResult, duelState, pendingPrompt, etc.) — **same logic as existing `DuelWebSocketService` handler**. The `rematchState` reset to `null` is critical: it ensures the `autoAcceptRematch` effect properly re-triggers on subsequent rematches when `rematchState` transitions from `null` → `'invited'` again. Angular `effect()` tracks signal values — the `null` → `'invited'` transition is distinct and always triggers the effect
  7. WS connections persist — **NO cleanup, NO reconnect**. Server spawns a new worker, sends new `BOARD_STATE` on the same WS
  8. Reset `activePlayerIndex` to `0` (always return to P1 after rematch). Call `resetRematchStarting()` on both connections to ensure `rematchStarting` returns to `false` — enables the `false→true` transition to re-trigger `handleRematchReset` on subsequent rematches

## Review Notes

- Adversarial review completed
- Findings: 10 total, 5 fixed, 4 skipped (1 noise, 1 undecided, 2 design choices)
- Resolution approach: auto-fix
- **Fixed:** F2 (allowSignalWrites on orchestrator effects), F3 (rematch detection race — added `rematchReset` counter signal), F4 (unused `Optional` import), F7 (`_rematchStarting` encapsulation), F9 (duplicate `clearAnimationQueue` method)
- **Reclassified as noise:** F1 (ownPlayerIndex=0 is correct in solo mode — server perspective-corrects all messages per connection, self=0 always)
- **Skipped:** F5 (DevRoomController auth — service-layer enforces via `authService.getConnectedUser()`), F6 (deckName in router state — acceptable fallback to username), F8 (RPS determinism — acceptable for dev tool), F10 (undecided — `any` type from MatButtonToggleChange)
