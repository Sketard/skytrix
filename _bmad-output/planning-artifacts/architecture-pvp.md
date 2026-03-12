---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments: ['prd-pvp.md', 'architecture.md', 'project-context.md', 'research-ygo-duel-engine.md', 'research-ocgcore-message-protocol.md', 'research-wasm-js-duel-engines.md', 'research-web-ygo-simulators.md', 'ux-design-board-animations.md']
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-02-24'
project_name: 'skytrix'
user_name: 'Axel'
date: '2026-02-24'
lastEdited: '2026-03-10'
editHistory:
  - date: '2026-03-10'
    changes: 'Integrated animation orchestration architecture (3-layer chain system, async overlay contract, pending chain entry) and PvP-C board animations (card travel, buffer/replay, CardTravelService, XYZ material visuals, Beat-based parallel replay, acceleration features)'
  - date: '2026-03-12'
    changes: 'Replaced animation orchestration detail section with summary + link to animation-architecture-pvp.md (new dedicated document). Removed obsolete AC5 and animatingZone Set<string> signal.'
---

# Architecture Decision Document — PvP (Online Automated Duels)

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
25 functional requirements across 4 categories covering matchmaking & session management (FR1-7: room creation, deck validation, lobby, auto-start, surrender, disconnection handling, win/draw conditions), turn & phase management (FR8-10: automated phase flow, main phase contextual actions, battle phase actions), player prompts & engine delegation (FR11-13: modal dialogs for all SELECT_* types, chain resolution delegation, full rule enforcement delegation), and board display & information (FR14-25: two-player field display, private information hiding, LP tracking, chain visualization, card inspection, turn indicator, turn timer, inactivity timeout, visual feedback per game event, click-based interaction, duel result screen, client-side activation toggle).

The PvP mode is fundamentally different from the solo simulator: the duel engine (OCGCore) is the sole authority for game state, the player responds to engine prompts rather than freely manipulating the board, and all communication is server-mediated for anti-cheat integrity.

**Non-Functional Requirements:**
10 NFRs across 5 areas:
- **Network & Latency (NFR1-2):** Player action to board update round-trip < 500ms. WebSocket stable for full duel duration (up to 60 min) with heartbeat/keep-alive.
- **Scalability (NFR3):** 50 concurrent duels without degradation. Each duel requires one OCGCore WASM instance with its own Lua VM. Memory footprint per duel instance must be profiled during implementation.
- **Reliability (NFR4-5):** 60-second reconnection grace period. Duel state preserved server-side up to 4 hours if both disconnect. Reconnection uses a snapshot via `duelQueryField()` + `duelQuery()` (not message log replay — OCGCore has no save/restore, and replay is fragile and slow).
- **Security (NFR6-8):** Server-only game state authority. Per-player message filtering (no private info leakage). Response validation by engine. JWT-protected WebSocket and PvP routes.
- **Compatibility & Licensing (NFR9-10):** Modern desktop + mobile browsers. AGPL-3.0 compliance for duel server source code.

**Scale & Complexity:**

- Primary domain: Full-stack (new Node.js microservice + Spring Boot extensions + Angular PvP UI)
- Complexity level: High — real-time bidirectional WebSocket, anti-cheat message filtering, new server infrastructure, distinct interaction paradigm from existing solo mode
- Estimated architectural components: ~20-25 (duel server: core engine wrapper, worker threads, WebSocket manager, message filter, session/reconnection manager, duel lifecycle, HTTP internal API; Spring Boot: matchmaking/room endpoints, deck validation, deck relay; Angular: lobby page, duel page, WebSocket service, board adapter, ~8-10 prompt UI components for the 20 SELECT_* types, animation queue)

### Scope Tiering (MVP = Friends Only)

The MVP targets PvP between friends (trusted players). This determines which architectural constraints are required now vs deferred.

| Tier | Scope | Elements |
|------|-------|----------|
| **T1 — MVP (friends)** | The duel works correctly and safely | Worker thread per duel, message filter whitelist (default DROP), snapshot reconnection (`duelQueryField`), OCGCore error handling (watchdog 30s), WebSocket DTOs as protocol boundary, basic FIFO animation queue, one-shot WebSocket auth |
| **T2 — Public access** | Required if open to untrusted players | Bluff timer (anti timing side-channel), WebSocket rate limiter, MSG_RETRY counter → auto-forfeit, duel-specific token, reconnection limit (3 max or 60s cumulative), deck snapshot anti-race-condition |
| **T3 — Phase 2** | Future capabilities | Spectator mode (viewerType enum), AI opponent (PlayerHandler interface), DuelEngine abstraction, state verification heartbeat, triplet versioning CI, fast-forward animation mode |

### Technical Constraints & Dependencies

- **Existing stack:** Angular 19.1.3, Spring Boot 3.4.2 + PostgreSQL, TypeScript strict, standalone components, signals, OnPush
- **New dependency:** `@n1xx1/ocgcore-wasm` (0.1.1, JSR) — OCGCore compiled to WASM, 885KB binary, TypeScript API, sync mode only (JSPI experimental)
- **New dependency:** `better-sqlite3` — reads cards.cdb (7.2MB SQLite, ProjectIgnis/BabelCDB)
- **New dependency:** WebSocket library (`ws` or `socket.io`) — bidirectional duel communication
- **External data:** ProjectIgnis/CardScripts (~13,000+ Lua files), ProjectIgnis/BabelCDB (cards.cdb) — loaded server-side
- **ESM patch required:** `@n1xx1/ocgcore-wasm` needs `patch-package` fix for default export (documented in PoC)
- **Sync mode blocks the thread:** All OCGCore processing (duelProcess + Lua execution) runs synchronously. Complex chain resolutions (10+ links) can block the Node.js event loop for 100-200ms+. Each duel MUST run in a dedicated worker thread to prevent one duel from blocking others.
- **Sync callbacks:** cardReader and scriptReader must be synchronous — all Lua scripts and card data must be pre-loaded in memory before duel start
- **PoC validated:** Node.js + ocgcore-wasm duel loop proven functional (create → process → getMessage → setResponse). Tested with basic decks. Competitive decks (complex chains) not yet validated.
- **Anti-cheat constraint:** Frontend never sends decklists to duel server — Spring Boot relays server-to-server
- **Solo simulator prerequisite:** Board zone components, card component, card inspector, card data services, authentication, deck management APIs must be available for reuse
- **WebSocket protocol boundary:** The duel server translates OCGCore messages into a WebSocket JSON protocol. The Angular frontend consumes this protocol without knowledge of OCGCore internals. Types are defined independently on each side (DTOs, not shared package). This creates a clean architectural boundary.
- **WebSocket auth is one-shot:** Authentication happens at WebSocket handshake (JWT validation). Once connected, the player remains authenticated for the socket's lifetime — no per-message re-validation. JWT expiry during a duel has no impact.

### Cross-Cutting Concerns Identified

- **Anti-cheat / Message filtering (T1):** Every message from OCGCore must be filtered per-player before WebSocket transmission via a whitelist of per-message-type filter functions. Key sanitization rules: `MSG_DRAW` card codes sanitized for opponent, `MSG_SHUFFLE_HAND` card codes sanitized, `MSG_MOVE` from private zone (deck/hand) to private zone sanitized, `MSG_HINT` routed only to the intended player (HINT_EFFECT with card code of hand card = leak if broadcast). SELECT_* messages sent only to the deciding player. **Default policy: DROP + LOG** — any unrecognized message type is never transmitted (fail-safe: prefer missing display over info leak).
- **Authentication chain (T1):** JWT flows from Angular → Spring Boot (REST) → Duel Server (HTTP internal for duel creation) → WebSocket (connection auth). Three authentication boundaries. WebSocket auth is one-shot at handshake.
- **Session lifecycle & reconnection (T1):** Duel state survives player disconnection (60s grace). On reconnection, the server sends a full state snapshot via `duelQueryField()` + per-card `duelQuery()`, filtered for the reconnecting player. No message log replay. OCGCore state exists only in the live WASM worker instance.
- **Component reuse (solo ↔ PvP) (T1):** Board zones, card component, card inspector shared between modes. Data source differs: solo = local signals via BoardStateService, PvP = server-pushed state via WebSocket. The PvP board layout differs fundamentally from solo: two player fields visible (36 zones vs 18), different aspect ratio, opponent's field mirrored. Architecture uses composition: extract a `PlayerFieldComponent` (18 zones) from the solo board. PvP composes two instances (own + opponent mirrored). Solo uses it directly.
- **Two interaction paradigms (T1):** Solo = drag & drop (CDK DragDrop), PvP = click-based prompts. Same visual components, completely different interaction handlers.
- **Turn timer & inactivity (T1):** Timer state is server-authoritative. Server pushes timer updates; client displays. Timer pauses during opponent's decisions and chain resolution. Edge case: timeout during mandatory SELECT_* — the server forfeits the match and properly closes the OCGCore duel instance.
- **Animation orchestration (T1):** OCGCore produces event messages in bursts during chain resolution (10+ messages in <100ms). The client implements a **three-layer animation architecture**: `DuelConnection` (data — enqueues events, manages chain link state), `AnimationOrchestratorService` (timing — dequeues sequentially, controls signal mutations, coordinates async pauses), `PvpChainOverlayComponent` (visual — card cascade, resolve-exit animations, board pause). The orchestrator consumes messages at animation speed, not network speed. Key mechanisms:
  - **Async overlay contract:** On `MSG_CHAIN_SOLVED`, the orchestrator pauses (returns `'async'`), sets `chainOverlayReady = false`. The overlay plays its exit animation, optionally hides for a board pause window, then sets `chainOverlayReady = true` to resume the orchestrator.
  - **Pending chain entry:** `MSG_CHAINING` does NOT immediately commit to `activeChainLinks`. It is stored as `_pendingChainEntry` and committed only after cost prompts complete (`SELECT_EFFECTYN` response sent, `WAITING_RESPONSE` received, next `MSG_CHAINING`, or `MSG_CHAIN_SOLVING`). This prevents cards from appearing in the overlay before their activation cost is paid.
  - **Board event buffer & replay (PvP-C):** During chain resolution (`MSG_CHAIN_SOLVING` → `MSG_CHAIN_SOLVED`), board-changing events (`MSG_MOVE`, `MSG_FLIP_SUMMONING`, `MSG_CHANGE_POS`, `MSG_DAMAGE`, etc.) are buffered instead of processed immediately. After the overlay exit animation, buffered events replay as visible card travel animations on the board during the overlay-hidden window. Board pause duration is **dynamic** (calculated from replay animation time) instead of fixed.
  - **Card travel animations (PvP-C):** Replace in-place glow effects (`pvp-summon-flash`, `pvp-destroy-flash`) with spatial card movement between zones (Lift → Travel → Land). A dedicated `CardTravelService` (component-scoped) creates `position: fixed` floating elements, resolves source/destination rects via `getBoundingClientRect()`, animates with Web Animations API, and cleans up on completion. `pvp-flip-flash` and `pvp-activate-flash` remain unchanged (in-place by nature).
  - **Acceleration features:** AC5 (auto-resolve: ≥3 chain links solved without prompt → halve animation durations), AC7 (queue collapse: > 5 queued events → instantly apply all but last 3, skip if chain resolution events present), AC8 (speed multiplier: activation toggle `off` → 0.5× all durations).
- **Prompt UI components (T1):** The 20 SELECT_* types map to ~8-10 distinct UI components grouped by interaction pattern: card grid selection (SELECT_CARD, SELECT_TRIBUTE, SELECT_SUM, SELECT_UNSELECT_CARD), yes/no dialogs (SELECT_EFFECTYN, SELECT_YESNO), zone highlight (SELECT_PLACE, SELECT_DISFIELD), position picker (SELECT_POSITION), option list (SELECT_OPTION, SELECT_CHAIN), ordering (SORT_CARD, SORT_CHAIN), declaration pickers (ANNOUNCE_RACE, ANNOUNCE_ATTRIB, ANNOUNCE_CARD, ANNOUNCE_NUMBER), counters (SELECT_COUNTER), phase action menus (SELECT_IDLECMD, SELECT_BATTLECMD), and RPS (ROCK_PAPER_SCISSORS).
- **IDLECMD/BATTLECMD as distributed UI (T1):** SELECT_IDLECMD and SELECT_BATTLECMD are NOT rendered as prompt sheet components. Instead, card-specific actions are distributed spatially: cards with available actions glow on the field (`--pvp-actionable-glow`), zone browsers (GY, Banished, ED) highlight actionable cards, and phase transitions (Battle Phase, Main Phase 2, End Turn) are handled by `PvpPhaseBadgeComponent`. Tap a card with 1 action → sent directly. Tap a card with 2+ actions → contextual action menu (absolute-positioned div, not a sheet). The client maps the engine's flat action list to spatial UI elements. See UX spec §PvpPhaseBadgeComponent and §Card Action Menu.
- **MSG_HINT as UX-critical (T1):** OCGCore sends MSG_HINT (HINT_SELECTMSG, HINT_EFFECT, HINT_CODE) before SELECT_* messages to provide context (which effect is asking, what the prompt means). These hints are essential for a usable UI — without them, prompts are blind choices. The Angular WebSocket service must maintain a `currentHintContext` consumed by all prompt components.
- **OCGCore error resilience (T1):** Lua script errors and OCGCore crashes are expected (community-maintained scripts, weekly updates). The worker wraps `duelProcess()` with error handling. A watchdog timer (30s) kills workers that don't return. On error: declare draw, notify both players, cleanup.
- **Thread architecture (T1):** The WebSocket manager runs on the Node.js main thread. Each duel runs in a dedicated worker thread. Communication via `postMessage`. This ensures the main thread remains responsive for heartbeat/ping-pong even when a worker is blocked during chain resolution.

### Preliminary Architecture Decisions (from ADR analysis)

| ADR | Decision | Rationale |
|-----|----------|-----------|
| Thread isolation | Worker thread per duel | Total isolation, acceptable memory overhead (50 × ~2MB WASM) |
| Type sharing | Independent WebSocket DTOs | Clean boundary, frontend/engine decoupled, boring tech |
| Board layout PvP | ~~Composition via PlayerFieldComponent~~ **REVISED: PvP builds own PvpBoardContainerComponent** | Original: Extract don't rewrite. **Revised (2026-02-25 FMA):** Solo grid (7-col, EMZ in grid, drag-drop, 1060×608px) is fundamentally incompatible with PvP grid (6-col, EMZ in central strip, click-based, CSS perspective). Shared reuse happens at CardComponent/CardInspectorComponent level (already in components/), not at grid layout level. Story 1-1 skipped. |
| Message filter | Whitelist per message type | Safety-critical = explicit, auditable, default DROP policy |

### Story-Level Implementation Notes

_These insights surfaced during analysis but are too granular for architecture decisions. They should be captured in story acceptance criteria or implementation tasks._

- Worker thread: wrap `duelProcess()` in try/catch, implement 30s watchdog via `setTimeout` + `worker.terminate()`
- Client: handle `document.visibilitychange` — when tab returns to focus, consume animation queue in fast-forward (skip animations, show final state)
- Client: display countdown timer on each prompt, notification at 10s remaining
- Message filter: `MSG_DRAW` contains `card_code` + `position` per drawn card — sanitize `card_code` to 0 for opponent, keep `position`
- Message filter: `MSG_SHUFFLE_HAND` contains card codes after shuffle — sanitize all to 0 for opponent
- Message filter: `MSG_CONFIRM_CARDS` reveals specific card codes — route only to the intended player
- Reconnection snapshot: use `duelQueryField()` for global state + `duelQueryLocation()` per zone with FULL_FLAGS (`OcgQueryFlags.CODE | POSITION | ATTACK | DEFENSE | TYPE | LEVEL | RANK | ATTRIBUTE | RACE | OVERLAY_CARD | COUNTERS | LSCALE | RSCALE | LINK`). Apply message filter per player before sending (hand codes → 0 for opponent, face-down codes → 0 for opponent). See `ocgcore-technical-reference.md` §8 for exact query strategy and `OcgFieldState` structure
- Scripts update: update `data/` folder manually, restart duel server. New duels use new scripts; in-progress duels keep their loaded scripts.
- Scope reduction (PvP-A0): for first testable increment, implement only the most frequent SELECT_* types (IDLECMD, BATTLECMD, CARD, CHAIN, EFFECTYN, PLACE, POSITION). Others fallback to auto-select first valid option.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack brownfield — three technology domains:
- **Angular 19.1.3 SPA** (existing) — new PvP pages, prompt components, WebSocket service
- **Spring Boot 3.4.2** (existing) — new matchmaking/room REST endpoints, deck relay to duel server
- **Node.js Duel Server** (new) — extends PoC into production microservice

### Starter Options Considered

**Frontend (Angular):** Not applicable — brownfield project, existing SPA with established patterns (standalone components, signals, OnPush). PvP features are new pages/components within the existing application.

**Backend (Spring Boot):** Not applicable — existing service with established patterns. PvP adds new REST controllers and an HTTP client for duel server communication.

**Duel Server (Node.js):** No starter template needed. The PoC (`research-ygo-duel-engine.md` §10.6) validated the core duel loop (create → process → getMessage → setResponse). Production server extends this foundation with WebSocket and worker thread isolation.

### Selected Approach: Extend PoC + Minimal Dependencies

**Rationale:** The project is brownfield with established conventions. The only new infrastructure is the Node.js duel server, which is too specialized (OCGCore WASM + worker threads + WebSocket) for any generic starter to be useful. The PoC already validates the core technical risk.

**Duel Server Technology Choices:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| WebSocket library | `ws` | Raw, lightweight, full control over binary/text frames. No fallback transport needed (modern browsers only). No namespace/room abstraction overhead — duel server manages its own session mapping. |
| Internal HTTP API | Native `node:http` | 4 routes only (create duel, player join, health, status). No middleware, no body parsing beyond `JSON.parse`. Adding Express/Fastify for 4 routes is over-engineering. |
| Runtime | Node.js 22+ LTS, ESM | Required for `worker_threads` stability and `@n1xx1/ocgcore-wasm` ESM support |
| Language | TypeScript 5.9 strict | Consistent with Angular frontend, type safety for message protocol |
| Build & Run | `tsx` for development, `tsc` + `node dist/server.js` for production | `tsx` gives fast DX iteration without build step. Production uses compiled JS for performance and no dev dependency. |

**Production Source File Structure (7 files):**

| File | Role | Responsibility |
|------|------|---------------|
| `server.ts` | Main thread entry point | `ws.WebSocketServer` + `node:http` server, session routing, worker lifecycle management |
| `duel-worker.ts` | Worker thread entry point | Spawned via `new Worker('./duel-worker.ts')` — NOT imported by server.ts. OCGCore WASM instance, duel loop (`duelProcess` → `getMessage` → `setResponse`), `parentPort.postMessage` communication with main thread. |
| `message-filter.ts` | Pure function module | Whitelist-based per-player message filtering (anti-cheat). Stateless pure functions: `(message, playerId) → filteredMessage | null`. Most safety-critical and most testable component. |
| `ws-protocol.ts` | Protocol boundary | WebSocket DTO types sent/received by the Angular frontend. This file IS the ADR-2 boundary — changes here are protocol changes. |
| `types.ts` | Internal types | OCGCore enum re-exports, internal constants, worker message types, session state interfaces |
| `ocg-callbacks.ts` | OCGCore integration | `cardReader` + `scriptReader` sync callbacks for OCGCore. Receives pre-loaded `CardDB` via injection (not global state). |
| `ocg-scripts.ts` | Data loading | Exports `loadDatabase(dbPath): CardDB` and `loadScripts(scriptDir): ScriptDB`. Reads `cards.cdb` (better-sqlite3) + Lua files at startup. Returns injectable data objects consumed by `ocg-callbacks.ts`. |

**Dependencies (production):**

| Package | Purpose | Status |
|---------|---------|--------|
| `@n1xx1/ocgcore-wasm` | OCGCore WASM binary + TypeScript API | Validated in PoC (+ ESM patch via `patch-package`) |
| `ws` | WebSocket server | To add |
| `better-sqlite3` | Read cards.cdb (card database) | To add |
| `tsx` | Dev-only: TypeScript execution without build step | To add (devDependency) |

**Note:** PoC code remains as standalone reference. Production duel server is a new entry point (`server.ts`) that reuses the validated OCGCore integration patterns from the PoC.

**Note:** First implementation story scope: scaffold Node.js project (`package.json`, `tsconfig.json`, `patch-package` setup), create the 7 source files with principal imports/exports, and implement `GET /health` → 200 endpoint. Produces a runnable duel server skeleton verifiable in minutes.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
All critical decisions are made — thread isolation, message filtering, WebSocket protocol, frontend state flow, deployment strategy.

**Important Decisions (Shape Architecture):**
All important decisions made — data architecture, auth chain, protocol format, PvP state flow with animation coordination.

**Deferred Decisions (Post-MVP):**
- Duel replay storage (hors périmètre)
- WebSocket protocol versioning (single dev, single client)
- Structured JSON logging (console.log sufficient for MVP)
- Shared secret for internal API (Docker network sufficient for MVP, add if services separate)

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Duel state | In-memory (OCGCore WASM worker) | Technical constraint — OCGCore has no save/restore. State exists only in the live WASM instance. |
| Room/lobby data | PostgreSQL via Spring Boot | Existing infrastructure, persistence for free (page refresh safe) |
| Card data (duel server) | `cards.cdb` loaded at startup via `better-sqlite3` | Read-only, pre-loaded in memory for sync callbacks |
| Duel replay | Hors périmètre | Not MVP. If needed later: store `{seed, decks, playerResponses[]}` in PostgreSQL (~5-20KB/duel) |
| Room state machine | `WAITING → CREATING_DUEL → ACTIVE → ENDED` | Explicit states in Spring Boot. If `CREATING_DUEL` times out (5s), room reverts to `WAITING` with error message. Prevents players stuck in lobby on handoff failure. |

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Angular → Spring Boot | Existing JWT auth | No change to existing auth flow |
| Spring Boot → Duel Server (HTTP internal) | Docker network isolation (no auth) | Both services in same docker-compose network, port not exposed externally. KISS. Add shared secret if services separate later. |
| Angular → Duel Server (WebSocket) | One-shot JWT at handshake | Already decided in Step 2. JWT validated once at connection, no per-message re-validation. |
| JWT duration for PvP | Long-lived (≥ 2h) | Must cover full duel duration + reconnection window. Standard JWT may expire during a 60-min duel — PvP tokens need extended TTL. |
| Anti-cheat | Whitelist message filter, default DROP | Already decided in ADR-4. |
| WebSocket payload limit | `maxPayload: 4096` on WebSocketServer | SELECT_RESPONSE payloads are ~200 bytes max. 4KB cap prevents JSON payload DoS on the main thread. |
| Data volume | `data/` mounted read-only (`:ro`) | Duel server never writes to card data or scripts. Read-only mount eliminates tampering risk. |
| Response validation | Delegated to OCGCore | Invalid `SELECT_RESPONSE` triggers `MSG_RETRY` from the engine. No server-side pre-validation needed — OCGCore is the authority. |
| Transport encryption | WSS (TLS) via reverse proxy | Infra prerequisite. Reverse proxy (nginx/traefik) handles TLS termination in front of docker-compose. |
| SELECT_RESPONSE guard | Main thread ignores responses when no prompt pending | `awaitingResponse[playerId]` flag in session. Prevents spam and out-of-sequence responses. |

### API & Communication Patterns

**WebSocket Protocol:**

| Aspect | Decision |
|--------|----------|
| Message format | JSON with type discriminant: `{ "type": "MSG_DRAW", ...data }` |
| No envelope wrapper | No version, timestamp, or metadata wrapper — YAGNI for MVP |
| Server → Client | Game events (`MSG_*`), prompts (`SELECT_*`), state updates (`GAME_STATE`, `TIMER_STATE`), lifecycle (`DUEL_END`), session (`RPS_RESULT`, `OPPONENT_DISCONNECTED`, `OPPONENT_RECONNECTED`, `REMATCH_INVITATION`, `REMATCH_CANCELLED`, `WAITING`) |
| Client → Server | `SELECT_RESPONSE` (prompt answers), `SURRENDER`, `RPS_CHOICE`, `REMATCH_REQUEST`, `REMATCH_RESPONSE` |
| Heartbeat | Native `ws` ping/pong — no application-level heartbeat messages |
| Protocol versioning | None for MVP (single developer, single client) |
| Source of truth | `ws-protocol.ts` (duel server) is the canonical protocol definition. Angular `duel-ws.types.ts` is a manual copy. Server changes first, then client. |

**Internal HTTP API (Spring Boot → Duel Server):**

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/duels` | POST | Create duel (receives deck data from Spring Boot) |
| `/api/duels/:id/join` | POST | Player join notification |
| `/health` | GET | Health check (includes startup data integrity verification: cards.cdb readable, scripts directory non-empty) |
| `/status` | GET | Active duels count, memory usage |

### Frontend Architecture

**PvP State Flow — `DuelConnection` (data layer, scoped to DuelPageComponent):**

| Signal | Type | Purpose |
|--------|------|---------|
| `duelState` | `Signal<DuelState>` | Board state, LP, phase, turn, card positions |
| `pendingPrompt` | `Signal<Prompt \| null>` | Current SELECT_* awaiting player response |
| `hintContext` | `Signal<HintContext>` | Current MSG_HINT context (which effect is asking, what the prompt means) |
| `animationQueue` | `Signal<GameEvent[]>` | FIFO queue of events consumed by orchestrator |
| `timerState` | `Signal<TimerState \| null>` | Dedicated timer signal (player, remaining seconds) — decoupled from duelState |
| `connectionStatus` | `Signal<ConnectionStatus>` | `connected \| reconnecting \| lost \| resynchronized` (resynchronized auto-clears after 3s) |
| `activeChainLinks` | `Signal<ChainLinkState[]>` | Active chain links (pending entry mechanism — see below) |
| `chainPhase` | `Signal<'idle' \| 'building' \| 'resolving'>` | Chain lifecycle phase |
| `hasPendingChainEntry` | `Signal<boolean>` | True when a MSG_CHAINING is stored but not yet committed |

**Chain Phase Transition Timing:**
- `building` — set **immediately** when first `MSG_CHAINING` arrives (overlay needs this for entry animation)
- `resolving` — deferred to `applyChainSolving()` called by orchestrator (messages arrive in bursts, orchestrator processes sequentially with animation delays)
- `idle` — deferred to `applyChainEnd()` called by orchestrator (same reason)

**Animation Orchestration — `AnimationOrchestratorService` (component-scoped):**

Three-layer architecture: `DuelConnection` (data) → `AnimationOrchestratorService` (timing) → `PvpChainOverlayComponent` + `PvpBoardContainerComponent` (visuals).

The orchestrator dequeues `GameEvent` objects from `wsService.animationQueue` and controls when signal mutations happen. It returns a duration (ms), a `Promise<void>`, or `'async'` for each event — the queue pauses on `'async'` until the overlay or draw animation signals completion.

Key acceleration features: AC7 queue collapse (queue > 5 non-chain events → instantly apply all but last 3), AC8 speed multiplier (0.5× when activation toggle is Off). Full `prefers-reduced-motion` support.

> See [animation-architecture-pvp.md](./animation-architecture-pvp.md) for the complete signal reference, queue processing flow, all animation types, the masking system, chain resolution sequence diagram, and `PvpChainOverlayComponent` state machine.

**Prompt Display Coordination:**
```typescript
visiblePrompt = computed(() => {
  if (isAnimating() || chainEntryAnimating()) {
    // Exception: allow cost prompts through during building + pending chain
    if (chainPhase() === 'building' && hasPendingChainEntry()) return prompt;
    return null;
  }
  return prompt;
});
```
- Prompt display waits for animation queue to drain — prevents out-of-context popups during chain resolution
- `hintContext` always set before `pendingPrompt` — consumed by all prompt components for labeling
- No reuse of solo `BoardStateService` — PvP state flow is fundamentally different (server-pushed, read-only)
- Visual components shared (zones, cards, inspector) — only data source differs
- After 60s reconnection failure → "Duel interrompu" message + navigate to lobby

**Component Reuse (solo ↔ PvP):**
- `PlayerFieldComponent` extracted from solo board (18 zones). PvP composes two instances (own + opponent mirrored). Already decided in ADR-3.

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Duel server deployment | Docker container (multi-stage build) | Reproducible environment for WASM binary, native modules, Lua scripts, cards.cdb |
| Orchestration | `docker-compose` | Duel server + Spring Boot + PostgreSQL in single compose file |
| Service discovery | `DUEL_SERVER_URL=http://duel-server:3001` env var | Docker-compose networking resolves service names automatically |
| Internal API auth | Docker network isolation (no auth) | Services communicate on internal Docker network, duel server port not exposed externally |
| Card data & scripts | Docker volume mounted `:ro` | `./data:/app/data:ro` — update scripts by replacing files on host + `docker-compose restart duel-server` |
| Logging | `console.log/error` with levels (info/warn/error) | Captured natively by `docker logs`. Sufficient for MVP. |
| WebSocket port | Exposed via docker-compose port mapping + reverse proxy (WSS/TLS) | Only port exposed externally alongside Spring Boot |
| Startup validation | Health check verifies cards.cdb + scripts before accepting duels | Fail fast with clear error message rather than crash on first duel creation |

### Explicitly Out of Scope (MVP)

_These items are consciously deferred. They are NOT forgotten — each has a tier assignment for future implementation._

| Item | Tier | Rationale for deferral |
|------|------|----------------------|
| Duel replay storage | — | Hors périmètre. Deterministic replay possible later via `{seed, decks, responses[]}` |
| WebSocket protocol versioning | — | Single developer, single client. No backward compatibility needed. |
| Structured JSON logging | — | `console.log` + `docker logs` sufficient for friends-only scale |
| Shared secret (internal API auth) | T2 | Docker network isolation sufficient while services co-located |
| Bluff timer (anti timing side-channel) | T2 | Not needed between trusted friends |
| WebSocket rate limiter | T2 | Trusted players, no abuse expected |
| MSG_RETRY counter → auto-forfeit | T2 | Trust players to respond correctly |
| Reconnection limit (3 max / 60s cumulative) | T2 | Trust players not to abuse reconnection |
| Deck snapshot anti-race-condition | T2 | Trust players not to swap decks mid-matchmaking |
| Spectator mode | T3 | Requires viewerType enum, filtered message streams |
| AI opponent | T3 | Requires PlayerHandler interface abstraction |
| DuelEngine abstraction | T3 | YAGNI — only one engine (OCGCore) for the foreseeable future |
| State verification heartbeat | T3 | Redundant with OCGCore as sole authority |

### Decision Impact Analysis

**Protocol Gate — Critical Path:**

`ws-protocol.ts` (WebSocket DTO types) is the **gating item** for all parallel work. Once the protocol is frozen, server and client development can proceed independently.

**Implementation Dependency Graph:**

```
Phase 0 (Gate):
  [ws-protocol.ts] ◄── Define all message types + SELECT_RESPONSE format
        │
        ├──────────────────────────────┐
        ▼                              ▼
Phase 1A (Duel Server):          Phase 1B (Angular):
  [Docker + compose]               [DuelWebSocketService]
  [server.ts scaffold]             [duel-ws.types.ts copy]
  [duel-worker.ts]                 [connectionStatus handling]
  [message-filter.ts]
  [ocg-scripts.ts + callbacks]
        │                              │
        ▼                              ▼
Phase 2A (Integration):          Phase 2B (UI):
  [Internal HTTP API]               [Prompt components (7 types)]
  [Spring Boot endpoints]           [Animation queue]
  [Room state machine]              [Board display (PlayerField×2)]
        │                              │
        └──────────┬───────────────────┘
                   ▼
Phase 3 (End-to-end):
  [Full duel flow test]
  [Reconnection test]
  [Timer + forfeit test]
```

**Cross-Component Dependencies:**
- `ws-protocol.ts` must be defined before both server and client implementation (Phase 0 gate)
- Phase 1A and 1B are fully parallelizable after the gate
- Phase 2A requires Phase 1A complete; Phase 2B requires Phase 1B complete
- Phase 3 requires both Phase 2A and 2B complete
- Message filter depends on OCGCore message type definitions (available from research docs)
- Prompt components depend on `hintContext` + `pendingPrompt` signals (Phase 1B)
- Animation queue coordination must be in place before prompt display logic (Phase 2B internal dependency)

## Implementation Patterns & Consistency Rules

### Scope

These patterns cover **only the new duel server (Node.js)** and the **PvP-specific Angular code** (`pages/pvp/`). Existing Angular and Spring Boot conventions are already established in the brownfield codebase — agents follow existing code patterns for those areas.

### Naming Patterns

**Duel Server — Message Types:**
- All WebSocket message types: `SCREAMING_SNAKE_CASE` — e.g., `MSG_DRAW`, `SELECT_CARD`, `DUEL_END`
- Worker-to-main messages: `WORKER_` prefix — e.g., `WORKER_DUEL_CREATED`, `WORKER_MESSAGE`, `WORKER_ERROR`
- TypeScript: union discriminated types, not `type: string` — e.g., `type ServerMessage = MsgDraw | MsgMove | SelectCard | ...` with each variant as `{ type: 'MSG_DRAW'; ... }`

**Duel Server — Code:**
- Files: `kebab-case.ts` — e.g., `duel-worker.ts`, `message-filter.ts`
- Functions/variables: `camelCase` — e.g., `filterMessage()`, `awaitingResponse`
- Types/interfaces: `PascalCase` — e.g., `DuelSession`, `FilteredMessage`
- Constants: `SCREAMING_SNAKE_CASE` — e.g., `MAX_PAYLOAD_SIZE`, `RECONNECT_GRACE_MS`

**Angular PvP — Files:**
- Feature folder: `pages/pvp/` with `lobby/` and `duel/` sub-features
- Protocol types file: `duel-ws.types.ts` — manual copy of `ws-protocol.ts` (see same-commit rule below)

### Structure Patterns

**Angular PvP Feature Organization:**

```
pages/pvp/
├── lobby/                          # Room list, creation (+ deck picker), waiting room (polling)
├── duel-page/
│   ├── duel-page.component.ts         # Container (scopes services), manages duel result state, wires effects
│   ├── duel-connection.ts              # Data layer: WebSocket handling, 10 signals, pending chain entry, animationQueue
│   ├── animation-orchestrator.service.ts # Timing layer: dequeue loop, buffer/replay, async overlay contract, acceleration
│   ├── card-travel.service.ts          # NEW (PvP-C): floating elements, Web Animations API, zone rect resolution
│   ├── pvp-board-container/            # Board layout: 2× player fields, zone element registry, XYZ indicators
│   ├── pvp-chain-overlay/              # Visual layer: card cascade, resolve-exit, board pause
│   ├── pvp-lp-badge/                   # LP counter with rAF interpolation
│   └── prompts/                        # SELECT_* prompt components (3 types MVP)
│       ├── card-select-prompt.component.ts  # CARD, TRIBUTE, SUM, UNSELECT_CARD
│       ├── zone-select-prompt.component.ts  # PLACE, DISFIELD
│       └── choice-prompt.component.ts       # EFFECTYN, YESNO, POSITION, OPTION, CHAIN, RPS
└── duel-ws.types.ts                # Protocol DTOs (copy of ws-protocol.ts)
```

### Format Patterns

**Wire Format (WebSocket JSON):**
- All fields: `camelCase` — e.g., `{ "type": "MSG_DRAW", "playerId": 0, "cardCode": 12345 }`
- Absent optional values: explicit `null`, never field omission — e.g., `{ "type": "MSG_MOVE", "cardCode": null }` (not `{}` with field missing). Rationale: Angular `Signal<X | null>` requires explicit null for reactivity.
- TS unions → JSON strings: TypeScript `type: 'MSG_DRAW'` serializes as `{"type":"MSG_DRAW"}` on the wire. The union discriminant is a string literal in both TS and JSON — no transformation needed.

### Communication Patterns

**Protocol Invariant:**
`MSG_HINT` → `SELECT_*` → `SELECT_RESPONSE` — always in this order. A prompt without a preceding hint is a bug. The `hintContext` signal is set **before** `pendingPrompt`.

**Worker ↔ Main Thread Contract:**
- Worker → Main: `parentPort.postMessage({ type: 'WORKER_MESSAGE', payload })` — always typed, never raw strings
- Main → Worker: `worker.postMessage({ type: 'PLAYER_RESPONSE', playerId, data })` — same discipline

**Transformation Chain:**
```
OCGCore binary → [duel-worker.ts: transform] → DTO → [message-filter.ts: filter] → [server.ts: ws.send()]
```
Each step has a single owner file. No file bypasses the chain.

### Animation Patterns

**Three-Layer Separation:**
- `DuelConnection`: enqueues `GameEvent` objects, manages `activeChainLinks` + `chainPhase` signals, handles pending chain entry commit logic. Never triggers visual animations directly.
- `AnimationOrchestratorService`: sole owner of animation timing. Dequeues events, calls `DuelConnection.applyChain*()` mutations at the right moment, controls `animatingZone`/`animatingLpPlayer` signals, manages buffer/replay during chain resolution, coordinates with overlay via `chainOverlayReady`.
- Visual components (`PvpChainOverlayComponent`, `PvpBoardContainerComponent`, `PvpLpBadgeComponent`): react to signals only. Never dequeue or mutate game state.

**Async Overlay Contract:**
```
Orchestrator: chainOverlayReady = true (initial)
MSG_CHAIN_SOLVED → orchestrator pauses, returns 'async'
  → Overlay: chainOverlayReady = false
  → Overlay plays exit animation + board pause
  → Overlay: chainOverlayReady = true
  → Orchestrator resume effect detects ready → resumes queue
```
The overlay NEVER calls orchestrator methods — except `replayBufferedEvents()` which the overlay invokes during the board-pause window to trigger travel animations on the visible board. All other communication is unidirectional via signals.

**Buffer & Replay (PvP-C):**
- When `_insideChainResolution = true`, board-changing events (`MSG_MOVE`, `MSG_FLIP_SUMMONING`, `MSG_CHANGE_POS`, `MSG_DAMAGE`, `MSG_RECOVER`, `MSG_PAY_LPCOST`) are pushed to `_bufferedBoardEvents[]` instead of processed.
- On `MSG_CHAIN_SOLVED`, the overlay calls `replayBufferedEvents()` during the board-pause window (after fade-out).
- Replay executes in two sequential beats (each internally parallel):
  - Beat 1 (zones): all `CardTravelService.travel()` calls fire simultaneously with 50ms stagger
  - Beat 2 (LP): all LP interpolations fire simultaneously
- Board pause duration = `max(Beat 1 durations) + (count-1) × stagger + Beat 2 duration` (dynamic, not fixed)
- If no board-changing events buffered, skip pause entirely (same as current `chainOverlayBoardChanged = false` behavior)

**Card Travel (PvP-C):**
- Replaces in-place glow effects for summon/destroy events. `pvp-summon-flash` and `pvp-destroy-flash` CSS keyframes are removed.
- Travel animation phases: Lift (0-15%: `scale(1.15)`, shadow expand, departure glow) → Travel (15-75%: `position: fixed` translate, `rotateY(8deg)`, `ease-in-out`) → Land (75-100%: micro-bounce `1.15→1.05→1`, impact glow pulse)
- `pvp-flip-flash` and `pvp-activate-flash` remain unchanged (in-place by nature)
- Token destruction: dissolve in-place (fade + scale down), no travel — tokens don't go to GY

**Event-Specific Travel Behavior:**

| Event | Source → Destination | Details |
|-------|---------------------|---------|
| MSG_MOVE summon | Hand/Deck/Extra → MZ/SZ | Face visible on arrival, green impact glow |
| MSG_MOVE destroy | MZ/SZ → GY/Banished | Card flips to back during travel, red departure glow |
| MSG_MOVE bounce | MZ/SZ → Hand | No destructive glow, softer travel arc |
| MSG_MOVE return to deck | MZ/SZ → Deck | Card flips to back, deck pulses on arrival |
| MSG_MOVE field-to-field | MZ → MZ, SZ → SZ | Direct travel, neutral glow |
| MSG_DRAW | Deck → Hand | Card back visible during travel (promoted from no-op) |
| MSG_SHUFFLE_HAND | Deck zone in-place | Fan-out/fan-in pseudo-elements (~250ms) |
| XYZ material detach | XYZ parent → GY | Slide-out from stacked indicator, then standard travel |

**Stagger for Parallel Travels:**
- ~50ms stagger between each card's departure (e.g., Raigeki → 5 destroys)
- Slight position offsets at destination prevent visual overlap
- Total: `max(travel duration) + (count-1) × 50ms`

**XYZ Material Visual Enhancement (PvP-C):**
- Resting state: 2-3 stacked card-back indicators beneath XYZ monster (pseudo-elements, max 3 visible layers)
- Detach: one indicator slides out → standard travel to GY → badge count updates
- `.emz-slot` overflow changed from `hidden` to `visible` (prevents clipping on EMZ-positioned XYZ monsters)

**LP Tracking:**
- Orchestrator maintains private `trackedLp: [player, opponent]` — synced to board state when queue is empty
- `animatingLpPlayer` signal carries interpolation metadata (`fromLp`, `toLp`, `durationMs`)
- `PvpLpBadgeComponent` uses `requestAnimationFrame` for smooth counter interpolation

**Acceleration Features:**
- AC5 (auto-resolve): ≥3 chain links solved without user prompt → `chainAccelerated = true` → halve all animation durations. Overlay buffers announcements, announces "Chain of N links resolved" on chain end.
- AC7 (queue collapse): > 5 queued events → instantly apply all but last 3 (LP tracking updated, no visual animation). Skip collapse if chain resolution events present in queue.
- AC8 (speed multiplier): activation toggle `off` → `speedMultiplier = 0.5` applied to all `setTimeout` durations in orchestrator. Card travel minimum floor: 200ms even after multiplier.

**Timing & Duration Reference:**

| Animation | Normal | Accelerated (AC5/3+ chain) | Reduced Motion |
|-----------|--------|----------------------------|----------------|
| Card travel (Lift→Travel→Land) | 400ms | 250ms (min 200ms floor) | Instant (no travel) |
| Stagger between parallel cards | 50ms | 30ms | 0ms |
| LP counter interpolation | CSS `--pvp-transition-lp-counter` | Same × speed multiplier | 0ms |
| Chain overlay pulse glow | 600ms | 300ms | 300ms |
| Chain overlay exit | 600ms | 300ms | 300ms |
| Chain overlay board pause | Dynamic (from buffer) | Same × speed multiplier | 0ms |
| Deck shuffle (fan-out/fan-in) | 250ms | 150ms | Instant |
| XYZ detach slide-out | 200ms | 120ms | Instant |
| MSG_CHAINING activate glow | 1400ms | 700ms | 700ms |

**Accessibility (`prefers-reduced-motion: reduce`):**
- All CSS animation tokens set to `0ms`
- Card travel: no floating element, card appears/disappears instantly
- Board pause during chain: duration = 0ms
- LP interpolation: snap to final value
- Screen reader announcements unchanged (semantic, not visual)

### Process Patterns

**Error Handling:**
- `duel-worker.ts`: `try/catch` around `duelProcess()` + 30s watchdog. On error → `WORKER_ERROR` message to main thread
- `server.ts`: On `WORKER_ERROR` → notify both players, close duel, cleanup
- `message-filter.ts`: Pure functions, no error handling needed (stateless). Unknown message type → `null` (DROP + log)
- Angular `DuelWebSocketService`: WebSocket `onerror`/`onclose` → update `connectionStatus` signal, attempt reconnection

**Loading States:**
- Angular lobby: standard loading spinner during room fetch/creation
- Angular duel: `connectionStatus` signal drives the UI (`connected | reconnecting | lost | resynchronized`)
- No global loading state — each context manages its own

**Logging (MVP):**
- `console.error()` for errors (worker crash, WebSocket failure, data integrity)
- `console.log()` for info (duel created, player joined, duel ended)
- No prescribed format — `docker logs` captures everything. Structured logging deferred to T2.

### Enforcement Checklist

**All AI Agents MUST:**

1. Use `SCREAMING_SNAKE_CASE` for all message type constants (server and client)
2. Use union discriminated types for message definitions — never `type: string`
3. Use explicit `null` for absent values — never omit the field
4. Respect the transformation chain: OCGCore → worker transform → DTO → filter → WebSocket send
5. Keep `server.ts` as the sole WebSocket owner — no other file calls `ws.send()`
6. Update `duel-ws.types.ts` in the **same commit** as any `ws-protocol.ts` change
7. Follow the MSG_HINT → SELECT_* → SELECT_RESPONSE invariant order
8. Route all worker communication through typed `postMessage` — never shared memory or global state
9. Keep `ws-protocol.ts` self-contained — zero internal imports (it is copied to Angular, cannot depend on server internals)
10. Never mutate game state from visual components — only `DuelConnection` mutates chain/board state, only `AnimationOrchestratorService` controls timing
11. Overlay ↔ orchestrator communication is unidirectional via signals — overlay NEVER calls orchestrator methods except `replayBufferedEvents()` (board-pause replay trigger)
12. Card travel minimum duration floor: 200ms after speed multiplier — below this threshold travel is imperceptible
13. All card travel floating elements MUST be cleaned up on animation completion — leaked DOM elements accumulate and degrade performance
14. Buffer & replay ONLY during chain resolution (`_insideChainResolution = true`) — normal gameplay events process immediately
15. Beat ordering is fixed: Beat 1 (zone travels) completes before Beat 2 (LP) starts — LP changes must appear after the card movement that caused them

**Cross-Reference:** `duel-ws.types.ts` (Angular) is the client-side counterpart of `ws-protocol.ts` (duel server). These two files define opposite ends of the same protocol boundary (ADR-2). The server file is the source of truth.

### Critical Anti-Patterns

1. **Shared mutable state between main thread and worker** — use `postMessage` only. Shared memory = race conditions.
2. **Sending `ws.send()` from `message-filter.ts` or `duel-worker.ts`** — only `server.ts` owns the WebSocket connection.
3. **Omitting `null` and relying on `undefined`/missing field** — Angular signals break on `undefined` vs `null` mismatch.
4. **Hardcoding message type strings** — always reference the union type. Typos in strings are silent bugs.
5. **Processing board events immediately during chain resolution** — events between `MSG_CHAIN_SOLVING` and `MSG_CHAIN_SOLVED` must be buffered, not processed. Immediate processing causes animations to play behind the overlay (invisible to user).
6. **Using fixed board pause duration during chain replay** — pause must be dynamic, calculated from buffered event replay durations. Fixed duration causes desync between animation completion and overlay return.
7. **Leaking floating card elements** — every `CardTravelService.travel()` call must remove its floating element on completion or interruption. Use `finally` or `animation.onfinish`.

## Project Structure & Boundaries

_This section documents only PvP additions (delta) to the existing brownfield project. Existing Angular and Spring Boot structure is already established._

### Duel Server — Complete Project Structure (new)

```
duel-server/
├── package.json                  # Dependencies: @n1xx1/ocgcore-wasm, ws, better-sqlite3, patch-package
├── tsconfig.json                 # TypeScript strict, ESM, outDir: dist/
├── patches/                      # patch-package: @n1xx1+ocgcore-wasm ESM fix (existing)
├── Dockerfile                    # Multi-stage build (Node 22 LTS), npm ci in runtime stage
├── data/                         # Mounted :ro via docker-compose volume
│   ├── cards.cdb                 # ProjectIgnis/BabelCDB (7.2MB SQLite)
│   └── scripts/                  # ProjectIgnis/CardScripts (~13,000+ Lua files)
│       └── official/
└── src/
    ├── server.ts                 # Main thread: ws.WebSocketServer + node:http, session routing, worker lifecycle
    ├── duel-worker.ts            # Worker thread entry: OCGCore WASM, duel loop, parentPort.postMessage
    ├── message-filter.ts         # Pure functions: (message, playerId) → filteredMessage | null
    ├── ws-protocol.ts            # Protocol boundary: all WebSocket DTO types (SOURCE OF TRUTH, zero internal imports)
    ├── types.ts                  # Internal: worker message types, session state, constants
    ├── ocg-callbacks.ts          # cardReader + scriptReader sync callbacks (receives CardDB via injection)
    ├── ocg-scripts.ts            # loadDatabase(dbPath): CardDB, loadScripts(scriptDir): ScriptDB
    ├── poc-duel.ts               # PoC reference (not imported by production code)
    └── test-core.ts              # PoC reference (not imported by production code)
```

**Build & Run:**
- Development: `tsx src/server.ts` (fast iteration, no build step)
- Production: `tsc` → `dist/` → `node dist/server.js` (Dockerfile entrypoint)
- Worker path: `new Worker(new URL('./duel-worker.js', import.meta.url))` — resolves correctly in both dev (`tsx`) and prod (`dist/`)

**Critical Dependency Notes:**
- `patch-package` must be a **dependency** (not devDependency) — `postinstall` script must execute in Docker build
- `better-sqlite3` is a native module (C++) — Dockerfile must `npm ci` in the **same image** as runtime to avoid binary incompatibility
- Startup health check validates `cards.cdb` readable + `scripts/` non-empty before accepting connections

### Angular SPA — PvP Additions (delta only)

```
front/src/app/
├── pages/
│   ├── simulator/                        # EXISTING — solo simulator
│   │   └── board.component.ts            # MODIFY: extract PlayerFieldComponent
│   │
│   └── pvp/                              # NEW — PvP feature (lazy-loaded)
│       ├── lobby/                        # Room list, creation, waiting room
│       │   ├── lobby-page.component.ts
│       │   ├── room-list.component.ts
│       │   ├── room-create.component.ts  # Includes deck picker (select from user's decks)
│       │   └── waiting-room.component.ts # Polls GET /api/rooms/:id for opponent join status
│       │
│       ├── duel-page/
│       │   ├── duel-page.component.ts         # Container (scopes services), manages duel result state, wires effects
│       │   ├── duel-connection.ts              # Data layer: WebSocket handling, 10 signals, pending chain entry, animationQueue
│       │   ├── animation-orchestrator.service.ts # Timing layer: dequeue loop, buffer/replay, async overlay contract, acceleration
│       │   ├── card-travel.service.ts          # NEW (PvP-C): floating elements, Web Animations API, zone rect resolution
│       │   ├── pvp-board-container/            # Board layout: 2× player fields, zone element registry, XYZ indicators
│       │   │   ├── pvp-board-container.component.ts
│       │   │   ├── pvp-board-container.component.html
│       │   │   └── pvp-board-container.component.scss  # Zone animations, travel anchor styles, XYZ stacked indicators
│       │   ├── pvp-chain-overlay/              # Visual layer: card cascade, resolve-exit, board pause
│       │   │   ├── pvp-chain-overlay.component.ts
│       │   │   ├── pvp-chain-overlay.component.html
│       │   │   └── pvp-chain-overlay.component.scss    # Chain card positions, entry/exit/resolve animations
│       │   ├── pvp-lp-badge/                   # LP counter with rAF interpolation
│       │   │   └── pvp-lp-badge.component.ts
│       │   └── prompts/                        # SELECT_* prompt components (3 types MVP)
│       │       ├── card-select-prompt.component.ts  # CARD, TRIBUTE, SUM, UNSELECT_CARD
│       │       ├── zone-select-prompt.component.ts  # PLACE, DISFIELD
│       │       └── choice-prompt.component.ts       # EFFECTYN, YESNO, POSITION, OPTION, CHAIN, RPS
│       │
│       └── duel-ws.types.ts              # Protocol DTOs (manual copy of ws-protocol.ts, same-commit rule)
│
├── components/                           # SHARED — existing
│   └── player-field/                     # NEW — extracted from simulator board.component
│       └── player-field.component.ts     # 18 zones layout, reusable by solo + PvP
│
├── core/
│   ├── model/
│   │   └── pvp/                          # NEW — PvP domain models
│   │       ├── room.ts                   # Room, RoomStatus (WAITING | CREATING_DUEL | ACTIVE | ENDED)
│   │       └── duel-state.ts             # DuelState, Prompt, HintContext, TimerState, ConnectionStatus
│   │
│   └── services/
│       └── room.service.ts               # NEW — REST client for room CRUD + pollRoomStatus(roomId): Observable
│
└── app.routes.ts                         # MODIFY: add lazy-loaded PvP routes
```

**Route additions (`app.routes.ts`):**

| Route | Component | Loading | Guard |
|-------|-----------|---------|-------|
| `/pvp` | `LobbyPageComponent` | Lazy (`loadComponent`) | Auth |
| `/pvp/duel/:roomId` | `DuelPageComponent` | Lazy (`loadComponent`) | Auth |

**Prerequisite Refactoring (Story 0):**
- Extract `PlayerFieldComponent` from `board.component.ts` (solo simulator) into `components/player-field/`
- This modifies existing working code — must be its own story with AC: "solo simulator functions identically after extraction"
- Solo `simulator-page.component.ts` uses `PlayerFieldComponent` directly (1 instance)
- PvP `pvp-board.component.ts` composes 2 instances (own + opponent mirrored)

**Configuration additions:**
- `environment.ts`: add `wsUrl` for duel server WebSocket (`ws://localhost:3001` dev, `wss://domain/ws` prod)

### Spring Boot — PvP Additions (delta only)

```
back/src/main/java/com/skytrix/
├── controller/
│   └── RoomController.java               # NEW — /api/rooms CRUD + join/leave/end
│
├── service/
│   ├── RoomService.java                   # NEW — room lifecycle, state machine
│   └── DuelServerClient.java             # NEW — HTTP client to duel-server
│
├── model/
│   ├── entity/
│   │   └── Room.java                      # NEW — JPA entity (id, player1, player2, status, duelServerId, timestamps)
│   ├── dto/
│   │   └── room/                          # NEW — Room DTOs
│   │       ├── CreateRoomDTO.java
│   │       ├── RoomDTO.java               # Includes wsUrl + duelId after duel creation
│   │       └── RoomStatusDTO.java
│   └── enums/
│       └── RoomStatus.java                # NEW — WAITING, CREATING_DUEL, ACTIVE, ENDED
│
├── repository/
│   └── RoomRepository.java               # NEW — JPA repository
│
├── mapper/
│   └── RoomMapper.java                    # NEW — Room entity ↔ DTOs
│
├── security/
│   └── SecurityConfig.java                # MODIFY — add /api/rooms/** to authenticated routes
│
└── src/main/resources/
    ├── application.properties             # MODIFY — add duel-server.url=${DUEL_SERVER_URL:http://localhost:3001}
    └── db/
        └── V{n}__create_room_table.sql    # NEW — Flyway migration for Room table
```

**REST endpoints (`RoomController`):**

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/rooms` | POST | Create room |
| `/api/rooms` | GET | List open rooms |
| `/api/rooms/:id` | GET | Room details (used by waiting room polling) |
| `/api/rooms/:id/join` | POST | Join room — triggers duel creation, returns `wsUrl` + `duelId` |
| `/api/rooms/:id/leave` | POST | Leave room |
| `/api/rooms/:id/end` | POST | Mark room as ENDED (called by Angular after receiving `DUEL_END`) |

**`DuelServerClient` — Internal HTTP client (Spring Boot → Duel Server):**

| Call | Target | Purpose |
|------|--------|---------|
| `POST /api/duels` | `duel-server:3001` | Create duel (sends both decklists) |
| `POST /api/duels/:id/join` | `duel-server:3001` | Notify player WebSocket ready |
| `GET /health` | `duel-server:3001` | Health check |

**Note:** `GET /status` (active duels count, memory usage) is exposed by the duel server for ops/monitoring but not consumed by Spring Boot.

### Infrastructure — Additions

```
skytrix/                                   # Project root
├── docker-compose.yml                     # MODIFY — add duel-server service
└── duel-server/
    └── Dockerfile                         # NEW — multi-stage Node 22 build
```

**docker-compose additions:**

```yaml
duel-server:
  build: ./duel-server
  volumes:
    - ./duel-server/data:/app/data:ro
  environment:
    - PORT=3001
  networks:
    - skytrix-internal
  # Port NOT exposed externally — Angular connects via reverse proxy

spring-boot:
  environment:
    - DUEL_SERVER_URL=http://duel-server:3001  # NEW env var
```

### Architectural Boundaries

```
┌─────────────┐     REST/JWT      ┌──────────────┐    HTTP internal     ┌──────────────┐
│  Angular     │◄────────────────►│  Spring Boot  │◄──────────────────►│  Duel Server  │
│  SPA         │                  │               │  (Docker network)   │  (Node.js)    │
│              │     WebSocket    │               │                     │               │
│              │◄─────────────────┼───────────────┼─────────────────────┤               │
│              │  (JWT handshake) │               │                     │               │
└─────────────┘                  └──────────────┘                     └──────────────┘
```

| Boundary | Owner | Consumer | Contract |
|----------|-------|----------|----------|
| WebSocket protocol | `ws-protocol.ts` (duel server) | `duel-ws.types.ts` (Angular) | Same-commit update, zero internal imports |
| Internal HTTP API | Duel server (`server.ts`) | `DuelServerClient.java` (Spring Boot) | 4 routes, JSON, Docker network auth |
| REST API (rooms) | `RoomController.java` | Angular `room.service.ts` | Standard REST + JWT |
| Worker thread | `server.ts` | `duel-worker.ts` | Typed `postMessage` |
| Message filter | `message-filter.ts` | Called by `server.ts` | Pure function `(msg, playerId) → msg | null` |
| Duel end notification | Angular receives `DUEL_END` | `POST /api/rooms/:id/end` → Spring Boot | Client-mediated (KISS, avoids duel server → Spring Boot callback) |
| WebSocket URL handoff | Spring Boot `POST /api/rooms/:id/join` response | Angular `waiting-room` → `duel-page` | Response includes `wsUrl` + `duelId` |

### FR → Structure Mapping

| FR Category | Primary Files |
|-------------|---------------|
| FR1-7: Matchmaking & Sessions | `RoomController.java`, `RoomService.java`, `Room.java`, `lobby-page.component.ts`, `room.service.ts`, `waiting-room.component.ts` |
| FR8-10: Turn & Phase Management | `duel-worker.ts` (OCGCore delegation), `duel-page.component.ts` |
| FR11-13: Player Prompts | `prompts/*.component.ts` (3 types), `duel-connection.ts` (hintContext + pendingPrompt) |
| FR14-24: Board Display & Info | `pvp-board-container.component.ts`, `player-field.component.ts`, `duel-connection.ts` (animationQueue), `animation-orchestrator.service.ts`, `card-travel.service.ts` (PvP-C), `pvp-chain-overlay.component.ts`, `pvp-lp-badge.component.ts` |
| NFR1-2: Network & Latency | `server.ts` (WebSocket), `duel-websocket.service.ts` (connectionStatus) |
| NFR4-5: Reconnection | `server.ts` (grace period), `duel-websocket.service.ts` (resynchronized) |
| NFR6-8: Security | `message-filter.ts`, `SecurityConfig.java`, `server.ts` (maxPayload, awaitingResponse) |

### Implementation Notes

**Story 0 Prerequisite:** Extract `PlayerFieldComponent` before any PvP board work. Solo simulator must pass smoke test after extraction.

**Waiting Room Mechanism:** `waiting-room.component.ts` polls `GET /api/rooms/:id` every 2-3s to detect opponent join. Polling is KISS for MVP between friends. SSE or dedicated WebSocket deferred to T2 if needed.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All 10 architectural decisions work together without conflicts. Comparative Analysis Matrix (AE method) scored each ADR against 6 weighted criteria (Security ×3, Reliability ×3, Performance ×2, KISS ×3, DX ×2, Maintainability ×1). All decisions scored optimal or near-optimal for the MVP scope. No alternative would produce a higher weighted score.

Key compatibility confirmations:
- `ws` + `node:http` + worker threads: all native Node.js, no framework conflicts
- Independent DTOs + same-commit update rule: clean boundary without shared package overhead
- Docker network isolation + `maxPayload: 4096` + whitelist filter: layered security without redundancy
- Polling (waiting room) + WebSocket (duel) + REST (lobby CRUD): each communication pattern matched to its use case

**Pattern Consistency:**
- All message types use `SCREAMING_SNAKE_CASE` consistently (server and client)
- All files use `kebab-case.ts` naming
- Union discriminated types used throughout (never `type: string`)
- Explicit `null` for absent values enforced across wire format and Angular signals
- 15 enforcement rules documented and cross-referenced

**Structure Alignment:**
- Duel server: 9 source files with clear single-responsibility boundaries
- Angular delta: `pages/pvp/` follows existing `pages/` convention (corrected during Step 6 AE)
- Spring Boot delta: follows existing `controller/service/model/repository` structure
- Infrastructure: `docker-compose.yml` extension with volume mounts and network isolation

### Requirements Coverage Validation ✅

**Functional Requirements Coverage (25/25):**

| FR | Architectural Support | Primary Files |
|----|----------------------|---------------|
| FR1 (Room creation) | Spring Boot REST + Angular lobby | `RoomController.java`, `lobby-page.component.ts` |
| FR2 (Deck validation) | Spring Boot validates before room entry | `RoomService.java` |
| FR3 (Browse/join rooms) | REST API + lobby page | `RoomController.java`, `room-list.component.ts` |
| FR4 (Auto-start) | Spring Boot triggers duel creation on join | `RoomService.java`, `DuelServerClient.java` |
| FR5 (Surrender) | WebSocket `SURRENDER` message type | `ws-protocol.ts`, `server.ts` |
| FR6 (Disconnection) | 60s grace period, snapshot reconnection | `server.ts` (session mgmt), `duel-websocket.service.ts` |
| FR7 (Win/draw) | OCGCore `DUEL_END` + client-mediated room update | `duel-worker.ts`, `POST /api/rooms/:id/end` |
| FR8 (Turn structure) | Delegated to OCGCore | `duel-worker.ts` |
| FR9 (Main Phase actions) | `SELECT_IDLECMD` → distributed UI: cards glow, tap opens inline action menu | `pvp-board-container.component.ts`, card action menu (inline template) |
| FR10 (Battle Phase actions) | `SELECT_BATTLECMD` → distributed UI: attackable monsters glow, tap opens attack target menu | `pvp-board-container.component.ts`, card action menu (inline template) |
| FR11 (Player prompts) | 3 prompt components covering SELECT_YESNO, SELECT_CARD, SELECT_PLACE, etc. | `prompts/*.component.ts` |
| FR12 (Chain delegation) | OCGCore resolves chains automatically | `duel-worker.ts` |
| FR13 (Rule enforcement) | OCGCore is sole authority | `duel-worker.ts` + `message-filter.ts` |
| FR14 (Two-player display) | `PlayerFieldComponent` ×2 (own + mirrored) | `pvp-board.component.ts`, `player-field.component.ts` |
| FR15 (Private info hiding) | Whitelist filter + default DROP | `message-filter.ts` |
| FR16 (LP display) | `duelState` signal includes LP | `duel-websocket.service.ts` |
| FR17 (Chain visualization) | Three-layer animation architecture + async overlay contract | `animation-orchestrator.service.ts`, `pvp-chain-overlay.component.ts`, `duel-connection.ts` |
| FR18 (Card inspection) | Reuse existing card inspector | Shared `components/` |
| FR19 (Turn indicator) | `duelState` signal includes phase/turn | `duel-page.component.ts` |
| FR20 (Turn timer) | `timerState` signal, server-authoritative | `server.ts`, `duel-websocket.service.ts` |
| FR21 (Inactivity timeout) | Server-side 100s watchdog | `server.ts` |
| FR22 (Visual feedback) | Card travel animations (PvP-C) + buffer/replay during chain + LP interpolation | `animation-orchestrator.service.ts`, `card-travel.service.ts`, `pvp-board-container.component.ts`, `pvp-lp-badge.component.ts` |
| FR23 (Click-based interaction) | Prompt components (not drag & drop) | `prompts/*.component.ts` |
| FR24 (Duel result screen) | Duel result state in `duel-page.component.ts` | `duel-page.component.ts` |
| FR25 (Activation toggle) | Client-side filter (Auto/On/Off) on optional prompts, per-duel state | `pvp-activation-toggle.component.ts`, `duel-websocket.service.ts` |

**Non-Functional Requirements Coverage (10/10):**

| NFR | Architectural Support |
|-----|----------------------|
| NFR1 (< 500ms round-trip) | WebSocket direct connection, OCGCore < 10ms processing, worker thread isolation prevents blocking |
| NFR2 (Stable WebSocket) | Native `ws` ping/pong, `connectionStatus` signal, reconnection handling |
| NFR3 (50 concurrent duels) | Worker thread per duel, ~2MB WASM per instance, main thread remains responsive |
| NFR4 (60s reconnection) | Session state in `server.ts`, snapshot via `duelQueryField` + `duelQuery` |
| NFR5 (4h state preservation) | Worker keeps running while both disconnected, 4h cleanup timer |
| NFR6 (Server authority) | OCGCore in worker thread, whitelist filter, default DROP policy |
| NFR7 (Response validation) | OCGCore validates all responses (`MSG_RETRY` on invalid), `awaitingResponse` guard |
| NFR8 (JWT protection) | One-shot JWT at WebSocket handshake, Spring Boot JWT for REST routes |
| NFR9 (Browser compatibility) | Angular 19 (modern browsers), landscape lock for mobile |
| NFR10 (AGPL-3.0) | Duel server source code published (LICENSE file required) |

### Implementation Readiness Validation ✅

**Decision Completeness:**
- All critical decisions documented with specific library versions (`ws`, `better-sqlite3`, `@n1xx1/ocgcore-wasm` 0.1.1, Node.js 22+ LTS, TypeScript 5.9)
- 15 enforcement rules provide clear, verifiable constraints for AI agents (9 original + 6 animation-specific)
- Transformation chain documented: OCGCore → worker → DTO → filter → WebSocket
- Protocol boundary clearly defined (ADR-2): `ws-protocol.ts` = source of truth, zero internal imports

**Structure Completeness:**
- Duel server: complete file tree (9 source files + Dockerfile + data/)
- Angular delta: complete tree with file-level annotations
- Spring Boot delta: complete tree with endpoint mapping
- Infrastructure: docker-compose additions specified

**Pattern Completeness:**
- Naming conventions: 4 categories (message types, code, files, Angular)
- Communication patterns: protocol invariant, worker contract, transformation chain
- Process patterns: error handling per file, loading states, logging
- Anti-patterns: 7 critical anti-patterns documented (4 original + 3 animation-specific)

**Implementation Notes (Party Mode):**

1. **Message filter whitelist exhaustiveness:** The architecture defines the default DROP policy and key sanitization rules (§Story-Level Notes: MSG_DRAW, MSG_SHUFFLE_HAND, MSG_MOVE, MSG_HINT, MSG_CONFIRM_CARDS). The exhaustive whitelist per MSG_* type (~80+ types) is an implementation-time deliverable, informed by OCGCore message documentation and NEOS/SRVPro reference implementations.

2. **PvP-A0 scope staging:** The Step 6 project tree shows the **final structure** (all 4 prompt components covering all SELECT_* types). PvP-A0 (first testable increment) implements only the most frequent types (IDLECMD, BATTLECMD, CARD, CHAIN, EFFECTYN, PLACE, POSITION) within these same 4 component files. Other types fallback to auto-select. This is scope staging, not a structural change.

3. **Reconnection testability:** Architecture supports reconnection testing at the protocol level. `server.ts` manages session state (grace period, `awaitingResponse`) independently of WebSocket lifecycle. Test scenarios: (a) disconnect + reconnect within 60s → snapshot sent, (b) disconnect + reconnect after 60s → duel forfeited, (c) both disconnect → worker persists up to 4h.

### Gap Analysis Results

**Minor Gaps (non-blocking):**

| Gap | Status | Resolution |
|-----|--------|------------|
| Route naming (`/pvp` vs PRD's `/lobby`) | Documented | Architecture uses `/pvp` (lobby) + `/pvp/duel/:roomId`. PRD's `/lobby` was pre-architecture. Architecture takes precedence. |
| Chain visualization component location | Documented | Not a separate component — chain events flow through `animationQueue` signal in `duel-websocket.service.ts`. Visual rendering handled by existing board zone components. |
| LICENSE file (AGPL-3.0) for duel server | Noted | Must be added to `duel-server/` root. One-time task during scaffold story. |

**Required Deliverables (upgraded from nice-to-have per user request):**

| Deliverable | Purpose | When |
|-------------|---------|------|
| Dev setup guide | Local development environment setup (Node.js, Docker, data files, patch-package) | Required before deployment |
| Deployment runbook | Production deployment steps (docker-compose, reverse proxy, TLS, data volume) | Required before deployment |

**Architectural Debt (accepted, tiered):**

| Item | Tier | Maintainability Score | Migration Path |
|------|------|:---:|----------------|
| Docker network auth (no shared secret) | T2 | 2/5 | Add shared secret when services separate physically |
| Client-mediated duel end | T2 | 2/5 | Add server callback when spectators or replay added |

### Architecture Completeness Checklist

**✅ Requirements Analysis**

- [x] Project context thoroughly analyzed (tri-service architecture, 25 FRs, 10 NFRs)
- [x] Scale and complexity assessed (~20-25 components, high complexity)
- [x] Technical constraints identified (OCGCore sync mode, ESM patch, anti-cheat)
- [x] Cross-cutting concerns mapped (8 concerns documented in Step 1)

**✅ Architectural Decisions**

- [x] Critical decisions documented with versions (10 ADRs, all scored via Comparative Analysis Matrix)
- [x] Technology stack fully specified (ws, node:http, better-sqlite3, ocgcore-wasm 0.1.1)
- [x] Integration patterns defined (WebSocket, HTTP internal, REST, worker postMessage)
- [x] Performance considerations addressed (worker isolation, < 500ms target, 50 concurrent duels)

**✅ Implementation Patterns**

- [x] Naming conventions established (4 categories: message types, code, files, Angular)
- [x] Structure patterns defined (complete file trees for all 3 services)
- [x] Communication patterns specified (protocol invariant, transformation chain, worker contract)
- [x] Process patterns documented (error handling, loading states, logging)
- [x] Animation patterns documented (three-layer separation, async overlay contract, buffer/replay, card travel, Beat grouping, acceleration, timing reference, accessibility)

**✅ Project Structure**

- [x] Complete directory structure defined (duel server + Angular delta + Spring Boot delta + infrastructure)
- [x] Component boundaries established (7 boundary contracts in table)
- [x] Integration points mapped (architectural boundaries diagram)
- [x] Requirements to structure mapping complete (FR → files table)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** HIGH — based on:
- 10/10 ADRs validated by Comparative Analysis Matrix (all optimal for MVP scope)
- 25/25 FRs architecturally supported with file-level mapping
- 10/10 NFRs addressed with specific mechanisms
- PoC validates core technical risk (OCGCore WASM duel loop)
- 15 enforcement rules provide clear AI agent constraints
- 3 Party Mode clarifications address implementation ambiguities

**Key Strengths:**
- Clean protocol boundary (ADR-2) enables parallel server/client development
- Whitelist + default DROP policy (ADR-4) is fail-safe for anti-cheat
- Worker thread isolation (ADR-1) provides total fault isolation between duels
- Scope tiering (T1/T2/T3) separates MVP from future work clearly
- Dependency graph (Phase 0 → 3) provides clear implementation ordering

**Areas for Future Enhancement:**
- T2: Shared secret for internal API auth, server callback for duel end, rate limiting, reconnection limits
- T3: Spectator mode, AI opponent, DuelEngine abstraction
- Message filter whitelist will need ongoing maintenance as OCGCore message types evolve

### Implementation Handoff

**AI Agent Guidelines:**

- Follow all 15 enforcement rules exactly as documented in §Implementation Patterns
- Use the dependency graph (Phase 0 → 1A/1B → 2A/2B → 3) for implementation ordering
- Respect the 7 critical anti-patterns (no shared mutable state, no ws.send outside server.ts, explicit null, no hardcoded type strings, no immediate board events during chain, no fixed board pause, no leaked floating elements)
- Refer to FR → Structure mapping for file-level implementation targets
- PvP-A0 scope: implement frequent SELECT_* types first, others fallback to auto-select

**First Implementation Priority:**
Phase 0 — Define `ws-protocol.ts` (all WebSocket DTO types). This unblocks both server (Phase 1A) and client (Phase 1B) development tracks.

**Required Documentation (before deployment):**
- Dev setup guide (local environment, dependencies, data files)
- Deployment runbook (docker-compose, reverse proxy, TLS, data volumes)
