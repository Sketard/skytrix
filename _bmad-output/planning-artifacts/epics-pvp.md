---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: ['prd-pvp.md', 'architecture-pvp.md', 'ux-design-specification-pvp.md', 'ocgcore-technical-reference.md']
---

# skytrix PvP - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for skytrix PvP (Online Automated Duels), decomposing the requirements from the PRD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: The player can create a PvP duel room from any valid decklist; the room appears in a lobby visible to other authenticated players
FR2: The system validates the deck before creating or joining a room (TCG format, TCG banlist compliance, deck size constraints: 40-60 main deck, 0-15 extra deck, 0-15 side deck)
FR3: The player can browse available duel rooms and join one with a valid decklist
FR4: The system starts the duel automatically when two players have joined the same room: both players play Rock-Paper-Scissors (30-second timeout, random selection on timeout) to determine who chooses to go first or second, then the duel begins with automatic hand distribution (5 cards each)
FR5: The player can surrender during a PvP duel at any point
FR6: The system handles player disconnection with a 60-second reconnection grace period
FR7: The system declares a winner when: opponent's LP reaches 0, opponent surrenders, opponent's deck is empty and a draw is required, or opponent exceeds the reconnection timeout. The system declares a draw when both players' LP reach 0 simultaneously or other draw conditions are met per duel engine rules
FR8: The system manages turn structure automatically (Draw Phase, Standby Phase, Main Phase 1, Battle Phase, Main Phase 2, End Phase)
FR9: The player can perform Main Phase actions by clicking a card to open a contextual action menu listing available actions (normal summon, set, activate, special summon, change position). Phase-level actions (enter Battle Phase, end turn) are available via persistent UI controls
FR10: The player can perform Battle Phase actions by clicking a monster to open a contextual attack menu (declare attack target). Phase-level actions (activate quick effect, enter Main Phase 2, end turn) are available via persistent UI controls
FR11: The player can respond to effect activation prompts via modal dialogs: confirm activation (yes/no), select card(s) from a presented list, choose a zone on the field via highlighted selection, select a monster position (ATK/DEF/face-down), declare a card attribute or monster type, declare a number
FR12: The system delegates chain resolution to the duel engine, which resolves chains automatically following official Yu-Gi-Oh! rules (SEGOC, LIFO resolution, timing)
FR13: The system delegates all game rule enforcement to the duel engine: summoning conditions, effect timing windows, damage calculation, zone restrictions, Extra Monster Zone access (Master Rule 5)
FR14: The system displays both players' fields: own field in full detail, opponent's face-up cards visible, opponent's face-down cards shown as card backs
FR15: The system hides opponent's private information: hand contents (card count visible, not identity), deck order, face-down card identities, extra deck contents
FR16: The system displays life points for both players, updated in real-time after damage or LP changes
FR17: The system displays the current chain of effects being resolved, showing each chain link's card and effect
FR18: The player can view card details for any face-up card on the field or in any public zone (graveyard, banished)
FR19: The system provides a visual indicator when it is the player's turn to act and what type of response is expected
FR20: The system enforces a turn timer with a cumulative time pool: 300 seconds initially, +40 seconds added to the remaining pool at the start of each subsequent turn. The timer counts down only during the active player's decision windows and pauses during chain resolution and opponent's actions
FR21: The system enforces an inactivity timeout: if a player performs no action for 100 seconds when a response is required, the system automatically forfeits the match
FR22: The system provides at least one visual feedback per game event in PvP (summon, destroy, activate, flip, LP change, chain link addition/resolution). Minimum: card movement animation + brief highlight. Visual style inspired by Yu-Gi-Oh! Master Duel
FR23: PvP interaction is click-based (respond to engine prompts by selecting from presented options) — not drag & drop. This is a distinct interaction paradigm from solo mode
FR24: The system displays a duel result screen at the end of a PvP duel showing: outcome (victory, defeat, or draw) and reason (opponent LP reduced to 0, opponent surrendered, opponent timed out, opponent disconnected, draw by simultaneous LP depletion)
FR25: The system provides a client-side activation toggle (Auto/On/Off) that filters how the client handles optional effect activation prompts received from the engine. Auto (default): prompt only in reaction to game events. On: prompt at every legal priority window. Off: auto-respond "No"/"Pass" to all optional prompts

### NonFunctional Requirements

NFR1: PvP duel actions (player response -> board state update on both clients) complete within 500ms under normal network conditions
NFR2: The WebSocket connection remains stable for the full duration of a duel (up to 60 minutes) with automatic heartbeat/keep-alive
NFR3: The duel server supports at least 50 concurrent duels without degradation in response time
NFR4: A disconnected player can reconnect to an active duel within 60 seconds without losing game state
NFR5: If both players disconnect, the duel state is preserved server-side for up to 4 hours before automatic cleanup
NFR6: The duel server is the sole authority for game state — the client receives only information the active player is authorized to see (no opponent hand contents, no face-down card identities, no deck order). Verified by: WebSocket message inspection confirms no private opponent data in payloads
NFR7: All player responses are validated by the duel engine — invalid responses (illegal card selections, out-of-turn actions) are rejected without corrupting game state
NFR8: PvP routes and WebSocket connections are protected by existing JWT authentication — unauthenticated users cannot access matchmaking or duels
NFR9: PvP mode functions on modern desktop browsers (Chrome, Firefox, Edge, Safari — latest two versions) and modern mobile browsers (Chrome Android, Safari iOS — latest two versions). The duel board locks to landscape orientation on mobile devices
NFR10: The duel server's usage of OCGCore complies with AGPL-3.0 license requirements — source code for the duel server is made available if the service is deployed publicly

### Additional Requirements

**From Architecture:**

- Worker thread per duel for total isolation (OCGCore WASM blocks the thread during processing)
- WebSocket protocol boundary: `ws-protocol.ts` (duel server) is the source of truth, `duel-ws.types.ts` (Angular) is a manual copy — same-commit update rule
- Message filter whitelist per message type (default DROP policy) — anti-cheat, safety-critical
- PlayerFieldComponent extraction from solo board.component.ts as Story 0 prerequisite (solo must function identically after)
- Independent WebSocket DTOs (no shared package between server and client)
- Docker-based deployment: duel-server container + docker-compose orchestration with Spring Boot + PostgreSQL
- Room state machine: WAITING → CREATING_DUEL → ACTIVE → ENDED in Spring Boot (5s timeout on CREATING_DUEL → revert to WAITING)
- Internal HTTP API: Spring Boot → Duel Server (POST /api/duels, POST /api/duels/:id/join, GET /health, GET /status) — Docker network auth
- Duel server: 7 production source files (server.ts, duel-worker.ts, message-filter.ts, ws-protocol.ts, types.ts, ocg-callbacks.ts, ocg-scripts.ts)
- OCGCore error resilience: try/catch around duelProcess() + 30s watchdog timer. On error → declare draw, notify both players, cleanup
- Startup health check validates cards.cdb readable + scripts directory non-empty before accepting connections
- WebSocket payload limit: maxPayload 4096 bytes (prevents JSON payload DoS)
- One-shot JWT auth at WebSocket handshake (no per-message re-validation)
- Long-lived JWT (≥ 2h) to cover full duel duration + reconnection window
- Reconnection via snapshot: duelQueryField() + duelQuery() per card (not message log replay)
- Implementation dependency graph: Phase 0 (ws-protocol.ts gate) → Phase 1A/1B (parallel server/client) → Phase 2A/2B → Phase 3 (end-to-end)
- PvP-A0 scope staging: implement only frequent SELECT_* types first (IDLECMD, BATTLECMD, CARD, CHAIN, EFFECTYN, PLACE, POSITION), others fallback to auto-select
- Spring Boot additions: RoomController, RoomService, DuelServerClient, Room entity, Flyway migration
- Angular PvP routes: /pvp (LobbyPage, lazy-loaded, auth guard), /pvp/duel/:roomId (DuelPage, lazy-loaded, auth guard)
- Environment config: wsUrl for duel server WebSocket (dev: ws://localhost:3001, prod: wss://domain/ws)
- Dev setup guide and deployment runbook required before deployment (upgraded from nice-to-have)
- AGPL-3.0 LICENSE file in duel-server/ root

**From UX Design:**

- CSS 3D perspective board layout for PvP (PvP-A scope, not polish) — ~10 lines CSS, opponent's field foreshortened, player's field full-size and thumb-friendly
- Mobile-first interaction: all prompts in bottom 40% of viewport (thumb zone), 44px+ touch targets
- Bottom-sheet pattern for all prompts (sliding up from bottom, board visible above)
- Two-beat rendering for prompts: Beat 1 = MSG_HINT context, Beat 2 = interactive elements (~50ms gap)
- Inspector + prompt coexistence: inspector transitions to compact mode (not closed) when prompt active, repositions above sheet
- Card inspector compact variant (<768px): art 60×87px + name + type + ATK/DEF. Expands on tap
- Hand row outside CSS perspective container, always visible, overlap at 6+ cards (Master Duel pattern)
- Prompt sheet states: closed, opening, open, transitioning (swap without close/reopen), collapsed, closing
- PvpBoardContainerComponent: max-width 1280px, max-height 720px on desktop (centered, black beyond)
- PvpTimerBadgeComponent merges connection state display (normal → "Connecting..." → "Reconnecting..." → "Opponent connecting...")
- PvpPhaseBadgeComponent: circular badge, tap to expand phase action menu (Battle Phase, Main Phase 2, End Turn)
- PvpActivationToggleComponent: 3-state cycle (Auto/On/Off), visible own turn only, inside mini-toolbar with surrender button
- PvpDuelResultOverlayComponent: VICTORY/DEFEAT/DRAW + reason + Rematch/Leave Room/Back to Deck
- Rematch flow: same decks, new RPS, no side decking in MVP. Rematch only while both on result screen. 5-min room timeout
- Distributed UI for IDLECMD/BATTLECMD: cards glow on field, zone browsers highlight actionable cards. 1 action = direct send, 2+ actions = Card Action Menu (absolute div)
- Zone browser with browse mode (read-only) and action mode (during IDLECMD — actionable cards highlighted)
- Chain link visualization: CSS class .pvp-chain-badge (numbered badges, 24px), not a dedicated component
- 6 prompt sub-components via CDK Portal: PromptYesNoComponent, PromptCardGridComponent, PromptZoneHighlightComponent, PromptOptionListComponent, PromptNumericInputComponent, PromptRpsComponent
- 3 visual prompt patterns: Pattern A (Floating Instruction — spatial), Pattern B (Bottom Sheet — selection), Pattern C (Yes/No — compact sheet)
- Landscape orientation lock on duel route (blocking overlay in portrait — no "Continue anyway")
- Fullscreen API + screen.orientation.lock('landscape-primary') at duel init (graceful degradation)
- Single tab enforcement: BroadcastChannel API + localStorage fallback
- App background recovery: visibilitychange → verify WS, request state sync, show auto-resolved actions snackbar
- Duel loading screen: player names + LP 8000 vs 8000 + spinner, holds until first board state + critical thumbnails pre-cached
- PvP design tokens: 25+ --pvp-* CSS custom properties in _design-tokens.scss (perspective, prompts, badges, highlights, timers, transitions, touch targets)
- Accessibility: LiveAnnouncer for game events/prompts/timer, FocusTrap on prompts, prefers-reduced-motion support (all transitions 0ms), WCAG AA contrast on all PvP tokens
- Deep link pattern: /pvp/duel/:roomId shareable, redirect to auth if needed, Web Share API on mobile
- Browser back during duel intercepted → surrender confirmation dialog
- Keyboard shortcuts (desktop): 1-9 for options, Y/N, Esc to cancel, Space to confirm, C for collapse handle

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 2 | Room creation from decklist |
| FR2 | Epic 2 | Deck validation (TCG, banlist, size) |
| FR3 | Epic 2 | Browse/join rooms |
| FR4 | Epic 2 | Auto-start (RPS + hand distribution) |
| FR5 | Epic 3 | Surrender |
| FR6 | Epic 3 | Disconnection handling (60s grace) |
| FR7 | Epic 3 | Win/draw conditions (full set: LP, surrender, timeout, disconnect) |
| FR8 | Epic 1 | Automated turn structure |
| FR9 | Epic 1 | Main Phase actions (contextual menu, distributed UI) |
| FR10 | Epic 1 | Battle Phase actions (attack menu, phase controls) |
| FR11 | Epic 1 | Player prompts (all SELECT_* types via 6 sub-components) |
| FR12 | Epic 1 | Chain resolution delegation to OCGCore |
| FR13 | Epic 1 | Full game rule enforcement by OCGCore |
| FR14 | Epic 1 | Two-player board display (CSS 3D perspective) |
| FR15 | Epic 1 | Private information hiding (message filter) |
| FR16 | Epic 1 | LP display (both players) |
| FR17 | Epic 6 ✅ | Chain visualization (overlay cascade) |
| FR18 | Epic 1 | Card detail inspection (face-up/public zones) |
| FR19 | Epic 1 | Turn indicator (visual + type of response expected) |
| FR20 | Epic 3 | Turn timer (chess-clock cumulative pool) |
| FR21 | Epic 3 | Inactivity timeout (100s forfeit) |
| FR22 | Epic 6 ✅ (partial) + Epic 7 | Visual feedback per game event — chain overlay + basic orchestration (Epic 6); card travel animations, buffer & replay, XYZ material visuals (Epic 7) |
| FR23 | Epic 1 | Click-based interaction (not drag & drop) |
| FR24 | Epic 3 | Duel result screen |
| FR25 | Epic 1 | Activation toggle (Auto/On/Off) |

### NFR Coverage Map

| NFR | Primary Epic | Cross-cutting |
|-----|-------------|---------------|
| NFR1 (<500ms round-trip) | Epic 1 | — |
| NFR2 (WebSocket stable 60 min) | Epic 1 | Epic 3 |
| NFR3 (50 concurrent duels) | Epic 1 | — |
| NFR4 (60s reconnection) | Epic 3 | — |
| NFR5 (4h state preservation) | Epic 3 | — |
| NFR6 (Server authority, anti-cheat) | Epic 1 | — |
| NFR7 (Response validation) | Epic 1 | — |
| NFR8 (JWT authentication) | Epic 1 | Epic 2, Epic 3 |
| NFR9 (Browser compatibility, landscape lock) | Epic 1 | — |
| NFR10 (AGPL-3.0 compliance) | Epic 1 | — |

## Epic List

### Epic 1: Core Online Duel ✅ COMPLETED
Two players can connect and play a complete automated duel online — all Yu-Gi-Oh! game rules enforced by OCGCore. Includes duel server scaffold + Docker, OCGCore integration (worker threads), WebSocket protocol + message filter, PlayerFieldComponent extraction (Story 0), board CSS 3D perspective (2 player fields), prompt handling (frequent SELECT_* types: IDLECMD, BATTLECMD, CARD, CHAIN, EFFECTYN, PLACE, POSITION — others fallback to auto-select), turn/phase management, LP tracking, win detection (LP=0 native OCGCore), hand display, card inspector adaptation, activation toggle, Spring Boot deck relay minimal.
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR18, FR19, FR23, FR25

### Epic 2: Lobby & Matchmaking ✅ COMPLETED
Players can create duel rooms from decklists, browse the lobby, join a room with a validated deck, and start duels through RPS. Includes room creation UI, deck validation (TCG format, banlist, size), room browsing/joining, waiting room (polling), RPS + turn order selection, deep link sharing, Web Share API, duel loading screen.
**FRs covered:** FR1, FR2, FR3, FR4

### Epic 3: Session Resilience & Duel Lifecycle ✅ COMPLETED
The PvP experience handles real-world conditions — surrender, disconnection/reconnection, turn timers, inactivity, and clear duel results with rematch. Includes surrender flow, disconnection handling (60s grace, snapshot reconnection), turn timer (chess-clock 300s + 40s/turn), inactivity timeout (100s), duel result screen (VICTORY/DEFEAT/DRAW + reason), rematch flow, app background recovery, single tab enforcement.
**FRs covered:** FR5, FR6, FR7, FR20, FR21, FR24

### Epic 5: Tech Debt Cleanup ✅ COMPLETED
Technical debt accumulated across Epics 1–4 is resolved: card inspector PvP placeholder, reconnection edge cases (3-3b), room management fixes (RoomDTO deck ID, orphaned room cleanup), infrastructure improvements (Docker integration test, thumbnail pre-fetch).
**FRs covered:** Debt resolution — no new FRs

### Epic 6: Chain Overlay Refactoring ✅ COMPLETED
Chain visualization refactored from simple on-card CSS badges to a dedicated full-screen overlay component matching Master Duel's chain cascade animation. Includes PvpChainOverlayComponent, AnimationOrchestratorService, async overlay contract, board-change detection, and acceleration features.
**FRs covered:** FR17, FR22 (partial — chain visualization and basic animation orchestration)

### Epic 7: Board Animations & Card Travel
Board animations replace in-place glow effects with spatial card travel between zones, with buffer & replay during chain resolution, and visual enhancements for XYZ materials.
**FRs covered:** FR22 (completion — card travel animations)

## Epic 1: Core Online Duel ✅ COMPLETED

Two players can connect and play a complete automated duel online — all Yu-Gi-Oh! game rules enforced by OCGCore.

### Story 1.1: PlayerFieldComponent Extraction

As a developer,
I want the solo simulator's board zone layout extracted into a reusable `PlayerFieldComponent`,
So that PvP can compose two player fields without duplicating zone layout code.

**Acceptance Criteria:**

**Given** the solo simulator board.component.ts contains the 18-zone layout
**When** PlayerFieldComponent is extracted into `components/player-field/`
**Then** it renders all 18 zones (5 Monster, 5 Spell/Trap, Field, Extra Deck, Main Deck, GY, Banished, and Pendulum L/R overlapping ST1/ST5) via a CSS grid
**And** it accepts `@Input() showEmz: boolean` (`true` for solo — EMZ in field grid, `false` for PvP — EMZ rendered externally in central strip)
**And** it supports `<ng-content>` projection (used by PvP for LP badge injection into grid area)
**And** it uses `ChangeDetectionStrategy.OnPush`

**Given** PlayerFieldComponent is extracted
**When** the solo simulator page loads
**Then** the solo simulator functions identically to before extraction (same layout, same drag & drop, same zone interactions)
**And** solo board.component.ts uses `PlayerFieldComponent` directly (1 instance, `showEmz=true`)

### Story 1.2: Duel Server Scaffold & Protocol Definition

As a developer,
I want a runnable Node.js duel server with the complete WebSocket protocol definition,
So that server and client development can proceed in parallel against a frozen protocol.

**Acceptance Criteria:**

**Given** the duel-server/ project does not exist
**When** the scaffold is created
**Then** `duel-server/` contains: `package.json` (dependencies: `@n1xx1/ocgcore-wasm`, `ws`, `better-sqlite3`, `patch-package`), `tsconfig.json` (strict, ESM, outDir: dist/), `patches/` directory with `@n1xx1+ocgcore-wasm` ESM fix
**And** `src/ws-protocol.ts` defines all WebSocket DTO types as union discriminated types (`SCREAMING_SNAKE_CASE` message types, `camelCase` fields, explicit `null` for absent values, zero internal imports). Message categories: **Server→Client game**: `BOARD_STATE`, `MSG_MOVE`, `MSG_DRAW`, `MSG_DAMAGE`, `MSG_RECOVER`, `MSG_PAY_LPCOST`, `MSG_CHAINING`, `MSG_CHAIN_SOLVING`, `MSG_CHAIN_SOLVED`, `MSG_CHAIN_END`, `MSG_HINT`, `MSG_CONFIRM_CARDS`, `MSG_SHUFFLE_HAND`, `MSG_FLIP_SUMMONING`, `MSG_CHANGE_POS`, `MSG_SWAP`, `MSG_ATTACK`, `MSG_BATTLE`, `MSG_WIN`. **Server→Client prompts**: `SELECT_IDLECMD`, `SELECT_BATTLECMD`, `SELECT_CARD`, `SELECT_CHAIN`, `SELECT_EFFECTYN`, `SELECT_YESNO`, `SELECT_PLACE`, `SELECT_DISFIELD`, `SELECT_POSITION`, `SELECT_OPTION`, `SELECT_TRIBUTE`, `SELECT_SUM`, `SELECT_UNSELECT_CARD`, `SELECT_COUNTER`, `SORT_CARD`, `SORT_CHAIN`, `ANNOUNCE_RACE`, `ANNOUNCE_ATTRIB`, `ANNOUNCE_CARD`, `ANNOUNCE_NUMBER`. **Server→Client system**: `DUEL_END`, `TIMER_STATE`, `RPS_CHOICE`, `RPS_RESULT`, `REMATCH_CANCELLED`, `WORKER_ERROR`, `STATE_SYNC`. **Client→Server**: `PLAYER_RESPONSE`, `SURRENDER`, `REMATCH_REQUEST`
**And** `src/types.ts` defines internal types (worker message types, session state interfaces, constants)
**And** `src/server.ts` creates a `ws.WebSocketServer({ maxPayload: 4096 })` + `node:http` server responding to `GET /health` → 200 and `GET /status` → JSON
**And** `duel-server/LICENSE` contains AGPL-3.0 text
**And** `duel-server/Dockerfile`: `FROM node:20-slim`, `WORKDIR /app`, `COPY package*.json ./`, `RUN npm ci`, `COPY . .`, `RUN npm run build`, `CMD ["node", "dist/server.js"]`, expose port 3001

**Given** the duel server scaffold exists
**When** `docker-compose up duel-server` is run
**Then** the duel-server container starts and `GET /health` returns 200
**And** the docker-compose.yml includes the duel-server service with `./duel-server/data:/app/data:ro` volume mount, `skytrix-internal` network, and `healthcheck: test: ["CMD", "curl", "-f", "http://localhost:3001/health"]`
**And** `GET /status` returns JSON: `{ activeDuels: number, totalDuelsServed: number, uptimeMs: number, memoryUsageMb: number }`

**Given** `ws-protocol.ts` is defined
**When** the Angular PvP types file is created
**Then** `front/src/app/pages/pvp/duel-ws.types.ts` is a manual copy of `ws-protocol.ts` with identical type definitions

### Story 1.3: OCGCore Duel Engine & Anti-Cheat Filter

As a player,
I want a server-side duel engine that enforces all Yu-Gi-Oh! game rules automatically,
So that duels are fair and no manual rule adjudication is needed.

**Acceptance Criteria:**

**Given** the duel server scaffold (Story 1.2) is in place
**When** `duel-worker.ts` is implemented
**Then** it spawns an OCGCore WASM instance via `@n1xx1/ocgcore-wasm`
**And** it runs the duel loop: `duelProcess()` → `getMessage()` → transform to DTO → `parentPort.postMessage()`
**And** it receives player responses via `parentPort.on('message')` → `setResponse()`
**And** it wraps `duelProcess()` in try/catch with a 30-second watchdog timer (`setTimeout` + `worker.terminate()`)
**And** on OCGCore error → sends `WORKER_ERROR` to main thread

**Given** duel-worker.ts exists
**When** `ocg-callbacks.ts` and `ocg-scripts.ts` are implemented
**Then** `loadDatabase(dbPath)` reads `cards.cdb` via `better-sqlite3` and returns a `CardDB` object
**And** `loadScripts(scriptDir)` reads all Lua files from `scripts/` directory and returns a `ScriptDB` object
**And** `cardReader` and `scriptReader` are synchronous callbacks that receive `CardDB`/`ScriptDB` via injection (not global state)
**And** startup health check validates `cards.cdb` readable + `scripts/` non-empty before accepting connections

**Given** duel-worker.ts and data loading exist
**When** `server.ts` manages worker lifecycle
**Then** each duel runs in a dedicated `Worker` thread via `new Worker()`
**And** communication uses typed `postMessage` (never shared memory)
**And** `POST /api/duels` creates a new duel with both players' decklists and spawns a worker
**And** `POST /api/duels/:id/join` notifies the worker that a player's WebSocket is ready

**Given** the duel engine produces messages
**When** `message-filter.ts` processes each message
**Then** it applies a whitelist of per-message-type filter functions: `(message, playerId) → filteredMessage | null`
**And** `MSG_DRAW` card codes are sanitized to 0 for the opponent
**And** `MSG_SHUFFLE_HAND` card codes are sanitized for the opponent
**And** `MSG_MOVE` from private zone to private zone is sanitized for the opponent
**And** `MSG_HINT` with `HINT_EFFECT` containing hand card codes is routed only to the intended player
**And** `MSG_CONFIRM_CARDS` is routed only to the intended player
**And** `SELECT_*` messages are sent only to the deciding player
**And** any unrecognized message type returns `null` (DROP + console.error log)
**And** this is the complete MVP filter set — all other recognized OCGCore message types pass through unfiltered to both players

**Given** `server.ts` receives client→server WebSocket messages
**When** a message arrives from a player
**Then** `server.ts` validates: sender is a registered participant of the duel, message type is in allowed set (`PLAYER_RESPONSE`, `SURRENDER`, `REMATCH_REQUEST`), payload matches expected schema
**And** invalid messages are dropped with `console.error` log (no response sent to client)

### Story 1.4: Spring Boot Deck Relay & Angular WebSocket Connection

As a player,
I want my Angular client connected to the duel server via WebSocket with my deck loaded securely,
So that I can participate in an online duel without exposing my decklist to the opponent.

**Acceptance Criteria:**

**Given** the duel server accepts duels (Story 1.3)
**When** Spring Boot PvP additions are implemented
**Then** `Room.java` JPA entity exists with fields: id, roomCode (`String`, unique, 6-char uppercase alphanumeric), player1, player2, status (`WAITING | CREATING_DUEL | ACTIVE | ENDED`), duelServerId, timestamps
**And** a Flyway migration creates the room table
**And** `RoomController.java` exposes `POST /api/rooms` (create room with decklistId) and `POST /api/rooms/:id/join` (join with decklistId, triggers duel creation)
**And** `RoomService.java` implements the room state machine (`WAITING → CREATING_DUEL → ACTIVE → ENDED`) with 5-second timeout on `CREATING_DUEL` → revert to `WAITING`, and 30-minute timeout on `WAITING` → transition to `ENDED` (orphaned waiting room cleanup via scheduled task)
**And** `DuelServerClient.java` calls `POST /api/duels` on the duel server with both players' validated decklists (server-to-server, deck data never passes through frontend)
**And** `POST /api/rooms/:id/join` response includes `wsUrl` + `duelId` for the Angular client
**And** `/api/rooms/**` routes are protected by existing JWT authentication
**And** JWT token TTL must be ≥2h to cover full duel duration + reconnection window (Spring Boot auth config)

**Given** Spring Boot creates the duel
**When** the Angular PvP module is implemented
**Then** `app.routes.ts` includes lazy-loaded routes: `/pvp` → `LobbyPageComponent` (placeholder), `/pvp/duel/:roomCode` → `DuelPageComponent`, both with auth guard
**And** `DuelPageComponent` is `position: fixed; inset: 0` and scopes `DuelWebSocketService` as a component-level provider
**And** `DuelWebSocketService` establishes a WebSocket connection to `wsUrl` with JWT token at handshake
**And** it exposes 6 signals: `duelState: Signal<DuelState>`, `pendingPrompt: Signal<Prompt | null>`, `hintContext: Signal<HintContext>`, `animationQueue: Signal<GameEvent[]>`, `timerState: Signal<TimerState | null>`, `connectionStatus: Signal<ConnectionStatus>`
**And** Angular signal types mirror ws-protocol.ts DTOs: `DuelState` = `BOARD_STATE` payload (zones map + hand cards + LP + current phase + turn player), `Prompt` = any `SELECT_*` payload, `HintContext` = `MSG_HINT` payload, `TimerState` = `TIMER_STATE` payload, `GameEvent` = any `MSG_*` that triggers animation (MSG_MOVE, MSG_CHAINING, MSG_DAMAGE, etc.), `ConnectionStatus` = `'connected' | 'reconnecting' | 'lost'` (client-only enum)
**And** `connectionStatus` transitions through `connected | reconnecting | lost`
**And** `environment.ts` includes `wsUrl` (`ws://localhost:3001` dev, `wss://domain/ws` prod)

**Given** the WebSocket handshake fails (JWT rejected, server unreachable, timeout)
**When** the connection cannot be established within 5 seconds
**Then** a "Connection failed" overlay is displayed with "Retry" and "Back to lobby" buttons
**And** after 3 consecutive failed attempts: `connectionStatus` transitions to `lost` and only "Back to lobby" remains

**Given** `DuelWebSocketService` receives a `DUEL_END` message
**When** `pendingPrompt` signal is non-null
**Then** the pending prompt is cleared immediately (`pendingPrompt.set(null)`) and the result overlay takes priority

**Given** a room is in `ACTIVE` status in Spring Boot
**When** a periodic health-check (every 60s) queries the duel server and the duel ID is not found
**Then** the room status transitions to `ENDED` (orphaned room cleanup)

### Story 1.5: PvP Board Display (CSS 3D Perspective)

As a player,
I want to see both my field and my opponent's field on a 3D perspective board,
So that I can visually track the game state during a PvP duel.

**Acceptance Criteria:**

**Given** DuelWebSocketService provides `duelState` signal (Story 1.4)
**When** `PvpBoardContainerComponent` is implemented
**Then** it applies CSS `perspective` (`--pvp-perspective-depth: 800px`) and `rotateX` (`--pvp-rotate-x-angle: 15deg`) on the board container
**And** `PlayerFieldComponent` is extended with `@Input() side: 'player' | 'opponent'` controlling CSS mirror transform (`rotateZ(180deg)` for opponent) and `pointer-events` (`none` for opponent's zones)
**And** it composes 2× `PlayerFieldComponent` (own `[side=player, showEmz=false]` + opponent `[side=opponent, showEmz=false]` mirrored)
**And** a central strip between fields contains `SimZoneComponent` for EMZ-L and EMZ-R, `PvpTimerBadgeComponent` (phase name display only, no timer logic), and `PvpPhaseBadgeComponent` placeholder
**And** it enforces `max-width: 1280px; max-height: 720px` on desktop (centered, black background beyond)
**And** it uses `ChangeDetectionStrategy.OnPush`

**Given** the board container renders
**When** `PvpLpBadgeComponent` is implemented
**Then** it displays LP for both players, injected via `<ng-content>` into `PlayerFieldComponent` grid area
**And** it formats LP: standard for ≤9999 ("8000"), compact for ≥10000 ("12.5k")
**And** it has `role="status"` and `aria-live="polite"`

**Given** the board container renders
**When** `PvpHandRowComponent` is implemented
**Then** `[side=player]` displays hand cards face-up as a row at screen bottom (`position: absolute; bottom: 0`), outside the perspective container
**And** `[side=opponent]` displays hand cards face-down at screen top (`pointer-events: none`)
**And** cards overlap with increasing negative `margin-left` when 6+ cards (Master Duel pattern), with incremental `z-index` (last card = highest) so the visible portion of each card is tappable
**And** card height uses `--pvp-hand-card-height: clamp(48px, 12dvh, 72px)`
**And** when prompt sheet is `open`: hand row transitions to `opacity: 0.3; pointer-events: none` (cards accessible via `PromptCardGridComponent` duplication instead)

**Given** the duel page loads on a mobile device in portrait
**When** `matchMedia('(orientation: portrait)')` matches
**Then** a blocking full-screen overlay displays a rotation icon + "Rotate your device to landscape" + actionable instruction
**And** no "Continue anyway" fallback exists
**And** `document.documentElement.requestFullscreen()` + `screen.orientation.lock('landscape-primary')` are called at duel init (graceful degradation if unavailable)

**Given** all PvP-specific visual values
**When** `_design-tokens.scss` is updated
**Then** a `// === PvP tokens ===` section contains all 25+ `--pvp-*` CSS custom properties (perspective, prompts, badges, highlights, timers, transitions, touch targets)
**And** `prefers-reduced-motion: reduce` sets all PvP transition durations to `0ms`

### Story 1.6: Prompt System (Bottom Sheet + 6 Sub-Components)

As a player,
I want to respond to engine prompts via intuitive bottom-sheet dialogs with full context,
So that I understand every decision the engine asks me to make and can respond quickly.

**Acceptance Criteria:**

**Given** `DuelWebSocketService` provides `pendingPrompt` and `hintContext` signals
**When** `PvpPromptSheetComponent` is implemented
**Then** it positions as `position: absolute; bottom: 0` within `DuelPageComponent`
**And** it uses CDK Portal (`<ng-template cdkPortalOutlet>`) to inject the active prompt sub-component
**And** it implements states: `closed`, `opening`, `open`, `transitioning` (swap without close/reopen), `collapsed`, `closing`
**And** it includes a collapse handle (▼) that reduces the sheet to a minimal bar ("Waiting for your response...")
**And** it implements two-beat rendering: Beat 1 renders MSG_HINT context in sheet header, Beat 2 (~50ms after) injects the interactive sub-component via portal
**And** during Beat 1, the portal outlet has `pointer-events: none` (no phantom taps)
**And** if no MSG_HINT precedes SELECT_*, it renders directly with a generic label
**And** CDK `FocusTrap` is active when sheet is `open`, disabled during `collapsed` state
**And** keyboard shortcut `C` toggles collapse handle (collapse/expand)
**And** keyboard shortcut `Space` confirms the active selection (equivalent to tapping confirm button)
**And** prompt type → sub-component mapping: `SELECT_YESNO | SELECT_EFFECTYN → PromptYesNo`, `SELECT_CARD | SELECT_CHAIN | SELECT_TRIBUTE | SELECT_SUM | SELECT_UNSELECT_CARD → PromptCardGrid`, `SELECT_PLACE | SELECT_DISFIELD → PromptZoneHighlight`, `SELECT_POSITION | SELECT_OPTION → PromptOptionList`, `ANNOUNCE_NUMBER | SELECT_COUNTER | ANNOUNCE_RACE | ANNOUNCE_ATTRIB | ANNOUNCE_CARD → PromptNumericInput`, `RPS_CHOICE → PromptRps`

**Given** the prompt sheet exists
**When** `PromptYesNoComponent` (Pattern C — compact sheet) is implemented
**Then** it handles `SELECT_YESNO` and `SELECT_EFFECTYN` prompts
**And** it displays MSG_HINT context text + card art thumbnail + two buttons ("Yes" / "No")
**And** `preferredHeight` is `compact` (`clamp(60px, 20dvh, 100px)`)
**And** buttons have `min-height: 48px` touch targets
**And** keyboard shortcuts: `Y` for Yes, `N` for No

**Given** the prompt sheet exists
**When** `PromptCardGridComponent` (Pattern B — full sheet) is implemented
**Then** it handles `SELECT_CARD`, `SELECT_CHAIN`, `SELECT_TRIBUTE`, `SELECT_SUM`, `SELECT_UNSELECT_CARD`
**And** it displays a horizontal row of card thumbnails with name labels
**And** ≤4 cards: large thumbnails centered; 5–9: standard side by side; 10–12: horizontal scroll; >12 cards: 2-row layout (threshold `--pvp-card-grid-row-threshold: 12`)
**And** tap card → glow highlight (`--pvp-selection-glow`) + `scale(1.05)` 150ms; confirm button always present
**And** hand cards are duplicated in the grid for thumb accessibility
**And** `preferredHeight` is `full` (`max-height: 55dvh`)
**And** if `cards.length === 0`: displays "No valid targets", auto-responds after 1s
**And** keyboard shortcuts: `1-9` select corresponding card by position in grid

**Given** the prompt sheet exists
**When** `PromptZoneHighlightComponent` (Pattern A — floating instruction) is implemented
**Then** it handles `SELECT_PLACE` and `SELECT_DISFIELD`
**And** no sheet is opened — a floating instruction text appears centered on the board (`pointer-events: none`, board interactive behind)
**And** eligible empty zones display numbered badges (24px+, `--pvp-min-touch-target` compliant)
**And** tap a zone badge → selection sent to server, instruction disappears

**Given** the prompt sheet exists
**When** `PromptOptionListComponent` (Pattern B — variable height) is implemented
**Then** it handles `SELECT_POSITION`, `SELECT_OPTION`
**And** it displays a vertical list of `mat-button` options with optional icons
**And** `preferredHeight` is `N × 48px` (falls back to `full` if N > 5)

**Given** the prompt sheet exists
**When** `PromptNumericInputComponent` (Pattern B — compact) is implemented
**Then** it handles `ANNOUNCE_NUMBER`, `SELECT_COUNTER`, `ANNOUNCE_RACE`, `ANNOUNCE_ATTRIB`, `ANNOUNCE_CARD`
**And** mode `declare`: free input with validation; mode `counter`: stepper (−/+)
**And** min/max constraints from server message are enforced

**Given** the prompt sheet exists
**When** `PromptRpsComponent` (Pattern B — full) is implemented
**Then** it displays three large tap zones for Rock, Paper, Scissors
**And** 30-second timeout → random selection if no choice
**And** keyboard shortcuts: 1/2/3

**Given** any SELECT_* type not yet fully implemented
**When** the duel service receives it
**Then** it auto-selects the first valid option and sends the response automatically (PvP-A0 fallback)

### Story 1.7: Turn Actions, Phase Controls & Information Display

As a player,
I want to see my available actions on the board, control phase transitions, inspect cards, and configure my activation preferences,
So that I can play a complete turn with full information and strategic control.

**Acceptance Criteria:**

**Given** the duel service receives `SELECT_IDLECMD` during Main Phase
**When** the distributed UI renders
**Then** cards with available actions pulse with `--pvp-actionable-glow` (subtle continuous pulse on `--pvp-accent`)
**And** tapping a card with 1 action sends the action directly to the server
**And** tapping a card with 2+ actions opens a Card Action Menu (absolute-positioned `<div>` at card position) with `<button>` items (e.g., "Normal Summon" / "Set" / "Activate Effect")
**And** tapping a menu item sends the action; tapping outside closes the menu
**And** the menu has `role="menu"`, focus trapped, `Escape` closes, arrow keys navigate, `Enter` selects
**And** zone browsers (GY, Banished, ED) highlight actionable cards in action mode

**Given** the duel service receives `SELECT_BATTLECMD` during Battle Phase
**When** the distributed UI renders
**Then** attackable monsters pulse with `--pvp-actionable-glow`
**And** tapping a monster opens attack target selection (Card Action Menu or direct if 1 target)

**Given** `PvpPhaseBadgeComponent` is implemented
**When** it's the player's own turn
**Then** tapping the badge expands a menu with available phase transitions ("Battle Phase", "Main Phase 2", "End Turn") extracted from IDLECMD/BATTLECMD
**And** tapping a transition sends the response to the server; menu closes
**And** the badge border shows accent color (`--pvp-accent`) during own turn
**When** it's the opponent's turn
**Then** the badge shows current phase read-only (`opacity: 0.6`, non-interactive)

**Given** `PvpZoneBrowserOverlayComponent` is implemented
**When** the player taps a GY, Banished, or Extra Deck zone
**Then** a scrollable card list overlay opens with card name + art thumbnail
**And** in browse mode (no active IDLECMD): tap card → `CardInspectorComponent`
**And** in action mode (during IDLECMD): actionable cards show `--pvp-actionable-glow` + action label; tap actionable card with 1 action → sends directly; 2+ actions → Card Action Menu
**And** opponent Extra Deck shows face-down count only (not browsable individually)
**And** the overlay is disabled during active prompt (use collapse handle to inspect board instead)

**Given** `CardInspectorComponent` PvP variants are implemented
**When** the player taps any face-up card on the board or in a public zone
**Then** below 768px: compact variant (art 60×87px + name + type + ATK/DEF); tap to expand full text
**And** at ≥768px: full variant (large art + all stats + card text)
**When** a prompt arrives while inspector is expanded
**Then** inspector transitions to compact (not closed), repositions above the sheet
**And** tap compact → re-expand (temporary z-index bump); new prompt → back to compact

**Given** `PvpActivationToggleComponent` is implemented
**When** the player taps the toggle (inside mini-toolbar, bottom-right, thumb zone)
**Then** it cycles through Auto → On → Off → Auto
**And** Auto (default): client filters optional prompts based on OCGCore `MSG_HINT` type — prompts shown when HINT indicates game event context (activation response, summon response, attack response, end-of-phase). Not a hardcoded event list
**And** On: prompts at every legal priority window
**And** Off: auto-responds "No"/"Pass" to all optional prompts
**And** visible during own turn only, hidden during opponent's turn
**And** per-duel lifecycle: resets to Auto at duel start
**And** `aria-label="Activation toggle: [current state]"`, `Space` to cycle (only when no prompt `FocusTrap` is active — prompt sheet captures `Space` for confirm), `LiveAnnouncer` on change

**Given** the mini-toolbar is implemented
**When** the duel page renders
**Then** the toolbar contains the surrender button (icon, placeholder — actual surrender logic in Epic 3) and the activation toggle
**And** it is positioned `absolute, bottom-right` outside the CSS perspective container
**And** both elements have `min-height: 44px` touch target

## Epic 2: Lobby & Matchmaking ✅ COMPLETED

Players can create duel rooms from decklists, browse the lobby, join a room with a validated deck, and start duels through RPS.

### Story 2.1: Room Creation from Decklist

As a player,
I want to create a PvP duel room from any valid decklist,
So that I can invite a friend to duel with my prepared deck.

**Acceptance Criteria:**

**Given** the player is on any decklist page
**When** they tap "Duel PvP"
**Then** the system validates the deck (TCG format, TCG banlist compliance, 40-60 main deck, 0-15 extra deck, 0-15 side deck)
**And** if validation fails: `mat-snackbar` with error reason + link to deckbuilder
**And** if validation passes: `POST /api/rooms` with decklistId → room created with status `WAITING` and a 6-char room code generated by `RoomService.java` via `UUID.randomUUID().toString().substring(0,6).toUpperCase()` (no external dependency, URL-safe, non-sequential — not the DB id)
**And** the player is navigated to `/pvp/duel/:roomCode` (waiting room state, deep links use room code not DB id)

**Given** the room is created
**When** the waiting room state renders
**Then** a 4-6 character room code is displayed prominently
**And** a "Copy Link" button copies the deep link (`skytrix.app/pvp/XXXX`) to clipboard with `mat-snackbar` confirmation
**And** a `mat-progress-spinner` + "Waiting for opponent..." is displayed
**And** the component polls `GET /api/rooms/:id` every 2-3 seconds to detect opponent join

### Story 2.2: Room Browsing & Joining

As a player,
I want to browse available duel rooms and join one with a valid deck,
So that I can find an opponent to duel.

**Acceptance Criteria:**

**Given** the player navigates to `/pvp` (LobbyPageComponent)
**When** the lobby page loads
**Then** `GET /api/rooms` returns a list of rooms with status `WAITING`
**And** each room displays: creator name, creation time
**And** if no rooms exist: "No rooms available. Create one!" + Create Room button
**And** a loading `mat-progress-spinner` is shown during fetch

**Given** available rooms are displayed
**When** the player taps "Join" on a room
**Then** the system prompts for deck selection (list of player's valid decklists)
**And** if no valid decklists exist: display "No valid decks available" + link to deckbuilder, Join action disabled
**And** the selected deck is validated (TCG format, TCG banlist, deck size)
**And** if validation fails: `mat-snackbar` with error reason
**And** if validation passes: `POST /api/rooms/:id/join` with decklistId → response includes `wsUrl` + `duelId`
**And** the player is navigated to `/pvp/duel/:roomCode`

**Given** the player taps "Join" on a room
**When** `POST /api/rooms/:id/join` returns 409 (room already full)
**Then** `mat-snackbar` displays "Room is full" and the room is removed from the displayed list

### Story 2.3: Waiting Room & Duel Start (RPS)

As a player,
I want the duel to start automatically with Rock-Paper-Scissors when my opponent joins,
So that we can fairly determine who plays first.

**Acceptance Criteria:**

**Given** both players are in the room (polling detects opponent join or player just joined)
**When** WebSocket connections are established for both players
**Then** RPS logic runs in `server.ts` (pre-OCGCore, before worker spawn): server sends `RPS_CHOICE` prompt to both clients simultaneously via `PromptRpsComponent` (Story 1.6)
**And** each player selects Rock, Paper, or Scissors within 30 seconds
**And** if timeout: system selects randomly for the timed-out player

**Given** both RPS selections are received
**When** `server.ts` resolves RPS
**Then** server sends `RPS_RESULT` to both clients (both choices + winner ID) for simultaneous reveal animation
**And** the winner receives a turn order prompt via `HAND_RES`: "Go First" / "Go Second" (`PromptOptionListComponent`)
**And** if draw: RPS repeats (new `RPS_CHOICE` sent)

**Given** turn order is decided
**When** `server.ts` spawns the duel worker with OCGCore
**Then** OCGCore distributes 5 cards to each player's hand automatically
**And** the duel enters Draw Phase of the first turn
**And** the board transitions from waiting room state to active duel state

### Story 2.4: Deep Links, Sharing & Duel Loading Screen

As a player,
I want to share a room link easily and see a loading screen while the duel prepares,
So that my friend can join instantly and I'm never confused by a blank screen.

**Acceptance Criteria:**

**Given** a room is created
**When** the player taps "Share" on mobile
**Then** the Web Share API native share sheet opens with the deep link URL
**And** fallback: copy to clipboard if Web Share API unavailable

**Given** a player opens a deep link `/pvp/duel/:roomCode`
**When** they are not authenticated
**Then** they are redirected to login → post-login redirect back to the room
**When** they are authenticated
**Then** they join the room directly (deck selection prompt if no deck specified)

**Given** a player opens a deep link `/pvp/duel/:roomCode`
**When** the room does not exist or its status is `ENDED`
**Then** the player is redirected to `/pvp` (lobby) with `mat-snackbar` "Room not found or already ended"

**Given** both players have joined and RPS is resolved
**When** the duel is initializing
**Then** a duel loading screen displays: both player names + LP (8000 vs 8000) + "Preparing duel..." + `mat-progress-spinner` (indeterminate, 64px)
**And** the client pre-fetches card thumbnails for both decks
**And** the loading screen holds until first board state arrives from server AND critical thumbnails are pre-cached
**And** if a thumbnail fails to load: card back is used as fallback
**And** if 15 seconds pass without first board state arriving: display "Taking longer than expected..." + "Return to lobby" button

## Epic 3: Session Resilience & Duel Lifecycle ✅ COMPLETED

The PvP experience handles real-world conditions — surrender, disconnection/reconnection, turn timers, inactivity, and clear duel results with rematch.

### Story 3.1: Surrender

As a player,
I want to surrender during a PvP duel at any point,
So that I can gracefully concede when a loss is inevitable.

**Acceptance Criteria:**

**Given** the player is in an active duel
**When** they tap the surrender button (mini-toolbar, bottom-right)
**Then** if a prompt sheet is open, it is dismissed first (pending prompt discarded client-side)
**And** a confirmation dialog opens: "Are you sure you want to surrender?" with "Surrender" (destructive) and "Cancel" buttons
**And** the dialog uses `mat-dialog` with `role="alertdialog"` and `aria-label="Surrender confirmation"`
**And** surrender takes priority over any pending prompt — the server discards the unanswered SELECT_* upon receiving `SURRENDER`

**Given** the surrender confirmation dialog is open
**When** the player confirms
**Then** a `SURRENDER` message is sent to the duel server via WebSocket
**And** the server sets the match result: opponent wins, reason `surrender`
**And** the server notifies both players with `DUEL_END` message containing outcome + reason
**And** both clients transition to the duel result screen (Story 3.4)

**Given** the player is in a duel
**When** they press browser back or navigate away
**Then** a `CanDeactivate` guard intercepts navigation
**And** a surrender confirmation dialog opens (same as above)
**And** if confirmed: surrender is sent, navigation proceeds after result screen
**And** if cancelled: navigation is blocked, player remains in duel

### Story 3.2: Turn Timer & Inactivity Timeout

As a player,
I want a visible turn timer and automatic timeout enforcement,
So that duels progress at a reasonable pace and idle players don't stall the game.

**Acceptance Criteria:**

**Given** the duel server manages turn timing
**When** a new duel starts
**Then** each player's time pool is initialized to 300 seconds
**And** at the start of each subsequent turn (not the first), the active player's pool receives +40 seconds (added to remaining, no cap)
**And** the timer counts down only during the active player's decision windows
**And** the timer pauses during chain resolution, opponent's actions, and server processing
**And** the server sends `TIMER_STATE` messages to both clients with: `activePlayerId`, `remainingMs`, `running: boolean`

**Given** `PvpTimerBadgeComponent` receives `timerState` signal
**When** the timer is running
**Then** it displays `mm:ss` countdown (own color: `--pvp-accent`; opponent: `--pvp-timer-opponent`)
**And** below 30s: text pulses with `--pvp-timer-critical` (red)
**And** `aria-live="assertive"` announces at 60s, 30s, 10s thresholds via `LiveAnnouncer`

**Given** a player's time pool reaches 0
**When** the server detects timeout
**Then** the server declares the opponent as winner, reason `timeout`
**And** both clients receive `DUEL_END` with outcome + reason `timeout`

**Given** the server fires an inactivity timeout
**When** a player response arrives within 500ms of the timeout event
**Then** the server processes the response and cancels the timeout (player response wins the race condition)

**Given** a player has an active prompt (any SELECT_*)
**When** 100 seconds pass without any action from that player
**Then** the server declares the opponent as winner, reason `inactivity`
**And** both clients receive `DUEL_END` with outcome + reason `inactivity`
**And** the inactivity timer resets on every player action (including prompt responses, phase transitions)

### Story 3.3: Disconnection Handling & Reconnection

As a player,
I want to reconnect to my duel if my connection drops,
So that temporary network issues don't automatically forfeit my match.

**Acceptance Criteria:**

**Given** a player's WebSocket connection drops
**When** the duel server detects disconnection
**Then** the server starts a 60-second reconnection grace period for the disconnected player
**And** the turn timer pauses for the disconnected player during the grace period
**And** the opponent's `PvpTimerBadgeComponent` displays "Opponent connecting..." (replacing the timer text)
**And** the disconnected player's client sets `connectionStatus` signal to `reconnecting`

**Given** the player's client detects disconnection (`connectionStatus = reconnecting`)
**When** it attempts reconnection
**Then** `DuelWebSocketService` implements exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
**And** each attempt includes the JWT token for re-authentication at handshake
**And** the UI shows a "Reconnecting..." overlay (semi-transparent, `PvpTimerBadgeComponent` text update)

**Given** reconnection succeeds within 60 seconds
**When** the WebSocket is re-established
**Then** the server sends a full game state snapshot (via `duelQueryField()` + `duelQuery()` per card — not message log replay)
**And** the client hydrates all 6 signals from the snapshot
**And** the turn timer resumes from where it was paused
**And** `connectionStatus` transitions to `connected`
**And** if a prompt was pending at disconnect: it is re-sent to the player

**Given** the reconnection grace period (60 seconds) expires
**When** the player has not reconnected
**Then** the server declares the opponent as winner, reason `disconnect_timeout`
**And** both clients (connected player + future reconnect) receive `DUEL_END`
**And** the disconnected player sees the result screen upon eventual reconnection or next page load

**Given** both players disconnect simultaneously
**When** the server detects dual disconnection
**Then** the duel state is preserved server-side for up to 4 hours
**And** the first player to reconnect resumes normally
**And** if neither reconnects within 4 hours: duel is cleaned up, result is draw

**Given** the app goes to background (`visibilitychange` event)
**When** it returns to foreground
**Then** the client verifies WebSocket connectivity
**And** if disconnected: triggers reconnection flow
**And** if connected: requests a state sync from server
**And** if actions were auto-resolved during background: a `mat-snackbar` informs the player

**Given** the player opens a second tab for the same duel
**When** `BroadcastChannel` (fallback: `localStorage` event) detects duplicate
**Then** the second tab displays "Duel already active in another tab" and refuses to connect
**And** only one WebSocket connection per player per duel is allowed

### Story 3.4: Duel Result Screen & Rematch

As a player,
I want to see a clear result screen after the duel ends with the option to rematch,
So that I know the outcome and can quickly play again.

**Acceptance Criteria:**

**Given** the duel ends (any reason: LP=0, surrender, timeout, inactivity, disconnect)
**When** the client receives `DUEL_END` message
**Then** `PvpDuelResultOverlayComponent` renders as a full-screen overlay over the board
**And** it displays: outcome text "VICTORY" / "DEFEAT" / "DRAW" (large, centered) + reason text ("Opponent surrendered", "Opponent timed out", "Opponent LP reduced to 0", "Opponent disconnected", "Simultaneous LP depletion")
**And** the outcome text uses color coding: victory = `--pvp-victory`, defeat = `--pvp-defeat`, draw = `--pvp-draw`
**And** `LiveAnnouncer` announces the result for accessibility

**Given** the result screen is displayed
**When** both players are on the result screen
**Then** a "Rematch" button is available
**And** tapping "Rematch" sends a `REMATCH_REQUEST` WebSocket message to the duel server
**And** the duel server tracks rematch acceptance per player; when both players have sent `REMATCH_REQUEST`, it creates a new duel (same decklists, new OCGCore instance, new worker thread) and sends RPS prompts — same flow as Story 2.3 but triggered server-side without Spring Boot round-trip
**And** `server.ts` retains both players' decklists in session state (`Map<duelId, { player1Deck, player2Deck }>`) after duel creation, enabling rematch without Spring Boot round-trip. Session cleanup: decklists removed when room transitions to `ENDED`
**And** if both players request rematch within 5 minutes: new duel starts (same decks, no side decking, new RPS)
**And** if one player leaves: the duel server sends `REMATCH_CANCELLED` to the remaining player; "Opponent left" is displayed and Rematch becomes disabled

**Given** the result screen is displayed
**When** the player taps "Leave Room"
**Then** the WebSocket connection is closed cleanly
**And** the player is navigated to `/pvp` (lobby)

**Given** the result screen is displayed
**When** the player taps "Back to Deck"
**Then** the WebSocket connection is closed cleanly
**And** the player is navigated to the decklist they used for the duel

**Given** a room is on the result screen
**When** 5 minutes pass without rematch
**Then** the room status transitions to `ENDED`
**And** the result screen shows "Room closed" and only "Back to Lobby" / "Back to Deck" remain

## Epic 5: Tech Debt Cleanup ✅ COMPLETED

Technical debt accumulated across Epics 1–4 is resolved. All items were documented in retrospectives and confirmed for resolution by the Project Lead.

### Story 5.1: Card Inspector PvP Placeholder

As a player,
I want to long-press or click a card on the PvP board to open a card inspector overlay,
So that I can read card effects and check stats during a duel.

**Acceptance Criteria:**

**Given** a card is displayed on the PvP board (any zone: monster, spell/trap, field, GY, banished, extra, hand)
**When** the player taps/clicks the card
**Then** a `CardInspectorComponent` overlay opens showing the full card image, name, description, ATK/DEF, and card type
**And** the overlay uses the existing `CardInspectorComponent` from `components/` (solo simulator)
**And** the overlay does not block game prompts (closes automatically when a prompt appears)
**And** the overlay can be dismissed by tapping outside or pressing Escape

**Technical debt source:** Epic 1 Story 1-7 — placeholder TODO in `prompt-card-grid.component.ts:146`

### Story 5.2: Reconnection Edge Cases (Story 3-3b)

As a player,
I want robust reconnection handling for edge cases (multi-tab, background tab, simultaneous disconnection),
So that duels survive unusual but realistic network and browser scenarios.

**Acceptance Criteria:**

**Given** the player has the duel open in multiple browser tabs (BroadcastChannel scenario)
**When** both tabs attempt to reconnect simultaneously
**Then** only one tab successfully reconnects, the other receives a clear "session active in another tab" message
**And** the duel continues normally in the active tab

**Given** the player's browser tab goes to background (visibilitychange)
**When** the tab becomes visible again after a brief background period (< 60s)
**Then** the WebSocket connection is verified and reconnected if needed
**And** the board state is re-synced via BOARD_STATE message

**Given** both players disconnect simultaneously
**When** both players reconnect within the 60-second grace period
**Then** the duel resumes normally for both players
**And** if neither reconnects within 60s, the duel is ended as a draw

**Technical debt source:** Epic 3 Story 3-3 — scope reduction to 3-3a (basic reconnection only)

### Story 5.3: Room Management Fixes

As a player,
I want correct navigation back to my deck after a duel, and I want stale rooms cleaned up automatically,
So that the lobby stays clean and deck navigation works properly.

**Acceptance Criteria:**

**Given** a duel has ended and the player clicks "Back to Deck"
**When** the RoomDTO includes the deck ID used to join the room
**Then** the player navigates to `/deck/:id` (specific deck) instead of `/deck` (deck list)
**And** `RoomDTO` is extended with `deckId: number` field on both Spring Boot and Angular sides

**Given** a duel room was created but the duel-server ended the duel (5-min timeout, disconnect, etc.)
**When** the Spring Boot backend checks for stale rooms (scheduled task, e.g., every 5 minutes)
**Then** rooms whose duel-server session is expired are marked as CLOSED in the database
**And** CLOSED rooms do not appear in the lobby room list

**Technical debt source:** Epic 3 Story 3-4 — RoomDTO lacks deck ID fields + orphaned room cleanup

### Story 5.4: Infrastructure & Optimization

As a developer,
I want Docker container integration tests and optimized thumbnail loading,
So that deployment confidence is higher and duel loading is faster.

**Acceptance Criteria:**

**Given** the duel-server Docker container is built
**When** an integration test suite runs against the container
**Then** the test verifies: `GET /health` returns 200, `GET /status` returns valid JSON, WebSocket connection can be established, a minimal duel can be started and completed
**And** the test runs in CI or locally via `npm run test:integration`

**Given** a duel is loading (loading screen phase)
**When** the client prepares card thumbnails for display
**Then** thumbnails for ALL cards in both players' decks (main + extra) are pre-fetched, not just hand cards
**And** pre-fetch uses `<link rel="prefetch">` or equivalent lazy loading strategy
**And** duel board rendering shows card images without visible loading delay

**Technical debt source:** Epic 1 Story 1-2 (Docker test) + Epic 2 Story 2-4 (thumbnail pre-fetch)

## Epic 6: Chain Overlay Refactoring ✅ COMPLETED

The chain visualization is refactored from simple on-card CSS badges (Story 4.1) to a dedicated full-screen overlay component matching Master Duel's chain cascade animation. This is a structural refactoring (PvP-A scope), not visual polish — the overlay is a new component with its own lifecycle, animation timing, and board-change detection logic.

**Replaces:** Story 4.1 (Chain Link Visualization) — old implementation fully removed.

**Reference:** `master_duel_chain.jpg`, updated `ux-design-specification-pvp.md` (PvpChainOverlayComponent spec).

### Story 6.1: Teardown Old Chain Badges & Scaffold PvpChainOverlayComponent

As a player,
I want the old on-card chain badges replaced by a dedicated chain overlay component,
so that chain visualization can evolve into a full Master Duel-style cascade animation.

**Acceptance Criteria:**

**Given** the old `.pvp-chain-badge` CSS class and `#chainBadgeTpl` ng-template exist in PvpBoardContainerComponent
**When** this story is complete
**Then** all chain badge rendering is removed from PvpBoardContainerComponent (template, SCSS, computed signals, input)
**And** existing chain badge tokens are updated (`--pvp-chain-badge-size` 24→28px), `--pvp-chain-resolve-pulse` removed (both main and reduced-motion), and 9 new chain overlay tokens are added
**And** `PvpChainOverlayComponent` exists as a standalone component shell (fixed overlay, `pointer-events: none`, signal inputs for `activeChainLinks`, `phase`, `promptActive`, `boardChanged`)
**And** a `chainPhase` signal (`'idle' | 'building' | 'resolving'`) is added to DuelConnection tracking chain lifecycle
**And** animation orchestrator chain event durations are updated for overlay timing
**And** the orchestrator is migrated to support async events: `processEvent()` returns `number | 'async'`, with `chainOverlayReady` / `chainOverlayBoardChanged` signals and `_boardEventsSinceSolving` counter scaffolded for Story 6.3 board-change detection

### Story 6.2: Chain Overlay Card Cascade & Construction Animation (FIFO)

As a player,
I want the chain overlay to display cards in a Master Duel-style 3-card cascade with depth effect and chain connectors, appearing rhythmically as each chain link is added,
so that I can visually follow chain construction with a cinematic feel.

**Acceptance Criteria:**

**Given** the chain overlay is visible and contains 1+ chain links
**When** the overlay renders during construction phase
**Then** cards are displayed in a vertical cascade layout (max 3 visible): front `scale(1.0)`, mid `scale(0.85)`, back `scale(0.70)`, with `rotateY(±8deg)` alternating by parity
**And** `perspective: 800px` on the card container (CSS property, not transform function) creates a shared vanishing point for depth
**And** visual chain connectors (SVG or CSS fallback) link adjacent cards
**And** older cards (4th+) exit upward with fade-out
**And** the overlay appears/disappears rhythmically between chain links (400ms appear + 300ms fade-out): board visible between each
**And** new cards enter from below with scale-up animation, existing cards shift to new positions
**And** `prefers-reduced-motion: reduce` → no animations, instant positions
**And** `LiveAnnouncer` announces "Chain Link [N]: [cardName] added" on each link

### Story 6.3: Chain Resolution Animation (LIFO) & Board Change Detection

As a player,
I want the chain overlay to animate resolution in reverse order (LIFO) with the resolving card highlighted, and the overlay to pause and reveal the board when a card effect changes the game state,
so that I can see each chain effect's impact on the board before the next one resolves.

**Acceptance Criteria:**

**Given** the chain is in resolving phase
**When** MSG_CHAIN_SOLVING fires for a chain link
**Then** the front card pulses with golden glow (`scale 1.0→1.1→1.0`, `box-shadow: var(--pvp-chain-glow-resolving)`)
**And** on MSG_CHAIN_SOLVED, the front card exits (slide-out + fade), remaining cards promote positions

**Given** the board state changed after a chain link resolved (detected via orchestrator event counting between MSG_CHAIN_SOLVING and MSG_CHAIN_SOLVED)
**When** the card exit animation completes
**Then** the overlay fades out for 500ms, revealing the board impact, then resumes for the next link
**And** the orchestrator waits for the overlay's `chainOverlayReady` signal before dequeuing the next event (async contract from Story 6.1 AC6)
**And** if board state is unchanged, the overlay transitions directly (no pause)

**Given** auto-resolve is active (no prompt interrupts)
**When** the chain resolves automatically
**Then** all timings are reduced (construction 250ms, resolution 150ms, board pause 300ms)
**And** prompt interruption reverts to normal timing

**Given** a chain of exactly 1 link
**When** it resolves
**Then** skip the resolution overlay entirely (card was shown during construction), only perform board-change pause if applicable

**Given** `prefers-reduced-motion: reduce` is active
**When** the chain resolves
**Then** no animations, instant state changes, no dramatic pauses

**Given** disconnection during chain resolution
**When** STATE_SYNC is received
**Then** overlay disappears instantly, all chain state cleared

## Epic 7: Board Animations & Card Travel

Board animations replace in-place glow effects (pvp-summon-flash, pvp-destroy-flash) with spatial card travel between zones. Board events during chain resolution are buffered and replayed as visible animations. XYZ monsters gain stacked material indicators with detach animations.

**Reference:** `ux-design-board-animations.md`

### Story 7.1: CardTravelService & Zone Element Registry

As a developer,
I want a dedicated `CardTravelService` and a zone element registry on the board container,
So that card travel animations can resolve source/destination DOM positions and animate floating card elements between zones.

**Acceptance Criteria:**

**Given** PvpBoardContainerComponent renders zone elements
**When** the component initializes
**Then** a zone element registry exposes a `getZoneRect(zoneKey: string): DOMRect | null` method that returns `getBoundingClientRect()` for any rendered zone (MZ, SZ, hand, deck, extra, GY, banished, EMZ)
**And** non-field zones (hand, deck, extra, GY, banished) resolve to the center of their pile/container element

**Given** `CardTravelService` is component-scoped and needs access to zone DOM rects
**When** the service is injected alongside the board container
**Then** the board container registers its `getZoneRect()` method with the `CardTravelService` during `ngAfterViewInit` (e.g., via a `registerZoneResolver(fn)` callback) — the service does not directly reference the board component, preserving unidirectional dependency

**Given** `CardTravelService` is provided as component-scoped (same scope as `AnimationOrchestratorService`)
**When** `travel(source, destination, cardImage, options)` is called
**Then** a `position: fixed` floating `<div>` is created in the document body with the card image (face or back) sized to match the source zone's card dimensions
**And** it is positioned at the source zone's bounding rect
**And** Web Animations API (`element.animate()`) drives the Lift → Travel → Land keyframes
**And** the method returns `Promise<void>` that resolves after the floating element is removed on animation completion

**Given** multiple concurrent `travel()` calls are in progress
**When** each call creates its own floating element
**Then** all floating elements animate independently without interference

**Given** `prefers-reduced-motion: reduce` is active
**When** `travel()` is called
**Then** no floating element is created, the Promise resolves immediately (card appears/disappears instantly via BOARD_STATE)

**Given** multiple floating card elements exist simultaneously (parallel travel animations)
**When** the `CardTravelService` creates floating elements
**Then** all floating elements use a z-index above the board surface but below the chain overlay and prompt overlay — ensuring travels are visible during normal gameplay but never obscure chain/prompt UI during replay

**Given** `getZoneRect(zoneKey)` returns `null` (zone not yet rendered or already destroyed)
**When** `travel()` is called with a source or destination that resolves to `null`
**Then** the travel is skipped silently — the Promise resolves immediately, and the card appears/disappears via BOARD_STATE (graceful degradation, same as reduced-motion path)

**Given** the `DuelPageComponent` is destroyed during active travel animations (navigation away, disconnect)
**When** `CardTravelService.ngOnDestroy` is called
**Then** all in-flight floating `<div>` elements are immediately removed from `document.body`
**And** all pending animation Promises are resolved (no dangling Promises or orphaned DOM nodes)

**Given** `travel()` accepts a `cardImage` parameter
**When** the orchestrator calls `travel()`
**Then** `cardImage` is a string URL (card image path) and the `options` object controls face/back display (`options.showBack: boolean`) — the Travel phase flip (e.g., destroy → flip to back) is driven by `options.flipDuringTravel: boolean`, not by swapping the image URL

**Given** zones opponent are rendered under CSS `perspective` + `rotateX` + `rotateZ(180deg)`
**When** `getZoneRect()` is called for an opponent zone
**Then** the rect returned corresponds to the visual on-screen position (post-transformation) — `getBoundingClientRect()` natively returns post-transform coords, so the `position: fixed` floating element aligns visually with the target zone without manual compensation

### Story 7.2: Card Travel Animations for MSG_MOVE Events

**Depends on:** Story 7.1 (CardTravelService & zone element registry)

As a player,
I want card movements between zones (summon, destroy, bounce, return to deck, field-to-field) to display as spatial travel animations instead of in-place glow effects,
So that I can visually perceive where a card came from and where it went.

**Acceptance Criteria:**

**Given** a MSG_MOVE event for a summon (hand/deck/extra → MZ/SZ)
**When** the orchestrator processes the event
**Then** `CardTravelService.travel()` is called with source = origin zone, destination = target zone, card face visible on arrival
**And** a green impact glow pulses on the destination zone during the Land phase
**And** the orchestrator returns the travel Promise duration (~400ms) instead of the previous fixed 300ms

**Given** MSG_MOVE contains `fromLocation`/`fromSequence` and `toLocation`/`toSequence`
**When** the orchestrator processes a MSG_MOVE
**Then** it uses the MSG_MOVE payload fields (not the current BOARD_STATE) to determine source and destination zones for the travel animation — the BOARD_STATE may already reflect the final position

**Given** a MSG_MOVE event for a destroy (MZ/SZ → GY/banished)
**When** the orchestrator processes the event
**Then** `CardTravelService.travel()` is called with card flipping to back during the Travel phase
**And** a red departure glow appears on the source zone during the Lift phase

**Given** a MSG_MOVE event for a bounce (MZ/SZ → hand)
**When** the orchestrator processes the event
**Then** `CardTravelService.travel()` is called with no destructive glow
**And** the travel uses a reduced `rotateY(4deg)` (half of the standard 8deg) and `ease-out` easing (instead of `ease-in-out`) for a lighter, non-aggressive feel

**Given** a MSG_MOVE event for return to deck (MZ/SZ → deck)
**When** the orchestrator processes the event
**Then** card flips to back during travel, deck pile pulses on arrival with a neutral glow (same color as field-to-field)

**Given** a MSG_MOVE event for field-to-field (MZ → MZ or SZ → SZ)
**When** the orchestrator processes the event
**Then** direct travel with neutral glow

**Given** a token is destroyed (detected via `card.isToken === true` on the `CardInstance` in the zone data model)
**When** the orchestrator processes the token destruction event
**Then** the token dissolves in-place (fade out + scale down), no travel animation to GY

**Given** multiple cards travel simultaneously (e.g., Raigeki → 5 destroys)
**When** the orchestrator processes the batch
**Then** each card departs with ~50ms stagger between them
**And** cards converge toward the destination with slight position offsets to prevent overlap

**Given** the speed multiplier is active (`speedMultiplierFn()`)
**When** any travel animation plays
**Then** all durations are multiplied by the speed factor
**And** the travel duration never drops below the 200ms floor

**Given** `pvp-summon-flash` and `pvp-destroy-flash` CSS keyframes exist in the board styles
**When** this story is complete
**Then** both keyframes and their associated CSS classes are removed from the codebase (replaced by travel animations)
**And** before removal, a codebase-wide grep confirms `pvp-summon-flash` and `pvp-destroy-flash` are not referenced outside `pvp-board-container.component.scss`
**And** the `.pvp-animating-zone` class (if it exists) is updated to work with the new `Set<string>` from `animatingZoneKeys`
**And** `pvp-flip-flash` and `pvp-activate-flash` keyframes remain unchanged (in-place by nature)

**Given** the `--pvp-actionable-glow` (blue/gold interactive glow indicating actionable cards during IDLECMD/BATTLECMD)
**When** this story is complete
**Then** the interactive actionable glow system is completely untouched — it is prompt system UI, not animation effects, and must continue to function identically

### Story 7.3: Buffer & Replay During Chain Resolution

**Depends on:** Story 7.1 (CardTravelService), Story 7.2 (MSG_MOVE travel animations)

As a player,
I want board events during chain resolution to be buffered and replayed as visible card travel animations when the overlay briefly hides,
So that I can see each chain link's impact on the board as spatial card movements instead of instant state changes.

**Acceptance Criteria:**

**Given** the orchestrator is inside chain resolution (`_insideChainResolution = true`) and receives a board-changing event (MSG_MOVE, MSG_DRAW — extensible as new travel events are added in future stories)
**When** the event arrives between MSG_CHAIN_SOLVING and MSG_CHAIN_SOLVED
**Then** the event is pushed to `_bufferedBoardEvents[]` instead of being processed immediately

**Given** a BOARD_STATE is received during buffering (between SOLVING and SOLVED)
**When** the buffer contains pending events
**Then** the BOARD_STATE is applied immediately to the data model (zones map), but the visual rendering of zones being animated is masked by the floating elements — the final position is correct underneath the floating element, and the replay animates only the visual transition

**Given** MSG_CHAIN_SOLVED fires and there are buffered events
**When** the overlay exit animation completes and the overlay fades out
**Then** buffered events replay on the visible board in two sequential beats:
- Beat 1 (zones): all MSG_MOVE travel animations play in parallel with 50ms stagger, duration = `max(individual durations) + (count - 1) × stagger`
- Beat 2 (LP): all MSG_DAMAGE/MSG_RECOVER/MSG_PAY_LPCOST animations play in parallel
**And** the board pause duration is dynamically calculated from `Beat 1 + Beat 2` (not fixed 1000ms)
**And** replay does NOT start until the overlay has fully faded out (`opacity: 0` + `visibility: hidden`) — contractualized via an `overlayHidden` signal emitted by PvpChainOverlayComponent
**And** after replay completes, the overlay fades back in (if more chain links remain)
**And** `chainOverlayReady` is set to `true` after the full replay cycle

**Given** a chain link produces no board-changing events (empty buffer)
**When** MSG_CHAIN_SOLVED fires
**Then** the pause is skipped entirely — same behavior as current `chainOverlayBoardChanged = false` path (retro-compatible)

**Given** `animatingZone` signal currently tracks a single zone
**When** this story is complete
**Then** it evolves to `Set<string>` of zone keys to support parallel replay (aligned with existing `animatingZoneKeys()` computed signal in the board component)

**Given** `prefers-reduced-motion: reduce` is active
**When** buffered events would replay
**Then** duration = 0ms, instant state changes, no travel animations (existing behavior via `reducedMotion` flag)

**Given** accelerated mode is active (3+ chain links)
**When** replay occurs
**Then** travel durations use accelerated timings (250ms base, 30ms stagger, 200ms floor)

**Given** a STATE_SYNC or disconnection event is received while the buffer contains pending events (mid-chain disconnect)
**When** the orchestrator processes STATE_SYNC
**Then** `_bufferedBoardEvents[]` is flushed without replay — all buffered events are discarded
**And** `_insideChainResolution` is reset to `false`, chain overlay disappears instantly (aligned with Story 6.3 disconnect AC)
**And** the board reflects the STATE_SYNC snapshot directly (no animation)

### Story 7.4: MSG_DRAW Travel & MSG_SHUFFLE_HAND Animation

**Depends on:** Story 7.1 (CardTravelService)

As a player,
I want draw events to show a card traveling from deck to hand and shuffle events to show a fan-out/fan-in animation on the deck,
So that these common game events have clear visual feedback instead of being invisible state changes.

**Acceptance Criteria:**

**Given** a MSG_DRAW event is received by the orchestrator during normal gameplay (not initial hand distribution)
**When** the event is processed (currently a no-op returning `0`)
**Then** it is promoted to a travel event: `CardTravelService.travel()` is called with source = deck pile zone, destination = hand container
**And** the floating element shows a card back during travel (hand updates via BOARD_STATE)
**And** `DrawMsg.player` determines which player's deck/hand zones are used (own deck → own hand for player, opponent deck → opponent hand for opponent)
**And** opponent draws are visible to the local player (card back travels from opponent deck to opponent hand area at top of screen)
**And** the orchestrator returns the travel Promise duration instead of `0`

**Given** multiple consecutive MSG_DRAW events occur outside chain resolution (e.g., Pot of Greed → 2× draw)
**When** the orchestrator processes them sequentially
**Then** each draw travel plays with ~50ms stagger (same stagger logic as MSG_MOVE batch), not sequentially end-to-end

**Given** the initial hand distribution (5× MSG_DRAW at duel start, before the first turn)
**When** the loading screen is still active
**Then** the initial MSG_DRAW events do NOT trigger travel animations — the hand appears directly via BOARD_STATE (the loading screen already masks them)

**Given** a MSG_DRAW event occurs during chain resolution
**When** the event is buffered and replayed
**Then** the draw travel animation participates in Beat 1 (zone travels) alongside other MSG_MOVE events

**Given** a MSG_SHUFFLE_HAND event is received
**When** the orchestrator processes it
**Then** a fan-out/fan-in CSS animation plays on the deck zone: 2-3 pseudo-element card backs (`::before`, `::after`) offset ±3px/±2deg from deck center (~100ms fan-out), then return to stacked position (~150ms fan-in)
**And** total duration is ~250ms

**Given** `prefers-reduced-motion: reduce` is active
**When** MSG_DRAW or MSG_SHUFFLE_HAND is processed
**Then** no travel animation, no fan-out/fan-in — instant state change

**Given** the speed multiplier is active
**When** MSG_DRAW travel or MSG_SHUFFLE_HAND animation plays
**Then** durations are multiplied by the speed factor (200ms floor for travel)

### Story 7.5: XYZ Material Visual Enhancement

**Depends on:** Story 7.1 (CardTravelService), Story 7.2 (travel animation patterns)

As a player,
I want XYZ monsters to display stacked card-back indicators beneath them showing attached materials, and detached materials to slide out before traveling to the graveyard,
So that I can visually track XYZ material count and detachment events.

**Acceptance Criteria:**

**Given** a monster zone contains an XYZ monster with `overlayMaterials.length > 0`
**When** the zone renders
**Then** 1-3 small card-back colored rectangles are visible offset ~2px each below/behind the monster card (stacked effect)
**And** the offset scales proportionally with zone card size (2px is relative to the default card dimensions — on smaller screens, use proportional offset e.g., `0.05em` or percentage-based)
**And** the number of visible layers = `Math.min(overlayMaterials.length, 3)`
**And** the existing blue badge with material count is preserved on top

**Given** `overlayMaterials.length` is 0
**When** the zone renders
**Then** no stacked indicators are displayed

**Given** a MSG_MOVE event detaches a material from an XYZ monster overlay to GY
**When** the orchestrator processes the event
**Then** one stacked card "slides out" from under the XYZ monster (vertical offset + slide animation, ~200ms)
**And** then performs a standard travel animation toward GY (departure point = XYZ parent monster position with slight vertical offset downward)
**And** badge count updates (e.g., 3 → 2), one stacked indicator disappears after the slide-out completes

**Given** a MSG_MOVE event originates from the overlay zone (`fromLocation = OVERLAY`)
**When** the orchestrator determines the animation type
**Then** it triggers the XYZ detach slide-out + travel animation (this AC)
**And** if `fromLocation = MZONE` (not OVERLAY), it triggers a standard destroy travel animation (Story 7.2) — the `fromLocation` field distinguishes detach from normal monster destruction

**Given** `.emz-slot` has `overflow: hidden`
**When** this story is complete
**Then** it is changed to `overflow: visible` to prevent clipping of stacked material indicators on EMZ-positioned XYZ monsters

**Given** `prefers-reduced-motion: reduce` is active
**When** a material is detached
**Then** no slide-out animation — indicator disappears instantly, badge updates, no travel

**Given** a card effect re-attaches a material to an XYZ monster (e.g., via MSG_MOVE with `toLocation = OVERLAY`)
**When** `overlayMaterials.length` increases
**Then** the stacked indicators update reactively — a new indicator layer appears (no animation needed, instant addition)
**And** the badge count updates accordingly

**Given** the speed multiplier is active
**When** the detach slide-out animation plays
**Then** the 200ms base duration is multiplied by the speed factor
