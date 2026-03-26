---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'updated-post-implementation'
completedAt: '2026-03-21'
lastUpdated: '2026-03-26'
editHistory:
  - date: '2026-03-26'
    changes: 'Doc-code alignment: fixed seed format (number → List<String> of 4 elements), removed side deck from ReplayDeck, DuelResult 6→9 values (+OPPONENT_* variants with flip()), ReplayRepository +PagingAndSortingRepository, added admin route guard documentation, added .revealed-in-replay implementation status note, fixed i18n key prefixes'
inputDocuments: ['prd-replay.md', 'architecture-pvp.md', 'brainstorming-session-2026-03-21.md', 'project-context.md']
workflowType: 'architecture'
project_name: 'skytrix'
user_name: 'Axel'
date: '2026-03-21'
---

# Architecture Decision Document — PvP Replay Mode

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
19 FRs across 6 capability areas: replay data capture (FR1-2: record all WS messages at duel completion, store metadata), match history (FR3-4: list past duels, open replay), sequence viewer playback (FR5-11: play, pause, step forward/back, ~~fast-forward~~, ~~rewind~~, seek to turn), sequence viewer display (FR12-15: omniscient view, turn/phase indicator, card inspection, timers ignored), fork to PvP Quick Duel Solo (FR16-18: fork at any point, reconstruct OCGCore state, control both players), and replay retention (FR19: TTL-based purge).

**UX Spec Amendments (ux-design-specification-replay.md):**
- **FR9 (fast-forward) and FR10 (rewind) removed.** Seek/scrub via pre-computed client-side states replaces both. Search-first UX principle: if you want to go fast, seek to the turn, don't watch in accelerated playback.
- **Fork is reversible** (amends one-way decision). "Return to Replay" button in solo mode, auto-seeks to fork point.
- **Navigation is 100% client-side** via pre-computed board states (ADR-7 replaces ADR-3). Server only needed for initial pre-computation and fork.

The Replay Mode is an extension of PvP, not a standalone system. It reuses the same board components and WebSocket infrastructure for initial data loading. The key difference from original architecture: **replay navigation is client-side** (pre-computed board states), not server-driven. The server pre-computes all states at load time; the client navigates locally.

**Non-Functional Requirements:**
7 NFRs across 3 areas:
- **Performance (NFR1-3):** Playback control round-trip < 500ms (exceeded: <1ms with pre-computed client-side navigation). Seek performance validated by POC (51ms for 252 responses). Match history API < 1 second
- **Reliability (NFR4-6):** Deterministic replay (same WS messages = same board state). Fork state reconstruction without desynchronization. WebSocket stability for full replay session
- **Compatibility (NFR7):** Same browser matrix as PvP

**Scale & Complexity:**
- Primary domain: Full-stack brownfield (extends Node.js Duel Server + Spring Boot + Angular)
- Complexity level: Medium — wiring between existing components with one novel challenge (seek/step-back via OCGCore reconstruction)
- Estimated architectural components: ~8-10

### Technical Constraints & Dependencies

- **Inherited from PvP architecture:** OCGCore WASM sync mode (worker thread per session), no save/restore, WebSocket protocol boundary (`ws-protocol.ts`), Docker compose deployment, JWT auth chain
- **OCGCore has no reverse:** Step-back (FR8) requires replaying all WS messages from the start up to the target event. No shortcut. **Mitigated by ADR-7:** all board states pre-computed at load time — step-back is a client-side index decrement (<1ms)
- **OCGCore has no save/restore:** Fork (FR16-17) creates a new OCGCore WASM instance and replays messages from scratch to reconstruct state at fork point. Same mechanism as PvP reconnection. **Not mitigated by ADR-7:** pre-computed states are read-only snapshots, not resumable WASM instances. Fork still requires server-side reconstruction (~1-2s)
- **Lua script divergence accepted:** Replay uses current scripts, not the scripts active during the original duel (PRD accepted risk)
- **Crash = no replay:** Only duels that complete normally produce a replay (FR1 accepted limitation)

### Cross-Cutting Concerns Identified

- **Storage format (CRITICAL — architecturally structuring decision):** The PvP architecture sketched `{seed, decks, playerResponses[]}` (~5-20KB/duel) as a future replay format. The PRD says "raw WS messages." Both enable deterministic replay but have fundamentally different trade-offs. Raw WS messages (engine output) could theoretically enable client-side playback without OCGCore — closing this door by choosing seed+responses must be a conscious, documented decision. Since this choice impacts storage size, seek implementation, future client-side playback capability, and implementation complexity, it is treated as a critical ADR to challenge in depth during architectural decisions
- **Omniscient view vs message filter:** PvP uses a whitelist message filter (default DROP) to prevent information leakage. Replay does the opposite — all information is visible. The replay session must bypass or disable the message filter, sending unfiltered OCGCore output to the client
- **Worker thread lifecycle for replay:** ~~A replay session occupies a worker thread for the entire session.~~ **Updated by ADR-7:** The worker is alive only during pre-computation (~2-10s) and fork (~1-2s). After pre-computation completes and board states are sent to client, the worker is freed. No idle timeout needed for navigation. Worker re-activated only on fork request.
- **Checkpoint system for step-back/rewind:** ~~Without periodic state snapshots, each step-back replays from the start.~~ **Superseded by ADR-7:** All board states pre-computed at load time. Step-back = client-side index decrement. Checkpoint concern eliminated.
- **Protocol boundary — extend or separate:** The PvP WebSocket protocol (`ws-protocol.ts`) defines 57 server→client and 5 client→server message types. **Updated by ADR-7 + implementation:** Replay adds 4 client→server types (`REPLAY_LOAD`, `REPLAY_FORK`, `REPLAY_FORK_CONTINUE`, `REPLAY_FORK_CANCEL`) and 4 server→client types (`REPLAY_BOARD_STATES`, `REPLAY_METADATA`, `REPLAY_ERROR`, `REPLAY_FORK_READY`). Total: 8 replay-specific types. Original 9 playback command types removed — navigation is client-side.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack brownfield — three existing technology domains:
- **Angular 19.1.3 SPA** (existing) — new replay pages/components within existing application
- **Spring Boot 3.4.2** (existing) — new REST endpoints for match history and replay storage
- **Node.js Duel Server** (existing) — new replay session handler extending existing duel infrastructure

### Starter Options Considered

Not applicable — brownfield project. All three services are established with production patterns, conventions, and deployment infrastructure. The Replay Mode adds new features to existing services.

### Selected Approach: Extend Existing Services

**Rationale:** No new infrastructure is introduced. The Replay Mode extends the Duel Server (capture + replay playback), Spring Boot (storage + match history API), and Angular (replay page + match history page). All existing patterns (standalone components, signals, OnPush, worker threads, `ws-protocol.ts` boundary, Docker compose) apply unchanged.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
All critical decisions made — storage format, protocol boundary, data architecture, replay data flow.

**Important Decisions (Shape Architecture):**
All important decisions made — checkpoint strategy, replay session lifecycle, fork worker reuse, message filter omniscient mode.

**Deferred Decisions (Post-MVP):**
- ~~Checkpoint system for step-back/rewind~~ — superseded by ADR-7 (all states pre-computed)
- Client-side playback (closed by ADR-1: seed+responses requires OCGCore)
- Match history filtering/search (Growth feature)

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage format (ADR-1) | `{seed, decks, playerResponses[]}` — engine inputs. **`seed`** is a 4-element `List<String>` (OCGCore PRNG seed). **`decks`** contains `main: List<Long>` and `extra: List<Long>` per player (no side deck — not needed for deterministic replay). | Compact (~32KB/duel measured by POC — 252 responses, 12 turns), deterministic replay (POC validated: 568 identical messages), omniscient view is natural (no filter bypass needed), aligned with server-side playback. Client-side playback closed — conscious, documented decision |
| Response capture point | `setResponse()` wrapper — never call `setResponse` directly | Captures all responses including auto-responses (activation toggle Off/Auto). Single point of capture guarantees completeness |
| Response format | `playerResponses: Array<{data: Object}>` | Response payload (any shape — OCGCore response bytes). Array position IS the index — no redundant `index` field. Compact, sufficient for OCGCore, inspectable in DB for debugging |
| Replay metadata | `{playerUsernames, deckNames, turnCount, result, date, scriptsHash, ocgcoreVersion}` | Enables match history queries without deserializing replay JSONB. `scriptsHash` + `ocgcoreVersion` enable divergence detection: at pre-computation time, the Duel Server compares these values against the current server's scriptsHash and ocgcoreVersion. If either differs, `REPLAY_METADATA` includes a `divergenceWarning: true` flag and the client displays a non-blocking snackbar warning ("This replay was recorded with a different script/engine version — results may differ from the original duel") |
| Storage location (ADR-5) | PostgreSQL via Spring Boot (`replay` table, JSONB for replay data) | Existing infrastructure, SQL queries for match history, Flyway migrations, transactional consistency |
| Capture flow | Worker accumulates responses in memory during duel. At duel end: worker `postMessage(replayData)` → main thread receives → `POST /api/replays` to Spring Boot → THEN worker cleanup | Follows tri-service pattern. Duel Server stays DB-free. Cleanup never precedes data transmission |
| Persist failure | If `POST /api/replays` fails: log the error, replay is lost | Same treatment as crash (accepted limitation). No fallback mechanism — KISS for personal project |
| TTL retention | Spring Boot scheduled task purges replays older than configurable period | Same pattern as `RoomCleanupScheduler` in PvP |
| Truncated replays | Duels ended by DISCONNECT or TIMEOUT produce replays with responses only up to the disconnect/timeout point. The replay is valid but shorter than a naturally completed duel. Pre-computation replays the available responses and the last pre-computed state is the replay's end. Timeline shows the actual turns played, not a theoretical full duel. No artificial end marker needed — the array simply ends | Same as normal replay, just fewer responses. OCGCore processes what it has |

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Replay access | Authenticated users only (existing JWT). **Route guard:** `/pvp/history` and `/pvp/replay/:replayId` routes are protected by both `AuthService` and `adminGuard` (admin-only access during MVP). **API access control:** `REPLAY_LOAD` and `REPLAY_FORK` verify that the authenticated user is player1 or player2 of the requested replay. `GET /api/internal/replays/:id` is internal-only (not exposed to Angular). `GET /api/replays` returns all replays for admins, or only replays where player1Id or player2Id matches the authenticated userId | Admin-only route guard during MVP (personal debugging tool). API-level ownership check prevents cross-player replay access |
| Omniscient view | Message filter with `omniscient: true` flag — skip filtering, keep OCGCore → WS protocol translation | Single code path for translation. Replay sees everything, no sanitization of card codes or hints |
| Replay WebSocket auth | Same one-shot JWT at handshake as PvP | Reuse existing pattern |

### API & Communication Patterns

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Protocol boundary (ADR-2) | Server: extend `ws-protocol.ts` with dedicated Replay section. Client: separate `replay-ws.types.ts` (Angular) | Single source of truth server-side. Decoupled consumption client-side — `ReplayConnection` imports only replay types |
| New client→server types | **4 types:** `REPLAY_LOAD` (trigger pre-computation), `REPLAY_FORK` (create solo session at event index), `REPLAY_FORK_CONTINUE` (accept fork despite sanity check warning), `REPLAY_FORK_CANCEL` (cancel fork after warning). All playback commands removed — navigation is 100% client-side (ADR-7) | Pre-computed states eliminate server-driven playback. No `REPLAY_PLAY/PAUSE/STEP_*/SEEK/FF/REWIND/ACTIVITY_PING`. Fork continue/cancel support the sanity check warning flow |
| New server→client types | **4 types:** `REPLAY_BOARD_STATES` (batched pre-computed states with events and labels — sent progressively, **one message per turn**), `REPLAY_METADATA` (replay info at handshake, includes `divergenceWarning` flag if scriptsHash/ocgcoreVersion differ), `REPLAY_ERROR` (divergence, pre-compute failure), `REPLAY_FORK_READY` (fork tokens for creating new PvP duel — sent after successful fork state reconstruction). ~~`REPLAY_STATE`, `REPLAY_END`, shared game messages~~ removed — client has all states locally | Pre-computed format per turn: `{turnNumber: number, states: Array<PreComputedState>}`. One WS message per turn keeps individual frame sizes manageable (~50-200KB per turn, well under typical 1MB WS frame limits). A 30-turn duel = 30 WS messages, not one giant payload. If a single turn exceeds 512KB (combo-heavy turn with 100+ events), the worker splits it into sub-batches of 50 states each |
| Replay data flow | Angular sends `replayId` at WS handshake → Duel Server fetches replay data from Spring Boot via `GET /api/internal/replays/:id` → creates worker | Same pattern as PvP deck relay. Angular never transports game data. Duel Server fetches from Spring Boot |
| Internal HTTP API additions | `POST /api/replays` (Duel Server → Spring Boot: persist replay at duel end), `GET /api/internal/replays/:id` (Duel Server ← Spring Boot: fetch replay data for playback) | Two new internal routes extending existing pattern |
| Match history REST API | `GET /api/replays` (paginated list by player, metadata only, query: `WHERE player1_id = :userId OR player2_id = :userId`, ordered by `created_at` DESC). No individual replay endpoint for Angular — the replay viewer gets metadata via `REPLAY_METADATA` WS message at handshake | Standard REST, consumed by Angular match history page. Deep-link to `/pvp/replay/:replayId` works without match history context — metadata arrives via WS |
| Divergence handling | Worker detects `MSG_RETRY` during replay = divergence. Sends `REPLAY_ERROR` to client with message. Stops playback cleanly — no watchdog kill | `MSG_RETRY` in replay context means script/engine divergence, not invalid player input |

### Frontend Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Board display | `PvpBoardContainerComponent` with `readOnly` input signal. Receives board state via input signals — agnostic of PvP vs replay. Both `DuelConnection` and `ReplayConnection` feed the same inputs | Read-only = no action menus, no prompts, no actionable glow. Animations and card inspector remain active |
| Replay page | `ReplayPageComponent` hosts `TimelineBarComponent` + `TransportBarComponent` (separate components, not inline). **Additional signals:** `promptMode: 'decision' \| 'result'` (pause on prompts vs auto-skip), `animationsEnabled` (toggle animations on/off), `perspectiveIndex` (player 0 or 1 view), `logDetail: 'normal' \| 'debug'`, `pausedAtBoundary` (paused at computed boundary), `isPlaying` (auto-play state). All preferences persisted to `localStorage`. **Fork:** navigates to `/pvp/duel/fork-{replayId}` (reuses existing duel route with `fork-` prefix as roomCode) — `ReplayForkService` caches board states and fork index for return, `DuelPageComponent` detects fork mode via `fork=true` query param | Fork uses route navigation (not in-page mode switch) — the duel page handles the forked solo session, replay page is destroyed. Return navigates back to `/pvp/replay/:replayId?seekTo={forkIndex}` |
| Replay page as controller | `ReplayPageComponent` holds the full `boardStates` array (pre-computed). Derives views for children: `turns[]` metadata for timeline, `boardStates[currentIndex]` for board, events for debug panel. `currentIndex` signal drives all child updates. **Playback engine:** `startPlayback()` → `scheduleNext()` → `doStepForward()` loop with `feedAnimatedTransition()` choosing between phased (decision mode) and direct (result mode) playback. `schedulePromptDismiss()` auto-dismisses prompts with dynamic duration based on original decision time | Central controller pattern — children receive only what they need. Playback engine supports both animated and instant navigation |
| Timeline bar | `TimelineBarComponent` — custom component, primary navigation. Receives `turns[]` metadata, `currentIndex`, `computedUpTo`, `totalEvents`, `boardStates` (full array, used for hover board preview), `ownPlayerIndex`. Emits `seekTo(index)`, `scrubbing(index)`. 3 zoom levels, chain segment grouping, `HIDDEN_LABELS` filtering | Board preview on hover uses the boardStates array directly — the component needs the full data to render scaled `PvpBoardContainerComponent` in popover |
| Transport bar | `TransportBarComponent` — custom component, secondary controls. Separate `output<void>()` per action: `skipStart`, `stepBack`, `playPause`, `stepForward`, `skipEnd`, `fork`, `toggleAnimations`, `togglePromptMode`, `togglePerspective`. Inputs: `isPlaying`, `forking`, `positionLabel`, `animationsEnabled`, `promptMode`, `perspectiveIndex` | One output per action (Angular signal pattern). No `mode` input — fork is handled by route navigation, not in-page mode switch |
| Replay state | `ReplayConnectionService` (scoped to `ReplayPageComponent`). **Simplified by ADR-7:** receives pre-computed board states at load, manages WS only for initial load + fork. No longer sends playback commands. Closes at fork, `DuelConnection` takes over. **`ReplayDuelAdapter`** implements `AnimationDataSource` interface — plugs into `AnimationOrchestratorService` identically to `DuelWebSocketService` in PvP. Key adapter methods: `feedTransition()` (single transition, no decisions), `feedTransitionPhased()` (transition with decisions → builds steps), `jumpToState()` (instant seek), `collapseRemainingSteps()` (fast-forward remaining steps), `resumeAfterPrompt()` (continue after paused decision), `abort()` (clear all state). Internal step model: `AnimateStep \| DecideStep` (`ReplayStep` type). **Transitive dependency:** `DuelWebSocketService` is provided in `ReplayPageComponent` because `PvpPromptDialogComponent` (reused for decision display) expects it | Navigation is local (index into pre-computed array). WS is only for data loading and fork. `ReplayDuelAdapter` ensures animation parity with PvP via shared `AnimationDataSource` interface |
| Match history | `MatchHistoryPageComponent` (at `pages/match-history-page/`) + `ReplayService` for REST API calls (`GET /api/replays` paginated, `DELETE /api/replays/{id}` individual deletion) | Paginated list via `CustomPageable<ReplayDTO>` |
| Client types | `replay-ws.types.ts` — separate from `duel-ws.types.ts` | Decoupled from PvP types. `ReplayConnection` imports only what it needs |

### Pre-Computed Client-Side Navigation (ADR-7 — replaces ADR-3)

**Status:** Replaces ADR-3 (server-driven seek). Driven by UX design specification analysis.

**Context:** The original ADR-3 specified server-driven replay navigation — every playback command is a WS round-trip (~500ms). UX design identified that the primary interaction is temporal navigation (seek + step), not passive playback. The user needs instant, friction-free movement through the timeline — including drag-scrubbing with live board state feedback. Server-driven navigation cannot support this.

**Decision:** Pre-compute all board states at replay load time. The worker replays all `playerResponses` through OCGCore WASM in silent mode, capturing a board state snapshot (`duelQueryField()` + `duelQuery()`) and the WS events after each response. The complete array is sent to the client progressively (per turn). All navigation becomes 100% client-side.

**Pre-computed state format:**
```typescript
interface PreComputedState {
  boardState: BoardStatePayload; // duelQueryField() + duelQuery() snapshot
  events: ServerMessage[];       // WS messages that produced the transition from previous state (for animation)
  label: string;                 // human-readable event label ("Normal Summon: Tearlaments Scheiren")
  responseCount: number;         // number of prompts processed to reach this state (used for positional tracking)
  decisions?: DecisionMoment[];  // prompt+response pairs during this transition (for phased playback with decision pauses)
  chainIndex?: number;           // if this state is part of chain resolution (for timeline segment grouping)
}
// Full array: Array<PreComputedState> sent progressively per turn via REPLAY_BOARD_STATES
```

**DecisionMoment** captures a single player decision during a transition:
```typescript
interface DecisionMoment {
  prompt: ServerMessage;                          // The SELECT_* message shown to the player
  response: { data: unknown; timestamp?: string }; // The response given (raw engine bytes)
  player: Player;                                  // Which player (0 or 1)
  hint?: {                                         // Optional hint context (structured object, not string)
    hintType: number;
    value: number;
    cardName: string;
    hintAction: string;
  };
  confirmedCards?: CardInfo[];                      // Cards confirmed/revealed during this decision
  boardState?: BoardStatePayload;                   // Board state snapshot BEFORE response was fed
                                                    // Matches the BOARD_STATE the live PvP client would have received
}
```

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Thread model | 1 worker thread per replay session, same `duel-worker.ts` with mode `'replay'`. **Worker freed after pre-computation** — not alive for entire session | Worker alive only for pre-compute (~2-10s) and fork (~1-2s). ~2MB WASM per worker, freed quickly |
| Pre-computation | Worker replays all responses, captures `{boardState, events[], label}` per response, sends to client in batches (per turn) via `REPLAY_BOARD_STATES`. **Turn 0 ("Setup")** is the initial game state batch: draw phase, opening hands dealt, LP set — all events before the first player action of Turn 1. Turn 0 is always sent as the first `REPLAY_BOARD_STATES` message. The client displays the board immediately from Turn 0's last state (both hands dealt, LP set) | Progressive: client can navigate already-computed turns while remaining turns compute in background. Turn 0 ensures the user sees a valid initial board state during progressive loading, not an empty board |
| Navigation (replaces ADR-3 seek) | **100% client-side.** Index selection into pre-computed `BoardState[]` array. Seek = change index (<1ms). Step = increment/decrement index. Scrub = emit index during drag | Eliminates all server round-trips for navigation. Enables DAW-style scrubbing |
| Board preview on hover | On timeline hover, a miniature board preview shows the board state at the hovered position. Uses the same pre-computed `boardStates[]` — no additional data needed. Rendered as a scaled-down `PvpBoardContainerComponent` (CSS `transform: scale()`, ~200px wide) inside a popover anchored to the cursor X position on the timeline. `readOnly = true`, animations disabled, card inspector disabled. Popover dismissed on mouse leave. During progressive loading, hover beyond `computedUpTo` shows no preview | Natural extension of pre-computed client-side navigation — the data is already in memory, just needs a miniature renderer |
| Seek bounds | Client-side validation: `0 <= index <= boardStates.length - 1`. Timeline visually blocks navigation beyond `computedUpTo` during progressive loading | No server-side validation needed — all data is local |
| Animation | Step/play mode: animate using captured `events[]` (WS messages) between consecutive states. Scrub/seek mode: direct board state injection, no animation | Events captured during pre-compute — no client-side diff inference needed |
| Idle timeout | **Not needed.** Worker freed after pre-computation. No persistent server session during navigation. WS connection stays open only for potential fork | Activity ping (`REPLAY_ACTIVITY_PING`) removed |
| WS disconnect during navigation | **No impact on navigation.** Pre-computed data is in client memory. WS disconnect only prevents fork. Reconnect to fork | Graceful degradation — navigation survives WS loss |

### Fork Architecture (ADR-6 — amended: reversible fork)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fork mechanism | **Worker re-activated for fork.** Since worker was freed after pre-computation (ADR-7), fork creates a new worker, replays all responses from scratch up to the fork point, then switches to solo mode. OCGCore WASM instance is live at the fork point | Worker reconstruction cost: ~1-2s (POC validated: 51ms for 252 responses). Acceptable for a punctual action. No way to reuse pre-computed states — they are read-only snapshots, not resumable WASM instances |
| Replay data caching (server) | The Duel Server caches the replay data (`{seed, decks, playerResponses[]}`) in a `Map<replayId, replayData>` for the duration of the replay session (~32KB per entry). Populated at `REPLAY_LOAD` (fetched from Spring Boot), reused at `REPLAY_FORK` (no second fetch). Evicted when the WS connection closes or on a 10-minute TTL (whichever comes first) | Avoids a redundant `GET /api/internal/replays/:id` round-trip on every fork. Memory cost is negligible (~32KB). TTL prevents memory leak if WS disconnects without cleanup |
| Main thread transition | Main thread creates new worker at fork point. Server sends `REPLAY_FORK_READY` with fork tokens to client. `ReplayForkService` (scoped to `ReplayPageComponent`) manages fork state (forking, ready, warning, error), caches board states for instant return, and coordinates the mode transition | Fork flow: `REPLAY_FORK` → server reconstructs state → `REPLAY_FORK_READY` with tokens → client transitions to solo mode. `ReplayForkService` replaces the originally planned `SoloDuelOrchestratorService` adoption pattern |
| Fork sanity check | Before forking: compare LP, card count, turn number, current phase, and chain state (active chain link count) between pre-computed state at fork index and reconstructed WASM state via `duelQueryField()`. Warning if any mismatch, don't block — client shows warning with Continue/Cancel | Catches major divergence (including mid-chain desynchronization) before the user invests time in a forked solo session |
| Fork direction | **Reversible via route navigation.** Fork navigates from `/pvp/replay/:replayId` to `/pvp/duel/fork-{replayId}` (reuses existing duel route with `fork-` prefix as roomCode). `ReplayForkService` caches `boardStates[]` and `forkEventIndex` before navigation. `DuelPageComponent` detects fork mode via `fork=true` query param and `forkReplayId` property — fork duels skip surrender confirmation on leave. **Return to replay:** navigate back to `/pvp/replay/:replayId?seekTo={forkIndex}`. Board states are re-pre-computed on return (WS reconnection required) | Fork uses route navigation, not in-page mode switch. The replay page is destroyed during fork. Return triggers a fresh replay load with seekTo for auto-positioning. This is simpler than in-page mode switching and avoids dual-service lifecycle complexity |
| Fork point caching | `ReplayForkService` caches `forkEventIndex` and `boardStates[]` in service signals before navigation. On return, `seekTo` query param positions the timeline at the fork point. If the replay page was fully destroyed, board states are re-pre-computed (progressive loading resumes) | Route-based return means the replay WS connection is re-established. Pre-computation cost (~2-10s) is the trade-off for simpler architecture vs in-page mode switching |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deployment | Same Docker compose, no new containers | Duel Server and Spring Boot are extended, not replaced |
| Concurrent replay sessions | Maximum 3 concurrent replay pre-computation workers on the Duel Server (configurable). Additional `REPLAY_LOAD` requests are queued. Fork workers count against the same limit. Each worker uses ~2MB (WASM instance) and is short-lived (~2-10s for pre-compute, ~1-2s for fork). With 3 concurrent workers, peak memory overhead is ~6MB — acceptable on a small VPS | Prevents memory pressure from multiple simultaneous replay loads (e.g., multiple browser tabs). Queue ensures requests are not rejected, just delayed |
| New DB migration | Flyway migration for `replay` table (id, player1_id, player2_id, metadata JSONB, replay_data JSONB, created_at) | Standard Spring Boot pattern |
| No failed replay storage | Persist failure = log + lost replay | Accepted limitation, same as crash. No fallback mechanism |

### Explicitly Out of Scope (MVP)

| Item | Rationale |
|------|-----------|
| ~~Checkpoint system for seek~~ | Superseded by ADR-7 (all states pre-computed client-side) |
| Client-side playback | Closed by ADR-1 (seed+responses requires OCGCore server-side). Note: pre-computation is server-side; only navigation is client-side |
| Match history filtering/search | Growth feature. ~10 players, low volume |
| Replay sharing | Growth feature |
| Persist on crash | Accepted limitation (FR1) |
| Script versioning/pinning | Accepted risk. scriptsHash + ocgcoreVersion enable detection, not prevention |
| Fast-forward / Rewind (FR9, FR10) | Removed by UX spec. Seek/scrub via pre-computed states replaces both |
| Fork history (list of past fork points) | Post-MVP. Accepted risk — typically 1-2 forks per session |

## Implementation Patterns & Consistency Rules

### Inherited Patterns

All naming, structure, and format patterns are inherited from `project-context.md` (62 rules). Key rules for agents:
- **Angular:** standalone components, signals, OnPush, `input()`/`output()`, kebab-case files, PascalCase classes, `app` prefix
- **Spring Boot:** layered architecture, `@Inject` (never `@Autowired`), MapStruct mappers, Flyway migrations, `CustomPageable<T>`
- **TypeScript:** strict mode, single quotes, 2-space indent, trailing comma es5, Prettier enforced
- **Duel Server:** TypeScript strict, ESM, `ws-protocol.ts` as protocol boundary, worker threads via `postMessage`

### Replay-Specific Patterns

**Worker Modes (single `duel-worker.ts` with 3 modes):**
- The worker operates in three modes: `'pvp'`, `'replay'`, `'solo'`. Mode is set at creation, stored as internal state
- `pvp`: receives responses from players via WS, message filter active, captures responses via wrapper
- `replay`: replays all responses from stored array in silent mode (pre-computation), captures `{boardState, events[], label}` per response, sends complete array to client via `REPLAY_BOARD_STATES`. Worker freed after pre-computation. Message filter omniscient during pre-compute
- `solo`: receives responses from both players via dual WS, message filter omniscient — identical to PvP but without filtering
- Mode transition (fork): `replay` → `solo`. **Reversible** — return to replay reloads and re-pre-computes. New worker created for fork (previous worker was freed after pre-computation)
- **After fork, response capture stops.** The worker in `solo` mode calls `setResponse` directly (not the wrapper)

**setResponse Wrapper Pattern (MANDATORY in replay capture, NOT in solo mode):**
```typescript
// During PvP duel capture — ALWAYS use this wrapper
function capturedSetResponse(duel: OcgDuel, response: Uint8Array, responses: CapturedResponse[]): void {
  responses.push({ data: Array.from(response) });
  duel.setResponse(response);
}
// After fork to solo — call duel.setResponse() directly, no capture
```

**Message Filter — translate() → sanitize() Pattern (MANDATORY):**
- Each filter function MUST follow a two-phase structure: `translate()` produces the complete JSON object from OCGCore binary, then `sanitize()` modifies sensitive fields (card codes, hints)
- The `omniscient: true` flag skips the `sanitize()` phase entirely — translation is preserved
- Anti-pattern: do NOT entremingle translation and sanitization in a single pass. If the current PvP filter functions do this, they must be refactored before implementing replay
- ONE code path for OCGCore → WS translation. No separate translator for replay

**Replay WebSocket Message Naming:**
- All replay-specific types prefixed with `REPLAY_` (e.g., `REPLAY_LOAD`, `REPLAY_FORK`, `REPLAY_BOARD_STATES`, `REPLAY_METADATA`, `REPLAY_ERROR`)
- ~~Game messages reuse existing names~~ — game messages are embedded within `PreComputedState.events[]`, not sent as separate WS messages. They are used client-side for animation, not as protocol messages
- 4 client→server types: `REPLAY_LOAD`, `REPLAY_FORK`, `REPLAY_FORK_CONTINUE`, `REPLAY_FORK_CANCEL`. 4 server→client types: `REPLAY_BOARD_STATES`, `REPLAY_METADATA`, `REPLAY_ERROR`, `REPLAY_FORK_READY`. Note: `REPLAY_LOAD` is implicit (replayId passed via WS URL query params at connection time, not as a separate message) — the type exists in the protocol definition but the connection URL carries the replayId

**Angular Replay Types (client-side):**
- Replay WS types in `replay-ws.types.ts` — separate from `duel-ws.types.ts`
- `ReplayConnection` service: scoped to `ReplayPageComponent`, NOT `providedIn: 'root'`
- `ReplayService` (REST API for match history): `providedIn: 'root'` — standard singleton
- `PvpBoardContainerComponent` receives `readOnly` input signal — no replay-specific logic inside the board

**Spring Boot Replay Entities:**
- Table: `replay` (lowercase, singular)
- Columns: `id` (UUID), `player1_id`, `player2_id` (FK to users), `metadata` (JSONB), `replay_data` (JSONB), `created_at` (timestamp)
- DTO: `ReplayDTO` — single DTO with `replayData` nullable. Public API returns it without replayData, internal API returns it with. Two mapper methods, one DTO class
- Mapper: `ReplayMapper` (abstract class, `@Mapper(componentModel = "spring")`) — `toDto()` (without replayData) and `toDetailDto()` (with replayData)
- Anti-pattern: do NOT expose `replay_data` in the public REST API. Only metadata goes to Angular

**API Surface:**
- Public (Angular → Spring Boot): `GET /api/replays` — paginated via `CustomPageable<ReplayDTO>` (metadata only, no replayData). Query: `WHERE player1_id = :userId OR player2_id = :userId`, ordered by `created_at` DESC. No individual replay endpoint for Angular — replay viewer gets metadata via WS `REPLAY_METADATA` at handshake (supports deep-link to `/pvp/replay/:replayId` without match history context)
- Internal (Duel Server → Spring Boot): `POST /api/replays` (persist at duel end)
- Internal (Duel Server ← Spring Boot): `GET /api/internal/replays/:id` (fetch full replay data for playback)

**Fork Transition (Angular — ROUTE NAVIGATION, REVERSIBLE):**
- `ReplayForkService` (scoped to `ReplayPageComponent`) manages fork state: caches `boardStates[]` and `forkEventIndex` before navigation, sends `REPLAY_FORK` via WS, listens for `REPLAY_FORK_READY` / warning / error
- At fork: server sends `REPLAY_FORK_READY` with fork tokens → `ReplayForkService` navigates to `/pvp/duel/fork-{replayId}` with query params `fork=true`, `replayId`, `seekTo={forkEventIndex}` and router state containing `wsToken1`/`wsToken2`. The replay page is destroyed
- `DuelPageComponent` detects fork mode via `fork=true` query param and `forkReplayId` property — fork duels skip surrender confirmation on leave (canDeactivate bypassed)
- **Return to replay:** navigate back to `/pvp/replay/:replayId?seekTo={forkEventIndex}`. The replay page loads fresh, establishes a new WS connection, and re-pre-computes board states (progressive loading). The `seekTo` query param auto-positions the timeline at the fork point

**i18n:**
- Add translation keys for match history and replay viewer labels in `fr.json` and `en.json`

**Error Handling in Replay Worker:**
- Script/engine divergence detection at load: compare `scriptsHash` + `ocgcoreVersion` from replay metadata against current server values. If mismatch, include `divergenceWarning: true` in `REPLAY_METADATA`. Client shows non-blocking snackbar warning. Pre-computation proceeds regardless
- `MSG_RETRY` during pre-computation = runtime divergence → send `REPLAY_ERROR` with context message, stop cleanly. Client shows snackbar, returns to match history
- OCGCore crash during pre-computation → watchdog 30s → worker terminate → `REPLAY_ERROR` to client
- `MSG_RETRY` during fork reconstruction = divergence → send fork sanity check warning (LP, card count, turn, phase, chain state mismatch). Client shows warning, user can continue or cancel
- ~~Seek out of bounds~~ — handled client-side (timeline visually blocks navigation beyond `computedUpTo`)
- ~~Checkpoint hook~~ — removed (superseded by ADR-7 full pre-computation)

## Project Structure & Boundaries

### New & Modified Files by Service

**Duel Server (Node.js) — Modified Files:**
```
duel-server/
├── src/
│   ├── server.ts                    # MODIFIED — add replay WS routing, replay session management, mode=replay handshake
│   ├── ws-protocol.ts               # MODIFIED — add REPLAY_* message types section
│   ├── message-filter.ts            # MODIFIED — refactor translate() → sanitize() separation, add omniscient flag
│   ├── duel-worker.ts               # MODIFIED — add 3 modes (pvp/replay/solo), capturedSetResponse wrapper, response accumulation, replay playback logic, fork mode switch
│   ├── ocg-scripts.ts               # MODIFIED — add getScriptsHash() (hash of scripts directory at load time)
│   └── types.ts                     # MODIFIED — add ReplaySession, CapturedResponse, WorkerMode types
```

**Spring Boot (Java) — New Files:**
```
src/main/java/.../
├── controller/
│   └── ReplayController.java        # NEW — GET /api/replays (public, paginated), POST /api/replays (internal persist), GET /api/internal/replays/:id (internal fetch)
├── service/
│   └── ReplayService.java           # NEW — replay CRUD, TTL purge logic
├── repository/
│   └── ReplayRepository.java        # NEW — CrudRepository + PagingAndSortingRepository + JpaSpecificationExecutor
├── model/
│   ├── entity/
│   │   └── Replay.java              # NEW — JPA entity (id, player1, player2, metadata JSONB, replayData JSONB, createdAt)
│   ├── dto/
│   │   └── ReplayDTO.java           # NEW — single DTO, replayData nullable (metadata-only for public, full for internal)
│   └── enums/
│       └── DuelResult.java          # NEW — 9 values: VICTORY, DEFEAT, DRAW, TIMEOUT, DISCONNECT, SURRENDER, OPPONENT_TIMEOUT, OPPONENT_DISCONNECT, OPPONENT_SURRENDER. Stored relative to player1. OPPONENT_* variants preserve "why" context in match history (e.g., "Win — opponent timeout" vs generic "Victory"). `flip()` maps between perspectives: VICTORY↔DEFEAT, TIMEOUT↔OPPONENT_TIMEOUT, DISCONNECT↔OPPONENT_DISCONNECT, SURRENDER↔OPPONENT_SURRENDER, DRAW→DRAW
├── mapper/
│   └── ReplayMapper.java            # NEW — MapStruct, toDto() and toDetailDto() methods
├── config/
│   └── RoomCleanupScheduler.java    # MODIFIED — add replay TTL purge as additional @Scheduled method

src/main/resources/db/migration/flyway/
└── V{NNN}__create_replay_table.sql  # NEW — Flyway migration
```

**Angular (TypeScript) — New Files:**
```
src/app/
├── pages/
│   ├── match-history-page/
│   │   ├── match-history-page.component.ts      # NEW — list of past duels (paginated, mat-table + mat-paginator)
│   │   ├── match-history-page.component.html
│   │   └── match-history-page.component.scss
│   └── pvp/replay/
│       ├── replay-page.component.ts              # NEW — Controller: holds boardStates[], derives views for children, playback engine
│       ├── replay-page.component.html
│       ├── replay-page.component.scss
│       ├── replay-duel-adapter.ts                # NEW — AnimationDataSource impl for replay (feedTransition, buildSteps, advanceStep)
│       ├── replay-fork.service.ts                # NEW — Fork state management, caches boardStates, navigates to /pvp/duel/fork-{replayId}
│       ├── replay-connection.service.ts          # NEW — WS for initial load + fork only (simplified by ADR-7), scoped to ReplayPageComponent
│       ├── timeline-bar/
│       │   ├── timeline-bar.component.ts         # NEW — Primary navigation, turn segments, scrub, zoom, hover board preview
│       │   ├── timeline-bar.component.html        #        IN: turns[], currentIndex, computedUpTo, totalEvents, boardStates, ownPlayerIndex. OUT: seekTo, scrubbing
│       │   └── timeline-bar.component.scss
│       └── transport-bar/
│           ├── transport-bar.component.ts         # NEW — Secondary controls: step, play/pause, fork, toggles
│           ├── transport-bar.component.html        #        IN: isPlaying, forking, positionLabel, animationsEnabled, promptMode, perspectiveIndex. OUT: per-action outputs
│           └── transport-bar.component.scss
├── services/
│   ├── replay.service.ts                         # NEW — REST API calls (GET /api/replays, DELETE /api/replays/{id}), providedIn: 'root'
├── pages/pvp/
│   └── replay-ws.types.ts                        # NEW — replay WS types (re-exports from duel-ws.types.ts): REPLAY_LOAD, REPLAY_FORK, REPLAY_FORK_CONTINUE, REPLAY_FORK_CANCEL, REPLAY_BOARD_STATES, REPLAY_METADATA, REPLAY_ERROR, REPLAY_FORK_READY
├── app.routes.ts                                 # MODIFIED — add /pvp/history, /pvp/replay/:replayId
├── assets/i18n/
│   ├── fr.json                                   # MODIFIED — add match history + replay viewer keys
│   └── en.json                                   # MODIFIED — add match history + replay viewer keys
```

### Architectural Boundaries

**API Boundaries:**

| Boundary | Route | Direction | Purpose |
|----------|-------|-----------|---------|
| Public REST | `GET /api/replays` | Angular → Spring Boot | Match history list (paginated, metadata only) |
| Public REST | `DELETE /api/replays/{id}` | Angular → Spring Boot | Delete individual replay (ownership verified) |
| Internal REST | `POST /api/replays` | Duel Server → Spring Boot | Persist replay at duel end |
| Internal REST | `GET /api/internal/replays/:id` | Duel Server ← Spring Boot | Fetch replay data for playback |
| Replay WS | `ws://duel-server?mode=replay&replayId=X` | Angular ↔ Duel Server | Replay load (pre-computed states ← Duel Server) + fork command (→ Duel Server) |

**Component Boundaries:**
- `ReplayPageComponent` owns `ReplayConnectionService` (scoped) and `ReplayForkService` (scoped), hosts `PvpBoardContainerComponent` (readOnly) + timeline + transport + playback engine
- `PvpBoardContainerComponent` receives board state via input signals and `readOnly` flag — agnostic of PvP vs replay
- Fork navigates away from replay page to `/pvp/duel/fork-{replayId}` — replay page is destroyed, duel page handles the forked session

**Data Flow:**
```
[Capture]         worker accumulates responses → duel end → postMessage(replayData) → main thread POST /api/replays → Spring Boot → PostgreSQL
[Match History]   Angular GET /api/replays → Spring Boot → PostgreSQL → CustomPageable<ReplayDTO>
[Open Replay]     Angular WS handshake(mode=replay&replayId=X) → Duel Server GET /api/internal/replays/:id → Spring Boot → ReplayDTO(full) → create worker(mode='replay')
                  → worker pre-computes ALL board states (progressive per turn) → REPLAY_BOARD_STATES (batched) → client stores in memory
                  → worker freed after pre-computation
[Navigation]      100% client-side: ReplayPageComponent changes currentIndex → board/timeline/debug panel update locally (<1ms)
[Fork]            client sends REPLAY_FORK(responseCount, expectedState) via WS → Duel Server uses cached replay data (no re-fetch) → creates NEW worker → replays responses to eventIndex (~1-2s)
                  → fork sanity check (LP, turn, phase) → if mismatch: REPLAY_FORK warning → client Continue/Cancel
                  → on success: sends REPLAY_FORK_READY(token1, token2) → ReplayForkService navigates to /pvp/duel/fork-{replayId} with fork tokens
[Return]          navigate back to /pvp/replay/:replayId?seekTo={forkEventIndex} → fresh replay load → re-pre-computation (progressive) → auto-seek to fork point
```

### FR to Structure Mapping

| FR | Files |
|----|-------|
| FR1-2 (Capture) | `duel-worker.ts` (wrapper, mode pvp), `server.ts` (POST on duel end), `ReplayController.java`, `ReplayService.java` |
| FR3-4 (Match History) | `match-history-page.component.ts`, `replay.service.ts`, `ReplayController.java` |
| FR5-8, FR11 (Playback — FR9/FR10 removed) | `duel-worker.ts` (mode replay, pre-computation), `replay-page.component.ts` (controller), `timeline-bar.component.ts`, `transport-bar.component.ts` |
| FR12-15 (Display) | `PvpBoardContainerComponent` (readOnly input), `message-filter.ts` (omniscient), `replay-page.component.ts` |
| FR16-18 (Fork) | `duel-worker.ts` (fork reconstruction), `server.ts` (REPLAY_FORK handler, REPLAY_FORK_READY), `replay-fork.service.ts` (fork state, navigation), `duel-page.component.ts` (fork mode detection) |
| FR19 (Retention) | `RoomCleanupScheduler.java` (extended), `ReplayService.java` |
| FR20 (Deletion) | `replay.service.ts` (Angular DELETE call), `ReplayController.java`, `ReplayService.java` |

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** 7 ADRs (including ADR-7 amendment). ADR-1 (seed+responses) aligns with ADR-7 (pre-compute all states at load). ADR-6 (reversible fork) creates new worker for fork (worker freed after pre-computation). ADR-2 (protocol) simplified to 5 total message types (2 client→server, 3 server→client). Omniscient flag on message filter is coherent with pre-computation mode. No contradictory decisions.

**Pattern Consistency:** All replay patterns follow existing project-context conventions (CustomPageable, MapStruct, standalone components, signals, OnPush, `output<void>()`). `REPLAY_` prefix for new WS types is coherent with existing PvP naming. Timeline and transport bar follow Angular component patterns (input signals, separate outputs per action).

**Structure Alignment:** Every ADR maps to specific files. Every FR has a complete end-to-end path through the structure.

### Requirements Coverage ✅

**17 of 19 FRs architecturally supported (FR9, FR10 removed by UX spec).** FR1-2 (capture via wrapper + POST), FR3-4 (match history via paginated REST), FR5-8 + FR11 (playback via pre-computed client-side navigation — ADR-7), FR12-15 (display via omniscient view + readOnly board + provenance markers), FR16-18 (fork via new worker reconstruction + reversible return), FR19 (retention via extended RoomCleanupScheduler).

**All 7 NFRs addressed.** NFR1 (<1ms navigation via pre-computed states — exceeds 500ms target), NFR2 (seek validated by POC: 51ms for 252 responses — pre-computation), NFR3 (standard Spring Boot query), NFR4 (deterministic via seed+responses + scriptsHash warning), NFR5 (fork sanity check + WASM reconstruction), NFR6 (WS only for load+fork, not persistent — navigation survives disconnection), NFR7 (same browser matrix).

### Implementation Readiness ✅

- 7 ADRs documented with rationale and alternatives (including ADR-7 amendment from UX spec)
- Replay-specific patterns with code examples and anti-patterns
- ~18 new files + 8 modified files, each with documented role
- Complete FR → file mapping
- Extensively stress-tested via 8 architecture elicitation sessions + 14-step UX design workflow (4 Party Mode sessions, 4 Advanced Elicitation sessions)
- POC validated: deterministic replay (568 identical messages), seek (51ms avg), fork (functional), storage (~32KB/duel)

### Refactoring Prerequisites

Two existing PvP components need refactoring before replay implementation:

1. **`PvpBoardContainerComponent`** — must receive board state via input signals instead of `DuelConnection` injection. Makes it agnostic of PvP vs replay data source
2. **`message-filter.ts`** — must separate `translate()` and `sanitize()` phases if currently entremixed. Enables `omniscient: true` flag to skip sanitization while preserving translation

### UX Specification Amendments Summary

The following changes were driven by the UX design specification ([ux-design-specification-replay.md](ux-design-specification-replay.md)):

| Amendment | Original Decision | New Decision | Rationale |
|-----------|------------------|--------------|-----------|
| ADR-7 (replaces ADR-3) | Server-driven navigation, WS round-trip per action | Pre-computed client-side navigation, all states at load time | "Timeline is the product" — instant seek (<1ms), scrub with live board update, 9→2 WS message types |
| ADR-6 amended | Fork is one-way, return = navigate to match history | Fork is reversible, "Return to Replay" restores cached board states and auto-seeks to fork point (no re-pre-computation) | "Fork is exploratory, not permanent" — user tests alternatives and returns to try more. Instant return enables rapid fork-return cycles |
| FR9/FR10 removed | Fast-forward and rewind as playback controls | Removed — seek/scrub replace both | "Search-first" — if you want to go fast, seek to the turn |
| Protocol simplified | 9 client→server + 4 server→client types | 2 client→server + 3 server→client types | Pre-computed states eliminate server-driven playback commands |
| Worker lifecycle | Alive for entire replay session + idle timeout | Freed after pre-computation, re-activated only for fork | No persistent server session during navigation |
| Component architecture | Inline playback controls in ReplayPageComponent | Separate TimelineBarComponent + TransportBarComponent | UX identified timeline as defining element, warranting dedicated components with clear data flow |

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — extensively validated through 8 architecture elicitation sessions + UX design workflow (14 steps, 4 Party Mode sessions, 4 Advanced Elicitation sessions) + POC validation (deterministic replay: 568 identical messages, seek: 51ms avg, fork: functional, storage: ~32KB/duel)
