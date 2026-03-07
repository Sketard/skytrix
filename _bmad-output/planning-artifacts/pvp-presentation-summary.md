---
title: "skytrix PvP — Presentation Summary"
description: "Visual onboarding guide for the PvP Online Automated Duels module"
author: Paige (Tech Writer Agent)
date: 2026-02-25
sources: ['prd-pvp.md', 'architecture-pvp.md', 'ux-design-specification-pvp.md']
---

# skytrix PvP — Presentation Summary

**Online automated Yu-Gi-Oh! duels powered by OCGCore.**

This document provides a visual overview of the PvP module for developers joining the project. Each section uses a Mermaid diagram as primary content with minimal explanatory text. For full details, refer to the source documents linked in the frontmatter.

---

## Table of Contents

- [1. Product Vision](#1-product-vision)
- [2. Tri-Service Architecture](#2-tri-service-architecture)
- [3. Duel Server Internals](#3-duel-server-internals)
- [4. WebSocket Message Flow](#4-websocket-message-flow)
- [5. Authentication Chain](#5-authentication-chain)
- [6. Angular Component Tree](#6-angular-component-tree)
- [7. Lobby Flow](#7-lobby-flow)
- [8. Core Duel Prompt Loop](#8-core-duel-prompt-loop)
- [9. Prompt Type Mapping](#9-prompt-type-mapping)
- [10. PvP Board Layout](#10-pvp-board-layout)
- [11. Room State Machine](#11-room-state-machine)
- [12. Disconnection & Reconnection](#12-disconnection--reconnection)
- [13. Implementation Phases](#13-implementation-phases)
- [14. Key Design Decisions](#14-key-design-decisions)

---

## 1. Product Vision

skytrix is a Yu-Gi-Oh! deck management app with a solo combo testing simulator. PvP completes the loop: **build → test → duel** without leaving the application.

```mermaid
flowchart LR
    A["Deck Builder<br/>(existing)"] --> B["Solo Simulator<br/>(existing)"]
    B --> C["PvP Duel<br/>(new)"]
    C -->|"Adjust deck"| A
    style C fill:#4a90d9,color:#fff
```

**Core differentiator:** All game rules enforced automatically by OCGCore (the C++ engine used by EDOPro). No manual rule adjudication. The engine handles chain resolution, effect timing, damage calculation, and win conditions.

**Target:** Friends-only PvP (trusted players). No public matchmaking in MVP.

---

## 2. Tri-Service Architecture

Three services communicate via distinct protocols.

```mermaid
flowchart TB
    subgraph Browser["Browser (Angular 19 SPA)"]
        FE["Angular Frontend<br/>• Lobby page<br/>• Duel page<br/>• Prompt components"]
    end

    subgraph Spring["Spring Boot API (existing)"]
        SB["Spring Boot<br/>• Auth (JWT)<br/>• Room CRUD<br/>• Deck validation<br/>• Deck relay"]
    end

    subgraph Duel["Node.js Duel Server (new)"]
        DS["Duel Server<br/>• OCGCore WASM<br/>• Worker threads<br/>• Message filter<br/>• WebSocket"]
    end

    FE <-->|"REST API<br/>(auth, rooms, decks)"| SB
    FE <-->|"WebSocket<br/>(duel messages)"| DS
    SB -->|"Internal HTTP<br/>(create duel + relay decks)"| DS

    style Duel fill:#1a2332,stroke:#4a90d9,color:#f1f5f9
```

**Anti-cheat principle:** The frontend never sends decklists to the duel server. Spring Boot validates decks and relays them server-to-server. The duel server is the sole authority for game state.

---

## 3. Duel Server Internals

The duel server runs 7 source files. Each duel executes in a dedicated worker thread.

```mermaid
flowchart TB
    subgraph Main["Main Thread (server.ts)"]
        WS["ws.WebSocketServer<br/>Session routing"]
        HTTP["node:http<br/>4 internal routes"]
    end

    subgraph W1["Worker Thread 1 (duel-worker.ts)"]
        OCG1["OCGCore WASM<br/>Duel loop"]
    end

    subgraph W2["Worker Thread N..."]
        OCG2["OCGCore WASM<br/>Duel loop"]
    end

    subgraph Pure["Pure Modules"]
        MF["message-filter.ts<br/>Whitelist filter<br/>(msg, playerId) → msg | null"]
        WP["ws-protocol.ts<br/>WebSocket DTOs<br/>(protocol boundary)"]
        CB["ocg-callbacks.ts<br/>cardReader + scriptReader"]
        SC["ocg-scripts.ts<br/>loadDatabase() + loadScripts()"]
        TY["types.ts<br/>Internal types + constants"]
    end

    WS <-->|"postMessage<br/>(typed)"| W1
    WS <-->|"postMessage<br/>(typed)"| W2
    W1 --> MF
    MF --> WS
    SC --> CB
    CB --> W1

    style Main fill:#0f172a,stroke:#4a90d9,color:#f1f5f9
    style Pure fill:#1e293b,stroke:#94a3b8,color:#f1f5f9
```

**Why worker threads:** OCGCore runs synchronously (blocks the event loop). Complex chain resolutions can take 100-200ms+. One worker per duel ensures isolation — one slow chain never blocks another duel.

**Transformation chain:** `OCGCore binary → duel-worker.ts (transform) → DTO → message-filter.ts (filter) → server.ts (ws.send)`

---

## 4. WebSocket Message Flow

The duel protocol follows a strict invariant: `MSG_HINT → SELECT_* → SELECT_RESPONSE`.

```mermaid
sequenceDiagram
    participant E as OCGCore Engine
    participant W as Worker Thread
    participant S as server.ts
    participant P1 as Player 1 (Angular)
    participant P2 as Player 2 (Angular)

    E->>W: MSG_DRAW (binary)
    W->>S: DTO { type: MSG_DRAW, cards }
    S->>P1: Filtered (card codes visible)
    S->>P2: Filtered (card codes = 0)

    E->>W: MSG_HINT (which effect asks)
    W->>S: DTO { type: MSG_HINT, ... }
    S->>P1: Routed to deciding player only

    E->>W: SELECT_CARD (choose targets)
    W->>S: DTO { type: SELECT_CARD, ... }
    S->>P1: Prompt sent to deciding player

    P1->>S: SELECT_RESPONSE { indices }
    S->>W: PLAYER_RESPONSE
    W->>E: duelSetResponse()

    E->>W: MSG_MOVE (card moves zone)
    W->>S: DTO { type: MSG_MOVE, ... }
    S->>P1: Full info (own card)
    S->>P2: Sanitized (face-down = no code)
```

**Message filter policy:** Whitelist per message type. Default = DROP + LOG. Unrecognized messages are never transmitted. Prefer missing display over information leak.

**Wire format:** JSON with type discriminant: `{ "type": "MSG_DRAW", "playerId": 0, "cardCode": 12345 }`. Use explicit `null` for absent values (never field omission).

---

## 5. Authentication Chain

JWT flows through three boundaries. WebSocket auth is one-shot at handshake.

```mermaid
sequenceDiagram
    participant B as Browser
    participant SB as Spring Boot
    participant DS as Duel Server

    B->>SB: POST /api/rooms (JWT header)
    SB-->>B: Room created

    B->>SB: POST /api/rooms/:id/join (JWT)
    SB->>DS: POST /api/duels (internal HTTP, Docker network)
    DS-->>SB: { duelId, wsUrl }
    SB-->>B: { duelId, wsUrl }

    B->>DS: WebSocket handshake (JWT in query)
    DS->>DS: Validate JWT (one-shot)
    DS-->>B: Connection established

    Note over B,DS: No per-message re-validation.<br/>JWT ≥ 2h TTL covers full duel.
```

**Internal API auth:** Docker network isolation (no shared secret). Services communicate on internal docker-compose network; duel server port is not exposed externally.

---

## 6. Angular Component Tree

The duel view uses a full-overlay architecture. The board occupies 100% of the viewport; all other elements are positioned overlays.

```mermaid
flowchart TB
    DPC["DuelPageComponent<br/>(fixed, 100dvw × 100dvh)"]

    DPC --> PBC["PvpBoardContainerComponent<br/>CSS 3D perspective"]
    DPC --> HRP["PvpHandRowComponent ×2<br/>(player + opponent)"]
    DPC --> MT["Mini-toolbar<br/>(surrender + toggle)"]
    DPC --> CI["CardInspectorComponent<br/>(compact / full overlay)"]
    DPC --> PS["PvpPromptSheetComponent<br/>(bottom-sheet)"]
    DPC --> ZB["PvpZoneBrowserOverlayComponent"]
    DPC --> DR["PvpDuelResultOverlayComponent"]

    PBC --> PFO["PlayerFieldComponent ×2<br/>+ PvpLpBadgeComponent<br/>(via ng-content)"]
    PBC --> CS["Central Strip<br/>Timer | Phase | EMZ ×2"]

    style DPC fill:#0f172a,stroke:#4a90d9,color:#f1f5f9
    style PBC fill:#1a2332,stroke:#4a90d9,color:#f1f5f9
    style PS fill:#1a2332,stroke:#4a90d9,color:#f1f5f9
```

**Prompt sub-components** (injected into `PvpPromptSheetComponent` via CDK Portal):

```mermaid
flowchart LR
    PS["PvpPromptSheetComponent"] --> YN["PromptYesNoComponent"]
    PS --> CG["PromptCardGridComponent"]
    PS --> ZH["PromptZoneHighlightComponent"]
    PS --> OL["PromptOptionListComponent"]
    PS --> NI["PromptNumericInputComponent"]
    PS --> RPS["PromptRpsComponent"]

    style PS fill:#1a2332,stroke:#4a90d9,color:#f1f5f9
```

**6 signals** drive the PvP state (all in `DuelWebSocketService`, scoped to `DuelPageComponent`):

| Signal | Type | Purpose |
|--------|------|---------|
| `duelState` | `Signal<DuelState>` | Board, LP, phase, turn, cards |
| `pendingPrompt` | `Signal<Prompt \| null>` | Current SELECT_* awaiting response |
| `hintContext` | `Signal<HintContext>` | MSG_HINT context (which effect asks) |
| `animationQueue` | `Signal<GameEvent[]>` | FIFO queue of events to animate |
| `timerState` | `Signal<TimerState \| null>` | Player timer (server-authoritative) |
| `connectionStatus` | `Signal<ConnectionStatus>` | `connected \| reconnecting \| lost \| resynchronized` |

**Coordination rule:** Prompt display waits for `animationQueue` to drain. `hintContext` is always set before `pendingPrompt`.

---

## 7. Lobby Flow

From decklist to duel in 3 taps.

```mermaid
flowchart TD
    A["Decklist page<br/>'Duel PvP' button"] --> B{"Deck valid?<br/>(TCG, banlist, 40-60 main)"}
    B -- No --> C["Error + link<br/>to deckbuilder"]
    B -- Yes --> D["Room created<br/>Code: 4-6 chars"]
    D --> E["Share code<br/>(Web Share API / clipboard)"]
    E --> F["Opponent opens<br/>skytrix.app/pvp/XXXX"]
    F --> G{"Opponent<br/>authenticated?"}
    G -- No --> H["Login → redirect<br/>back to room"]
    G -- Yes --> I{"Opponent deck<br/>valid?"}
    H --> I
    I -- No --> J["Error → deckbuilder"]
    I -- Yes --> K["Both players<br/>in room"]
    K --> L["Rock-Paper-Scissors<br/>(30s timeout)"]
    L --> M["Winner chooses<br/>first / second"]
    M --> N["Duel starts<br/>5 cards each"]

    style N fill:#4a90d9,color:#fff
```

---

## 8. Core Duel Prompt Loop

The PvP experience is a **prompt → response** cycle driven by OCGCore.

```mermaid
stateDiagram-v2
    [*] --> Observation: Duel starts

    Observation --> Initiation: Engine sends prompt

    state Initiation {
        [*] --> Beat1: MSG_HINT arrives
        Beat1 --> Beat2: ~50ms delay
        Beat2 --> [*]: Interactive elements render
        note right of Beat1: Context first (card name, effect)
        note right of Beat2: Buttons/highlights appear OVER context
    }

    Initiation --> Interaction: Player reads context
    Interaction --> Feedback: Player responds (1-2 taps)
    Feedback --> AnimDrain: Visual confirmation

    state AnimDrain {
        [*] --> Drain: Queue processes
        note right of Drain: PvP-A = no-op / PvP-C = animations
    }

    AnimDrain --> Observation: Next event (opponent's turn)
    AnimDrain --> Initiation: Next prompt (same turn)
    Interaction --> AutoResponse: Timer expires
    AutoResponse --> Feedback: Default selected
```

**Activation toggle:** A client-side filter (Auto/On/Off) that determines which optional prompts the player sees. The engine always sends all legal prompts — the client auto-responds when filtered.

| Mode | Behavior |
|------|----------|
| **Auto** (default) | Prompt only on game events (opponent activates, monster summoned, attack declared) |
| **On** | Prompt at every legal priority window |
| **Off** | Auto-respond "No" to all optional prompts |

---

## 9. Prompt Type Mapping

OCGCore sends ~20 SELECT_* types. The Angular client maps them to 3 visual patterns and 6 sub-components.

| Visual Pattern | Sub-Component | SELECT_* Types |
|----------------|---------------|----------------|
| **A — Floating Instruction** (spatial, on board) | `PromptZoneHighlightComponent` | SELECT_PLACE, SELECT_DISFIELD |
| **B — Bottom Sheet** (full) | `PromptCardGridComponent` | SELECT_CARD, SELECT_UNSELECT_CARD, SELECT_CHAIN, SELECT_TRIBUTE, SELECT_SUM, SORT_CARD, SORT_CHAIN |
| **B — Bottom Sheet** (compact) | `PromptOptionListComponent` | SELECT_POSITION, SELECT_OPTION |
| **B — Bottom Sheet** (compact) | `PromptNumericInputComponent` | ANNOUNCE_NUMBER, SELECT_COUNTER |
| **B — Bottom Sheet** (full) | `PromptRpsComponent` | RPS (pre-duel) |
| **C — Yes/No** (compact sheet) | `PromptYesNoComponent` | SELECT_YESNO, SELECT_EFFECTYN |
| **Distributed UI** (no sheet) | Phase badge + card glow + zone browsers | SELECT_IDLECMD, SELECT_BATTLECMD |

**IDLECMD / BATTLECMD** are not rendered as sheets. Instead: actionable cards glow on the board, zone browsers highlight actionable cards, phase transitions go through `PvpPhaseBadgeComponent`. The engine's flat action list is mapped spatially.

---

## 10. PvP Board Layout

The board uses CSS 3D perspective — the opponent's field foreshortens naturally while the player's own field stays full-size and thumb-accessible.

```text
Mobile landscape (~844×390px):

┌──────────────────────────────────────────────────┐
│  Opponent hand (face-down, pointer-events: none)  │
│  🂠 🂠 🂠 🂠 🂠                                       │
├──────────────────────────────────────────────────┤
│                                                    │
│   [ST1][ST2][ST3][ST4][ST5]         LP: 8000      │  ← Opponent
│   [MZ1][MZ2][MZ3][MZ4][MZ5]      (foreshortened) │
│                                                    │
│ ─[EMZ-L]─── ⏱ 04:32 ──[EMZ-R]── (MP1) ────────  │  ← Central strip
│                                                    │
│   [MZ1][MZ2][MZ3][MZ4][MZ5]        (full-size,   │  ← Player
│   [ST1][ST2][ST3][ST4][ST5]   LP: 8000  thumb OK) │
│                                                    │
├──────────────────────────────────────────────────┤
│  Player hand (face-up)                       │ 🏳️ │
│  🃏 🃏 🃏 🃏 🃏 🃏                                │ 🔄 │  ← Mini-toolbar
└──────────────────────────────────────────────────┘

Overlays (contextual):
  • Bottom-sheet prompt (max-height: 55dvh)
  • Card inspector (compact <768px / full ≥768px)
  • Zone browser (GY, Banished, Extra Deck)
  • Duel result overlay
```

**Key CSS:** `perspective: 800px` + `transform: rotateX(15deg)` on the board container (~10 lines of CSS). Both values are tunable tokens. No 3D library needed.

**Solo vs PvP board differences:**

| Aspect | Solo | PvP |
|--------|------|-----|
| Perspective | 2D flat | CSS 3D |
| Interaction | Drag & drop | Click-based prompts |
| Fields visible | 1 (own) | 2 (own + opponent mirrored) |
| Platform priority | Desktop-first | Mobile landscape-first |
| Board state | Local signals (BoardStateService) | Server-pushed (DuelWebSocketService) |
| Reversibility | Undo (CommandStack) | Irreversible |

---

## 11. Room State Machine

Room lifecycle managed by Spring Boot.

```mermaid
stateDiagram-v2
    [*] --> WAITING: POST /api/rooms
    WAITING --> CREATING_DUEL: Opponent joins (POST /api/rooms/:id/join)
    CREATING_DUEL --> ACTIVE: Duel server confirms creation OK
    CREATING_DUEL --> WAITING: Timeout 5s (handoff failure)
    ACTIVE --> ENDED: Duel ends (LP=0, surrender, timeout, disconnect)
    ENDED --> [*]: Room closed

    note right of CREATING_DUEL: Spring Boot relays both decklists to duel server (anti-cheat)
```

---

## 12. Disconnection & Reconnection

60-second grace period. State snapshot on reconnect (not message replay).

```mermaid
sequenceDiagram
    participant P as Disconnected Player
    participant DS as Duel Server
    participant O as Opponent

    Note over P: WebSocket drops
    DS->>DS: Start 60s grace timer
    DS->>O: "Opponent connecting..." (after 5s)

    alt Reconnects within 60s
        P->>DS: New WebSocket + JWT
        DS->>DS: duelQueryField() + duelQuery()
        DS->>P: Full state snapshot (filtered)
        P->>P: Hydrate board (single-frame render)
        Note over P: Resume duel (pending prompt re-presented)
    else 60s expires
        DS->>O: DUEL_END (opponent forfeited)
        DS->>DS: Cleanup worker + session
    end
```

**Snapshot method:** `duelQueryField()` for global state + `duelQuery()` per card. No message log replay — OCGCore lacks save/restore, and replay introduces fragility.

---

## 13. Implementation Phases

Three incremental sub-phases. The protocol gate (`ws-protocol.ts`) unblocks parallel work.

```mermaid
flowchart TB
    Gate["Phase 0 — Protocol Gate<br/>ws-protocol.ts (all message types)"]

    P1A["Phase 1A — Duel Server<br/>Docker, server.ts, worker,<br/>message filter, OCG scripts"]
    P1B["Phase 1B — Angular<br/>DuelWebSocketService (6 signals),<br/>protocol types, connection handling"]

    P2A["Phase 2A — Integration<br/>Internal HTTP API, Spring Boot<br/>endpoints, room state machine"]
    P2B["Phase 2B — UI<br/>Prompt components (7 types),<br/>animation queue, PvP board"]

    P3["Phase 3 — End-to-End<br/>Full duel flow, reconnection,<br/>timer + forfeit"]

    Gate --> P1A
    Gate --> P1B
    P1A --> P2A
    P1B --> P2B
    P2A --> P3
    P2B --> P3

    style Gate fill:#4a90d9,color:#fff
```

**MVP sub-phases (product scope):**

| Phase | Delivers |
|-------|----------|
| **PvP-A** | Core duel: engine, WebSocket, prompts, board, LP, win detection |
| **PvP-B** | Session: lobby, deck validation, surrender, disconnect handling, timer |
| **PvP-C** | Polish: animations, chain viz, visual feedback per game event |

---

## 14. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Thread model | Worker thread per duel | OCGCore blocks synchronously. Isolation prevents one duel from blocking others |
| Message filter | Whitelist, default DROP | Safety-critical. Explicit, auditable. No private info leakage |
| Type sharing | Independent DTOs (no shared package) | Clean boundary. `ws-protocol.ts` (server) copied manually to `duel-ws.types.ts` (client). Same-commit rule |
| Board layout | CSS 3D perspective | Same visual compression as Master Duel. ~10 lines of CSS. No 3D library |
| Interaction model | Click-based prompts (not drag & drop) | Engine dictates legal actions. Distinct from solo's free-form manipulation |
| Prompt UX | Bottom-sheet (mobile-first) | Thumb zone anchored. Board visible above. Master Duel pattern |
| Lobby | Room code + deep link | 3 taps to duel. Web Share API on mobile. Dueling Nexus simplicity |
| Reconnection | State snapshot (not replay) | OCGCore has no save/restore. Snapshot via `duelQueryField()` is reliable |
| Internal API auth | Docker network isolation | Same compose network, port not exposed. KISS for friends-only MVP |
| Animation strategy | FIFO queue, never blocking | EDOPro speed + Master Duel polish. PvP-A uses no-op slots, PvP-C fills them |

---

## Source Documents

| Document | Scope | Link |
|----------|-------|------|
| PRD | Product requirements, FRs, NFRs, user journeys | [prd-pvp.md](prd-pvp.md) |
| Architecture | ADRs, data model, project structure, patterns | [architecture-pvp.md](architecture-pvp.md) |
| UX Design Spec | Components, layouts, prompts, flows, design tokens | [ux-design-specification-pvp.md](ux-design-specification-pvp.md) |
