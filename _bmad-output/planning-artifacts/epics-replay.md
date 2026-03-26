---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
completedAt: '2026-03-21'
inputDocuments: ['prd-replay.md', 'architecture-replay.md', 'ux-design-specification-replay.md']
---

# skytrix PvP Replay Mode - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the skytrix PvP Replay Mode, decomposing the requirements from the PRD, Architecture, and UX Design Specification into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: The system records all WS messages exchanged during a PvP duel and persists them server-side at duel completion. Duels that do not complete normally (server crash, process kill) do not produce a replay — accepted limitation
FR2: The system stores replay metadata alongside the recorded messages (player usernames, deck names, turn count, duel result, date)
FR3: The player can view a list of past duels with replay data (deck name, opponent, turn count, result, date)
FR4: The player can open a replay from the match history list
FR5: The player can play a replay, displaying the duel board state progressing through recorded events with visual feedback (card movements, animations)
FR6: The player can pause the replay at any point
FR7: The player can step forward one event at a time from a paused state
FR8: The player can step backward one event at a time from a paused state
~~FR9: The player can fast-forward the replay at variable speed~~ — REMOVED by UX spec (seek/scrub replaces fast-forward)
~~FR10: The player can rewind the replay~~ — REMOVED by UX spec (seek/scrub replaces rewind)
FR11: The player can seek to a specific turn in the replay. The timeline shows a miniature board preview on hover (desktop) to help visually identify the right moment before seeking
FR12: The system displays the replay in omniscient view — both players' hands, face-down cards, and all zones are fully visible
FR13: The system displays the current turn number and active phase during replay playback
FR14: The player can inspect card details for any card visible on the board during replay
FR15: The system ignores PvP turn timers and inactivity timeouts during replay playback
FR16: The player can fork the replay at any point into a PvP Quick Duel Solo session
FR17: The system reconstructs the complete OCGCore game state at the fork point, enabling the Quick Duel Solo session to continue from that exact board state
FR18: The player controls both players in the forked Quick Duel Solo session
FR19: The system automatically purges replay data older than a configurable retention period

### NonFunctional Requirements

NFR1: Playback control actions (play, pause, step, seek) respond within 500ms round-trip — exceeded by ADR-7: <1ms with pre-computed client-side navigation
NFR2: Fast-forward / seek to any point in a duel completes server-side in under 500ms. POC validated: 51ms avg for 252 responses (12-turn duel). Scales linearly
NFR3: Match history page loads the list of past duels within standard API response time (< 1 second)
NFR4: Replay playback produces the exact same board state sequence as the original duel — deterministic replay guaranteed by replaying the same WS messages through OCGCore
NFR5: Fork to PvP Quick Duel Solo reconstructs a valid OCGCore game state that allows the duel to continue without errors or desynchronization
NFR6: The WebSocket connection for replay playback remains stable for the full duration of a replay session (reuses PvP WebSocket infrastructure and heartbeat/keep-alive)
NFR7: Replay mode functions on the same browser matrix as PvP — modern desktop and mobile browsers (latest 2 versions)

### Additional Requirements

**From Architecture:**
- ADR-1: Storage format is `{seed, decks, playerResponses[]}` (engine inputs, ~32KB/duel). Not raw WS messages — compact, deterministic
- ADR-2: Protocol boundary — extend `ws-protocol.ts` with REPLAY_* section server-side, separate `replay-ws.types.ts` client-side
- ADR-5: PostgreSQL via Spring Boot (`replay` table, JSONB for replay data). Flyway migration required
- ADR-6: Fork is reversible via route navigation — fork navigates to `/pvp/duel/fork-{replayId}`, return navigates back to `/pvp/replay/:replayId?seekTo={forkIndex}`. Fork creates new worker (previous freed after pre-computation)
- ADR-7: Pre-compute ALL board states at replay load time. Worker replays all responses through OCGCore WASM, captures `{boardState, events[], label}` per response, sends progressively per turn. All navigation 100% client-side after pre-computation. Worker freed after pre-compute
- Response capture via `capturedSetResponse()` wrapper in PvP mode — never call `setResponse` directly during capture
- Message filter refactoring: `translate()` → `sanitize()` two-phase pattern with `omniscient: true` flag to skip sanitization
- Worker operates in 3 modes: `pvp`, `replay`, `solo`. Mode set at creation
- Capture flow: worker accumulates responses → duel end → `postMessage(replayData)` → main thread `POST /api/replays` → THEN worker cleanup
- Persist failure = log + lost replay (accepted limitation, same as crash)
- Replay metadata includes `scriptsHash` + `ocgcoreVersion` for divergence detection. At pre-computation time, Duel Server compares these against current values — `REPLAY_METADATA` includes `divergenceWarning: true` if mismatch, client shows non-blocking snackbar
- Divergence handling: `MSG_RETRY` during replay = divergence → `REPLAY_ERROR` to client
- Fork sanity check: compare LP, card count, turn number, current phase, and chain state (active chain link count) between pre-computed state and reconstructed WASM state
- 4 client→server WS types: `REPLAY_LOAD`, `REPLAY_FORK`, `REPLAY_FORK_CONTINUE`, `REPLAY_FORK_CANCEL`. 4 server→client: `REPLAY_BOARD_STATES`, `REPLAY_METADATA`, `REPLAY_ERROR`, `REPLAY_FORK_READY`
- Internal HTTP API: `POST /api/replays` (persist), `GET /api/internal/replays/:id` (fetch for playback)
- Public REST API: `GET /api/replays` (paginated match history, metadata only), `DELETE /api/replays/{id}` (individual deletion)
- `PvpBoardContainerComponent` refactoring required: receive board state via input signals + `readOnly` flag
- `ReplayConnection` service scoped to `ReplayPageComponent` (not `providedIn: 'root'`)
- `ReplayService` (REST) is `providedIn: 'root'`
- Single `ReplayDTO` with nullable `replayData` — two mapper methods (`toDto()` without data, `toDetailDto()` with data)
- `DuelResult` enum: 9 values — VICTORY, DEFEAT, DRAW, TIMEOUT, DISCONNECT, SURRENDER, OPPONENT_TIMEOUT, OPPONENT_DISCONNECT, OPPONENT_SURRENDER. Stored relative to player1. OPPONENT_* variants preserve "why" context in match history. `flip()` maps between perspectives: VICTORY↔DEFEAT, TIMEOUT↔OPPONENT_TIMEOUT, DISCONNECT↔OPPONENT_DISCONNECT, SURRENDER↔OPPONENT_SURRENDER, DRAW→DRAW
- Duel Server caches replay data in memory (`Map<replayId, replayData>`) for the duration of the replay session — populated at `REPLAY_LOAD`, reused at `REPLAY_FORK` (no re-fetch). Evicted on WS close or 10-min TTL
- Maximum 3 concurrent replay pre-computation workers (configurable). Additional requests queued
- Duels ended by DISCONNECT or TIMEOUT produce valid but shorter replays (responses up to the disconnect/timeout point)
- TTL retention via extended `RoomCleanupScheduler` with `@Scheduled` method

**From UX Design Specification:**
- Search-first UX principle: seek and step are primary, play/pause is secondary
- Fork is exploratory, not permanent — multiple fork-return cycles expected (2-4 per debug session)
- Omniscient view is the default, no toggles. Cards face-down during live PvP should get `.revealed-in-replay` CSS class (dashed border) — **not yet implemented**: the `replayMode` signal exists in `PvpHandRowComponent` but no CSS class binding is applied in the template
- Keyboard shortcuts: Space (play/pause), Left/Right arrows (step), Home/End (skip), F (fork), A (toggle animations), M (toggle prompt mode), V (toggle perspective), D (debug panel toggle), G (event label granularity toggle)
- Event label granularity toggle: normal mode (grouped logical actions) vs debug mode (individual WS events)
- Timeline bar is primary navigation (separate `TimelineBarComponent`), transport bar is secondary (separate `TransportBarComponent`)
- Timeline supports zoomable scroll (desktop), scrub with live board update, progressive pre-computation visual feedback, board preview popover on hover (miniature board at hovered position, ~200px wide, desktop only)
- Turn markers with LP delta on timeline for targeted navigation
- Clickable debug log panel: existing `DebugLogPanelComponent` with click-to-seek and `.active` highlight on current event
- `DebugLogService` adapted to accept pre-computed event array instead of live `logServerMessage()` calls
- Fork button inline `mat-spinner` (18px) during loading, no modal
- Mode indicator in solo: "Solo — Forked from Turn 12, Event 47"
- Return button replaces transport bar content (same layout position)
- Match history: `mat-table` + `mat-paginator`, row click navigates to replay
- Routes: `/pvp/history` (match history), `/pvp/replay/:replayId` (replay viewer)
- Dark immersive viewer theme: `--surface-nav: #161616`, `--surface-elevated: #1E293B`, board on `--surface-base: #121212`
- i18n keys under `replay.matchHistory.*`, `replay.paginator.*`, `replay.viewer.*`, `replay.transport.*`, `replay.timeline.*`, `replay.debug.*`
- Accessibility: WCAG AA, `role="slider"` on timeline, `aria-label` on all buttons, `prefers-reduced-motion` respected
- Play mode advances ~500ms/event (animated). Scrub/seek = instant, no animation
- Opponent hand cards in omniscient view: show full card art (not face-down backs), with `.revealed-in-replay` provenance marker
- Turn 0 ("Setup"): initial game state (draw phase, opening hands, LP set) — first segment on timeline, labeled "Setup"
- ADR-6 amended: return from fork restores cached `boardStates[]` — no re-pre-computation, no WS reconnection. Instant return
- `REPLAY_LOAD` and `REPLAY_FORK` verify the authenticated user is player1 or player2 of the requested replay
- Responsive: desktop-first, mobile landscape-locked, match history hides date column on mobile
- Error handling: snackbar for all errors, graceful degradation to match history or replay mode

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 1 | Record WS responses during PvP duel |
| FR2 | Epic 1 | Store replay metadata (players, decks, turns, result, date) |
| FR3 | Epic 2 | View match history list |
| FR4 | Epic 2 | Open replay from match history |
| FR5 | Epic 3 | Play replay with visual feedback |
| FR6 | Epic 3 | Pause replay |
| FR7 | Epic 3 | Step forward one event |
| FR8 | Epic 3 | Step backward one event |
| ~~FR9~~ | — | REMOVED (seek/scrub replaces fast-forward) |
| ~~FR10~~ | — | REMOVED (seek/scrub replaces rewind) |
| FR11 | Epic 3 | Seek to specific turn with board preview on hover (desktop) |
| FR12 | Epic 3 | Omniscient view (both hands, face-downs visible) |
| FR13 | Epic 3 | Display current turn number and phase |
| FR14 | Epic 3 | Inspect card details during replay |
| FR15 | Epic 3 | Ignore PvP turn timers during replay |
| FR16 | Epic 4 | Fork replay to Quick Duel Solo |
| FR17 | Epic 4 | Reconstruct OCGCore state at fork point |
| FR18 | Epic 4 | Control both players in forked session |
| FR19 | Epic 1 | TTL-based replay purge |
| FR20 | Epic 2 | Delete individual replay from match history |

## Epic List

### Epic 1: Replay Data Capture & Storage
The system automatically records every completed PvP duel and persists it for future replay access. Includes TTL-based retention for data lifecycle management.
**FRs covered:** FR1, FR2, FR19

### Epic 2: Match History & Replay Access
The player can browse a list of past duels and open any replay from the match history page.
**FRs covered:** FR3, FR4

### Epic 3: Sequence Viewer — Playback & Navigation
The player can navigate freely through a replay with video-like controls (play, pause, step forward/back, seek, scrub) and view the board in omniscient mode with full card inspection.
**FRs covered:** FR5, FR6, FR7, FR8, FR11, FR12, FR13, FR14, FR15

### Epic 4: Fork to Quick Duel Solo & Return
The player can branch from any point in the replay into a Quick Duel Solo session to test alternative actions, then return to the replay at the fork point.
**FRs covered:** FR16, FR17, FR18

## Epic 1: Replay Data Capture & Storage

The system automatically records every completed PvP duel and persists it for future replay access. Includes TTL-based retention for data lifecycle management. (3 stories)

### Story 1.1: Replay Persistence Infrastructure

As a developer,
I want the Spring Boot API to provide replay storage and retrieval endpoints,
So that replay data captured by the Duel Server can be persisted and accessed.

**Acceptance Criteria:**

**Given** the Spring Boot application starts
**When** Flyway migrations run
**Then** a `replay` table exists with columns: `id` (UUID), `player1_id` (FK), `player2_id` (FK), `metadata` (JSONB), `replay_data` (JSONB), `created_at` (timestamp)

**Given** the Duel Server sends a `POST /api/replays` request with replay data and metadata
**When** the request is processed
**Then** a new replay record is persisted in the database with the provided data
**And** the response returns the created replay ID

**Given** the Duel Server sends a `GET /api/internal/replays/:id` request
**When** the replay exists
**Then** the response contains the full `ReplayDTO` including `replayData`

**Given** the Duel Server sends a `GET /api/internal/replays/:id` request
**When** the replay does not exist
**Then** the response returns 404

**Implementation scope:** `Replay.java` entity, `ReplayDTO.java` (nullable replayData), `ReplayMapper.java` (toDto/toDetailDto), `ReplayRepository.java`, `ReplayService.java`, `ReplayController.java` (POST + GET internal), `DuelResult.java` enum, Flyway migration.

### Story 1.2: Duel Server Response Capture

As a developer,
I want the Duel Server to capture all player responses during a PvP duel and persist them at duel completion,
So that completed duels can be replayed later.

**Acceptance Criteria:**

**Given** a PvP duel is in progress
**When** a player response is submitted to OCGCore
**Then** the response is captured via the `capturedSetResponse()` wrapper (data bytes appended to array — array position IS the index) before being passed to `duel.setResponse()`
**And** the original `setResponse()` is never called directly during PvP mode — including auto-responses (activation toggle Off/Auto), timeout responses, and any other implicit responses

**Given** a PvP duel completes normally (victory, defeat, draw, surrender, timeout, disconnect)
**When** the duel end is detected
**Then** the worker sends the complete replay data (`{seed, decks, playerResponses[]}`) and metadata (`{playerUsernames, deckNames, turnCount, result, date, scriptsHash, ocgcoreVersion}`) to the main thread via `postMessage`
**And** `decks` contains the decklists (main, extra — card IDs as `List<Long>`), not references to mutable deck entities. Side deck is excluded (not needed for deterministic replay)
**And** `result` is derived from OCGCore duel end messages (`MSG_WIN`, `MSG_DRAW`) and WS-level events (disconnect, timeout, surrender), mapped to a `DuelResult` value (9 values: VICTORY, DEFEAT, DRAW, TIMEOUT, DISCONNECT, SURRENDER, OPPONENT_TIMEOUT, OPPONENT_DISCONNECT, OPPONENT_SURRENDER), stored relative to player1. `flip()` maps between perspectives at query time: VICTORY↔DEFEAT, TIMEOUT↔OPPONENT_TIMEOUT, DISCONNECT↔OPPONENT_DISCONNECT, SURRENDER↔OPPONENT_SURRENDER, DRAW→DRAW
**And** the main thread sends `POST /api/replays` to Spring Boot
**And** worker cleanup occurs only AFTER the POST completes (success or failure)

**Given** the `POST /api/replays` request fails
**When** the error is caught
**Then** the error is logged
**And** the replay is lost (accepted limitation)
**And** the duel flow is not interrupted

**Given** a PvP duel does not complete normally (server crash, process kill)
**When** the process terminates
**Then** no replay is produced (accepted limitation)

**Implementation scope:** `duel-worker.ts` (pvp mode: `capturedSetResponse` wrapper — `Array<{data: Object}>` with no redundant index field, response accumulation, duel-end replay data emission), `server.ts` (POST to Spring Boot on worker message), `types.ts` (CapturedResponse, WorkerMode), `ocg-scripts.ts` (getScriptsHash).

### Story 1.3: TTL-Based Replay Retention

As a developer,
I want the system to automatically purge replay data older than a configurable retention period,
So that storage does not grow unbounded.

**Acceptance Criteria:**

**Given** the Spring Boot application is running
**When** the scheduled purge task executes
**Then** all replay records with `created_at` older than the configured retention period are deleted

**Given** the retention period is configurable
**When** the application starts
**Then** the retention period is read from application configuration (e.g., `replay.retention-days`)

**Given** replays exist within the retention period
**When** the purge task executes
**Then** those replays are not deleted

**Implementation scope:** `RoomCleanupScheduler.java` (extended with `@Scheduled` method for replay purge), `ReplayService.java` (purge method), `ReplayRepository.java` (delete query by date), application.yml (retention config).

## Epic 2: Match History & Replay Access

The player can browse a list of past duels and open any replay from the match history page.

### Story 2.1: Match History REST API

As a developer,
I want the Spring Boot API to expose a paginated match history endpoint,
So that the Angular frontend can display the player's past duels.

**Acceptance Criteria:**

**Given** replays exist for the authenticated player
**When** the frontend sends `GET /api/replays` with pagination parameters
**Then** the response contains a `CustomPageable<ReplayDTO>` with metadata only (no `replayData` field)
**And** each entry includes: player usernames, deck names, turn count, result, date

**Given** replays exist for the authenticated player
**When** the frontend sends `GET /api/replays` without pagination parameters
**Then** the response uses default pagination (first page, default size)

**Given** no replays exist for the authenticated player
**When** the frontend sends `GET /api/replays`
**Then** the response contains an empty page with `totalElements: 0`

**Given** the player is not authenticated
**When** a request is sent to `GET /api/replays`
**Then** the response returns 401

**Given** the authenticated player is player2 in a replay where player1 won
**When** the match history is returned
**Then** the result field shows DEFEAT for this player (not player1's VICTORY)
**And** the result is always relative to the authenticated player

**Given** the player queries match history
**When** no sort parameter is specified
**Then** results are ordered by `created_at` descending (most recent first)

**Given** the authenticated player queries match history
**When** the query executes
**Then** the repository query is `WHERE player1_id = :userId OR player2_id = :userId` — returning replays where the player participated as either player1 or player2

**Given** the authenticated player wants to delete a specific replay
**When** the frontend sends `DELETE /api/replays/{id}`
**Then** the replay is deleted if the authenticated player is player1 or player2
**And** the response returns 204 No Content

**Implementation scope:** `ReplayController.java` (add public `GET /api/replays` endpoint + `DELETE /api/replays/{id}` endpoint), `ReplayService.java` (query by player ID with `OR` predicate on both player columns, result mapping relative to authenticated player, delete with ownership check), `ReplayRepository.java` (findByPlayer1IdOrPlayer2Id query), `ReplayMapper.java` (`toDto()` without replayData).

### Story 2.2: Match History Page

As a player,
I want to view a list of my past duels with replay data,
So that I can find and open the replay I'm looking for.

**Acceptance Criteria:**

**Given** the player navigates to `/pvp/history`
**When** the page loads
**Then** a paginated table displays past duels with columns: deck name, opponent, turn count, result (icon), date
**And** the page loads within 1 second (NFR3)

**Given** the match history table is displayed
**When** the player clicks a row
**Then** the app navigates to `/pvp/replay/:replayId`

**Given** no replays exist
**When** the page loads
**Then** the empty state message is displayed ("No replays yet. Complete a PvP duel to see it here.")

**Given** the page is loading
**When** data has not yet arrived
**Then** a `mat-spinner` is displayed centered on the page

**Given** the player views match history on mobile (landscape)
**When** the table renders
**Then** the date column is hidden
**And** deck name, opponent, and result columns remain visible

**Given** the API call fails
**When** the error is caught
**Then** a snackbar error is displayed via `displayError`

**Implementation scope:** `MatchHistoryPageComponent` (standalone, OnPush, `mat-table` + `mat-paginator`), `ReplayService` (Angular, REST calls, `providedIn: 'root'`), `app.routes.ts` (add `/pvp/history` lazy-loaded route), i18n keys in `fr.json` / `en.json` (`replay.matchHistory.*`).

## Epic 3: Sequence Viewer — Playback & Navigation

The player can navigate freely through a replay with video-like controls (play, pause, step forward/back, seek, scrub) and view the board in omniscient mode with full card inspection. (6 stories)

### Story 3.1: Board Component Refactoring for Replay

As a developer,
I want `PvpBoardContainerComponent` to receive board state via input signals and support a `readOnly` mode,
So that the same board component can be used for both live PvP and replay display.

**Acceptance Criteria:**

**Given** `PvpBoardContainerComponent` receives a board state via input signals
**When** the component renders
**Then** the board displays the provided state correctly (all 18 zones, both hands, LP, phase, turn)
**And** the component is agnostic of the data source (DuelConnection or ReplayConnection)

**Given** `PvpBoardContainerComponent` receives `readOnly = true`
**When** the player interacts with cards on the board
**Then** no action menus appear, no prompts display, no actionable glow is shown
**And** card inspector remains functional (click to inspect card details)
**And** animations remain active

**Given** `PvpBoardContainerComponent` receives `readOnly = false`
**When** the player interacts with cards on the board
**Then** behavior is identical to the current PvP implementation (action menus, prompts, glow)

**Given** existing PvP pages use `PvpBoardContainerComponent`
**When** the refactoring is complete
**Then** all existing PvP functionality works identically (no regression), verified via the following manual regression checklist:

1. Action menus appear on card click (monster, spell/trap zones)
2. Prompt sheet displays for engine queries (activation, target selection, etc.)
3. Chain overlay animations play correctly (chain link numbers, card travel)
4. Card inspector opens with full details on card click/hover
5. LP update animations play on damage/gain
6. Phase badge transitions update on phase change
7. Card movement animations play (summon, destroy, equip, etc.)
8. Drag-drop interactions function (if applicable in the page context)

**Implementation scope:** `PvpBoardContainerComponent` — add `readOnly` input signal, refactor to accept board state via input signals instead of direct `DuelConnection` injection. Ensure existing PvP consumers still work.

### Story 3.2: Message Filter Refactoring

As a developer,
I want the message filter to separate translation and sanitization into distinct phases,
So that the replay system can use the same translation logic with an omniscient flag to skip sanitization.

**Acceptance Criteria:**

**Given** an OCGCore binary message is received by the message filter
**When** the filter processes it
**Then** the `translate()` phase produces the complete JSON object from OCGCore binary
**And** the `sanitize()` phase modifies sensitive fields (card codes, hints) in a separate pass

**Given** the message filter is called with `omniscient: true`
**When** the filter processes an OCGCore message
**Then** the `translate()` phase executes normally
**And** the `sanitize()` phase is skipped entirely
**And** the full translated message is returned without field modifications

**Given** the message filter is called with `omniscient: true`
**When** the filter processes a message that contains sanitizable fields (card codes, hint values)
**Then** the `translate()` output includes ALL fields with their real values (opponent card codes are real IDs, not zeros; hint values are preserved)
**And** no field that was previously set during the sanitize pass is missing or zeroed

**Given** the message filter is called with `omniscient: false` (default, PvP live mode)
**When** the filter processes an OCGCore message
**Then** behavior is identical to the current implementation (translate + sanitize)

**Implementation scope:** `message-filter.ts` — refactor existing filter functions to two-phase `translate()` → `sanitize()` pattern, add `omniscient` flag parameter. Audit each existing filter function to ensure translation and sanitization are not intermingled — any field currently set/modified during sanitization must be fully populated by `translate()` first.

### Story 3.3: Replay Pre-Computation Engine

As a developer,
I want the Duel Server to pre-compute all board states when a replay is loaded,
So that the client can navigate the replay entirely client-side.

**Acceptance Criteria:**

**Given** the client sends a `REPLAY_LOAD` message with a `replayId` via WebSocket
**When** the Duel Server receives it
**Then** the Duel Server verifies the authenticated user (from JWT) is player1 or player2 of the requested replay
**And** fetches the replay data via `GET /api/internal/replays/:id` from Spring Boot
**And** caches the replay data in a server-side `Map<replayId, replayData>` (for reuse by `REPLAY_FORK`, evicted on WS close or 10-min TTL)
**And** creates a worker in `'replay'` mode (subject to concurrent worker limit: max 3, additional requests queued)

**Given** the worker is in `'replay'` mode with replay data loaded
**When** pre-computation starts
**Then** the worker replays all `playerResponses` through OCGCore WASM in silent mode
**And** captures `{boardState, events[], label}` per response via `duelQueryField()` + `duelQuery()`
**And** `label` is a human-readable description of the logical action ("Normal Summon: Tearlaments Scheiren") — debug-level labels (individual WS event names) are derived client-side from the `events[]` array
**And** sends results progressively via `REPLAY_BOARD_STATES` messages — **one WS message per turn** (format: `{turnNumber, states: Array<{boardState, events[], label}>}`). If a single turn exceeds 512KB serialized (combo-heavy turn with 100+ events), the worker splits it into sub-batches of 50 states each
**And** **Turn 0 ("Setup")** is the first batch sent: all events before the first player action of Turn 1 (draw phase, opening hands dealt, LP set). The client displays the board from Turn 0's last state immediately
**And** sends `REPLAY_METADATA` (player usernames, deck names, turn count, result, scriptsHash, ocgcoreVersion, `divergenceWarning: true` if scriptsHash or ocgcoreVersion differ from current server values) at handshake

**Given** pre-computation completes successfully
**When** all responses have been replayed
**Then** the worker is freed (terminated)
**And** no persistent server session remains for navigation

**Given** `MSG_RETRY` is encountered during pre-computation
**When** the divergence is detected
**Then** the worker sends `REPLAY_ERROR` with a context message to the client
**And** the worker stops cleanly

**Given** the worker crashes or hangs during pre-computation
**When** no new turn has been computed for 30 seconds (inactivity watchdog, not total time)
**Then** the worker is terminated
**And** `REPLAY_ERROR` is sent to the client

**Given** pre-computation takes longer than 10 seconds (long duel, 50+ turns)
**When** turns are computed progressively
**Then** the client can navigate already-computed turns without waiting for completion
**And** the loading indicator shows real-time progress ("Loading replay... Turn X/Y")

**Implementation scope:** `duel-worker.ts` (replay mode: pre-computation loop, Turn 0 first batch, progressive board state emission per turn with 512KB sub-batching, divergence detection, scriptsHash/ocgcoreVersion comparison), `server.ts` (replay WS routing, replay session management with auth check, `mode=replay` handshake, fetch replay from Spring Boot, cache replay data in Map, concurrent worker limit with queue, evict on WS close/TTL), `ws-protocol.ts` (REPLAY_* message types section), `types.ts` (ReplaySession).

### Story 3.4: Replay Page & Connection Service

As a player,
I want to open a replay and see the board state with all cards visible in omniscient view,
So that I can see everything that happened during the duel including hidden information.

**Acceptance Criteria:**

**Given** the player navigates to `/pvp/replay/:replayId`
**When** the page loads
**Then** a WebSocket connection is established with the Duel Server (`mode=replay&replayId=X`)
**And** `REPLAY_LOAD` is sent to trigger pre-computation
**And** a loading indicator shows progressive pre-computation progress ("Loading replay... Turn 15/30")

**Given** pre-computed board states arrive progressively
**When** the first turn batch is received
**Then** the board displays the initial game state
**And** already-computed turns are navigable while remaining turns compute in the background

**Given** the replay is fully loaded
**When** the board renders
**Then** both players' hands are fully visible
**And** all face-down cards show their identity (card code visible despite face-down position)
**And** cards whose position is currently face-down in the board state (POS_FACEDOWN_ATTACK, POS_FACEDOWN_DEFENSE) display a `.revealed-in-replay` provenance marker (dashed border) — indicating this information was hidden from the opponent during live PvP
**And** PvP turn timers and inactivity timeouts are not active (FR15)

**Given** the player clicks on a card during replay
**When** the card inspector opens
**Then** the full card details are displayed (FR14)

**Given** the WebSocket connection is lost during navigation
**When** the disconnect is detected
**Then** navigation continues to work (pre-computed data is in client memory)
**And** fork functionality is disabled until reconnection

**Given** `REPLAY_METADATA` is received with `divergenceWarning: true`
**When** the metadata is processed
**Then** a non-blocking snackbar shows "This replay was recorded with a different script/engine version — results may differ from the original duel"
**And** replay loading continues normally

**Given** a `REPLAY_ERROR` is received
**When** the error is displayed
**Then** a snackbar shows the error message via `displayError`
**And** the player is returned to match history

**Given** the player navigates directly to `/pvp/replay/:replayId` via deep link (browser refresh, bookmark, shared URL)
**When** the page loads
**Then** the replay loads successfully using only the `replayId` from the route param — no prior match history context required
**And** `REPLAY_METADATA` provides all display metadata (player names, deck names, turn count, result)

**Given** the replay is in omniscient mode
**When** the opponent's hand is rendered
**Then** opponent hand cards show their full card art/identity (real card IDs, not face-down backs)
**And** opponent hand cards receive the `.revealed-in-replay` provenance marker (dashed border)

**Given** the replay finishes loading (first turn batch — Turn 0 "Setup" — received)
**When** the initial state is displayed
**Then** `currentIndex` is set to 0 (the state after the initial setup — both hands dealt, LP set, Turn 0 before any player action)

**Implementation scope:** `ReplayPageComponent` (controller: boardStates[], currentIndex signal, computedUpTo signal, mode signal, derives views for children), `ReplayConnectionService` (scoped, WS for load, receives REPLAY_BOARD_STATES/METADATA/ERROR), `replay-ws.types.ts`, `app.routes.ts` (add `/pvp/replay/:replayId` lazy-loaded route), i18n keys (`replay.viewer.*`, `replay.error.*`).

### Story 3.5: Timeline Bar & Transport Bar

As a player,
I want video-like playback controls and a visual timeline to navigate the replay,
So that I can seek to any turn and step through events efficiently.

**Acceptance Criteria:**

**Given** the replay is loaded
**When** the timeline bar renders
**Then** it displays turn segments representing the entire duel
**And** the current position is highlighted with a gold accent playhead
**And** not-yet-computed turns appear grayed out during progressive loading

**Given** the player clicks on a turn segment in the timeline
**When** the click is processed
**Then** the board instantly displays the first event of that turn (no animation, <1ms)
**And** the position indicator updates (turn number, phase, active player)

**Given** the player drags/scrubs along the timeline
**When** the drag is in progress
**Then** the board updates in real-time to show the state at the cursor position (live scrub)
**And** no animation plays during scrub

**Given** the player scrolls the mouse wheel on the timeline (desktop)
**When** the scroll event fires
**Then** the timeline zooms in/out across 3 discrete levels: L1 (default: turns as equal-width segments), L2 (turns expanded with event count labels visible), L3 (individual events visible as clickable sub-segments within turns)
**And** zoom anchors to the cursor position (zoom centers on where the mouse points, using CSS `transform: scaleX()` with `transform-origin` at cursor X)
**And** horizontal overflow is handled by `overflow-x: auto` on the timeline container (scroll to pan)
**And** on mobile: zoom is disabled (touch scrub only, per responsive strategy)

**Given** the transport bar is visible in replay mode
**When** the player uses playback controls
**Then** Step Forward (Right Arrow / button) advances one event with animation (~500ms)
**And** Step Back (Left Arrow / button) goes back one event with animation
**And** Play/Pause (Space / button) toggles automatic step-forward at ~500ms intervals
**And** Skip Start (Home / button) seeks to Turn 1, Event 0
**And** Skip End (End / button) seeks to the last event

**Given** play mode is active
**When** the playhead reaches the last computed event
**Then** play pauses automatically

**Given** play mode is active during progressive loading
**When** the playhead reaches `computedUpTo`
**Then** play pauses and resumes automatically when the next turn is computed

**Given** the player hovers over a position on the timeline (desktop)
**When** the popover appears
**Then** it shows a **miniature board preview** (~200px wide) of the board state at the hovered event index
**And** below the preview: turn number, LP for both players, and event label
**And** the preview is a scaled-down `PvpBoardContainerComponent` (CSS `transform: scale()`) with `readOnly = true`, animations disabled, card inspector disabled
**And** the popover is anchored above the cursor X position on the timeline
**And** the popover is dismissed on mouse leave

**Given** the player hovers over a position beyond `computedUpTo` during progressive loading
**When** the hover is detected
**Then** only turn summary text is shown (no board preview)

**Given** the player views the timeline on mobile
**When** hovering is not available (touch-only)
**Then** no hover preview is shown — scrub with live main board update replaces it

**Given** the replay respects `prefers-reduced-motion`
**When** the media query matches
**Then** step/play animations are skipped, showing the final state directly

**Given** the replay is viewed on mobile (landscape)
**When** the timeline and transport bar render
**Then** transport bar shows icons only (no text labels)
**And** timeline supports touch scrub but not scroll-wheel zoom
**And** all interactive elements have minimum 44px touch targets

**Implementation scope:** `TimelineBarComponent` (turns[], currentIndex, computedUpTo, totalEvents inputs; seekTo, scrubbing outputs; 3-level zoom via scroll wheel with cursor anchor; `role="slider"` accessibility; Turn 0 "Setup" segment; board preview popover on hover — receives `boardStates` reference from parent for preview lookup, renders scaled-down `PvpBoardContainerComponent` in popover), `TransportBarComponent` (mode, isPlaying, forking inputs; per-action void outputs; `aria-label` on buttons), `ReplayPageComponent` (keyboard shortcut handler, play interval logic at ~500ms/event).

### Story 3.6: Debug Log Panel Adaptation & Event Granularity

As a player,
I want the debug log panel to be clickable for navigation and event labels to toggle between normal and debug granularity,
So that I can quickly jump to any event from the log and choose the level of detail I need.

**Acceptance Criteria:**

**Given** the player presses D
**When** the debug log panel toggles
**Then** the `DebugLogPanelComponent` slides in/out
**And** log entries are clickable — clicking seeks to that event
**And** the current event entry has `.active` highlight

**Given** the replay page loads with pre-computed board states
**When** `DebugLogService` is initialized in replay mode
**Then** `DebugLogService` accepts the full pre-computed event array at initialization (all events from all `boardStates[].events[]` flattened) instead of receiving events via live `logServerMessage()` calls
**And** `DebugLogPanelComponent` renders the complete event list immediately (not incrementally)
**And** clicking a log entry emits the corresponding `eventIndex` for the parent to seek to

**Given** the player uses the event label granularity toggle (G key)
**When** toggled
**Then** event labels switch between normal mode (grouped logical actions) and debug mode (individual WS events)

**Implementation scope:** `DebugLogPanelComponent` (add click handler emitting eventIndex + `.active` CSS on current event), `DebugLogService` (refactor to accept pre-computed event array at initialization instead of live `logServerMessage()` calls; expose flat event list for panel rendering), `ReplayPageComponent` (granularity toggle state, D/G keyboard shortcuts).

## Epic 4: Fork to Quick Duel Solo & Return

The player can branch from any point in the replay into a Quick Duel Solo session to test alternative actions, then return to the replay at the fork point.

### Story 4.1: Fork — Server-Side State Reconstruction

As a developer,
I want the Duel Server to create a live OCGCore WASM session at any replay event index,
So that the player can fork into a Quick Duel Solo session from that exact board state.

**Acceptance Criteria:**

**Given** the client sends a `REPLAY_FORK` message with an `eventIndex`
**When** the Duel Server receives it
**Then** the Duel Server verifies the authenticated user (from JWT) is player1 or player2 of the requested replay
**And** retrieves the cached replay data from the server-side `Map<replayId, replayData>` (populated at `REPLAY_LOAD`, no re-fetch from Spring Boot)
**And** a new worker is created (subject to concurrent worker limit: max 3, additional requests queued)
**And** the worker replays all `playerResponses` from scratch up to `eventIndex` through OCGCore WASM
**And** the OCGCore instance is live and resumable at the fork point

**Given** the worker has reconstructed the OCGCore state at the fork point
**When** reconstruction completes
**Then** a fork sanity check compares LP, card count, turn number, current phase, and chain state (active chain link count) between the pre-computed state at `eventIndex` and the reconstructed WASM state via `duelQueryField()`
**And** if mismatch is detected, `REPLAY_ERROR` is sent with a warning (not blocking — client decides to continue or cancel)

**Given** the sanity check passes (or the player continues despite warning)
**When** the fork is confirmed
**Then** the server sends `REPLAY_FORK_READY` with two solo WS tokens (`token1`, `token2`)
**And** the worker switches to `'solo'` mode
**And** response capture stops (`setResponse` called directly, not via wrapper)

**Given** fork reconstruction takes longer than expected
**When** the 30-second watchdog triggers
**Then** the worker is terminated
**And** `REPLAY_ERROR` is sent to the client

**Implementation scope:** `duel-worker.ts` (fork reconstruction: replay responses to eventIndex, sanity check including chain state, mode switch replay→solo, direct setResponse in solo), `server.ts` (REPLAY_FORK/REPLAY_FORK_CONTINUE/REPLAY_FORK_CANCEL handlers with auth check, retrieve cached replay data from Map, send `REPLAY_FORK_READY` with fork tokens on success, concurrent worker limit).

### Story 4.2: Fork & Return — Client-Side Mode Transition

As a player,
I want to fork from the replay into a Quick Duel Solo session and return to the replay at the fork point,
So that I can test alternative actions and try multiple branches without losing my place.

**Acceptance Criteria:**

**Given** the player clicks the Fork button (or presses F) during replay
**When** the fork is initiated
**Then** the Fork button shows an inline `mat-spinner` (18px) and becomes disabled
**And** the server-side reconstruction begins (~1-2s)

**Given** fork reconstruction completes successfully (server sends `REPLAY_FORK_READY` with fork tokens)
**When** the fork navigation occurs
**Then** the app navigates to `/pvp/duel/fork-{replayId}` with query params `fork=true`, `replayId`, `seekTo={forkEventIndex}` and router state containing `wsToken1`/`wsToken2`
**And** `DuelPageComponent` loads in fork mode — the player controls both players (FR18)
**And** fork duels skip surrender confirmation on leave (`canDeactivate` guard bypassed)

**Given** a fork divergence warning is received (LP/card count mismatch)
**When** the warning is displayed
**Then** a snackbar shows the warning with Continue and Cancel actions
**And** Continue sends `REPLAY_FORK_CONTINUE` and proceeds to fork navigation
**And** Cancel sends `REPLAY_FORK_CANCEL` and stays in replay mode

**Given** the player wants to return to the replay from the forked solo session
**When** return is initiated
**Then** the app navigates back to `/pvp/replay/:replayId?seekTo={forkEventIndex}`
**And** the replay page loads fresh, establishes a new WS connection, and re-pre-computes board states (progressive loading)
**And** the `seekTo` query param auto-positions the timeline at the fork point

**Implementation scope:** `ReplayForkService` (scoped to `ReplayPageComponent` — manages fork state signals: forking, forkEventIndex, cachedBoardStates; sends `REPLAY_FORK`/`REPLAY_FORK_CONTINUE`/`REPLAY_FORK_CANCEL` via `ReplayConnectionService`; navigates to fork duel on `REPLAY_FORK_READY`), `ReplayConnectionService` (forkStatus signal, sends fork WS messages), `DuelPageComponent` (detects fork mode via `fork=true` query param, `forkReplayId` property), `app.routes.ts` (generic `/pvp/duel/:roomCode` route, canDeactivate bypassed for fork duels).
