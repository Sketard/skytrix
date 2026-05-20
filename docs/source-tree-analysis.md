# Source Tree Analysis

Annotated directory layout. Sub-trees pruned to the **load-bearing** files only (anything under `node_modules/`, `target/`, `dist/`, `e2e-results/`, ML weights binaries, and `.git/` is omitted).

## Top level

```
skytrix/
├── back/                       # Spring Boot 3.4.2 backend (Java 21)
├── front/                      # Angular 20.3 SPA
├── duel-server/                # Node + ocgcore-wasm WebSocket server
├── docs/                       # Generated documentation (this directory)
├── _bmad/                      # BMAD config (config.toml, custom overrides, scripts)
├── _bmad-output/               # PRDs, architecture, UX specs, epics, R&D logs, solver data
├── scripts/                    # Cross-part scripts (e.g., check-ws-protocol-sync.mjs)
├── docker-compose.yml          # 4-service stack (db / back / duel-server / front + certbot)
├── logrotate-nginx.conf        # Nginx log rotation policy
├── README.md                   # Top-level run instructions
├── CLAUDE.md                   # AI agent rules (animation parity, chain state, locks)
└── *.PNG / *.jpg               # Marketing screenshots (Master Duel comparisons)
```

## back/ — Spring Boot backend

```
back/
├── pom.xml                                 # Maven (Java 21, Spring Boot 3.4.2)
├── Dockerfile                              # Multi-stage: maven:3.9 → temurin-jre-21-alpine
├── mvnw, mvnw.cmd                          # Maven wrapper
├── images/                                 # Card images cache (mounted volume in prod)
│   ├── small/                              # Thumbnails
│   └── big/                                # Full-size
├── logs/                                   # Application logs
└── src/
    ├── main/
    │   ├── resources/
    │   │   ├── application.properties      # DB URL, JWT secret, duel-server URL, CORS origins
    │   │   └── db/migration/flyway/        # V001..V015 SQL migrations (out-of-order enabled)
    │   └── java/com/skytrix/
    │       ├── SkytrixApplication.java     # @SpringBootApplication entry point
    │       ├── config/                     # Spring config (CORS, async, etc.)
    │       ├── controller/                 # @RestController layer
    │       │   ├── AuthController.java     # /login, /refresh, /create-account, /logout
    │       │   ├── CardController.java     # /api/cards/* (search, favorites, possessed)
    │       │   ├── DeckController.java     # /api/decks CRUD
    │       │   ├── RoomController.java     # /api/rooms (PvP lobby + SSE events)
    │       │   ├── DevRoomController.java  # /api/rooms/quick-duel (dev shortcut)
    │       │   ├── ReplayController.java   # /api/replays (+ /internal/replays for duel-server)
    │       │   ├── TransferController.java # /api/transfers/export|import/deck
    │       │   ├── YugiproApiController.java # /api/yugipro/* (fetch ygoprodeck data)
    │       │   ├── ParameterController.java # /api/parameters/* (admin-only, async tasks)
    │       │   └── ClientLogController.java # /api/client-logs (browser error capture)
    │       ├── service/                    # @Service layer (business logic)
    │       │   ├── CardService, DeckService, RoomService, ReplayService
    │       │   ├── YugiproApiService       # ygoprodeck.com sync orchestrator
    │       │   ├── DocumentService         # Image streaming (path-based)
    │       │   ├── DuelServerClient        # HTTP client → duel-server /api/duels
    │       │   ├── TransferService         # Deck export/import (PDF, ydk, etc.)
    │       │   └── RoomEventService        # SSE emitters per-room
    │       ├── repository/                 # Spring Data JPA (CrudRepository + JpaSpecificationExecutor)
    │       ├── model/
    │       │   ├── entity/                 # JPA @Entity (User, Card, Deck, Room, Replay, ...)
    │       │   ├── dto/                    # Per-domain DTOs: card/, deck/, replay/, room/, user/, yugipro/
    │       │   └── enums/                  # Role, Language, Type, Race, Attribute, RoomStatus, DuelResult, ...
    │       ├── mapper/                     # MapStruct mappers (User, Room, Replay, Card)
    │       ├── security/                   # JWT (filter, provider, service), AuthService, SecurityConfig
    │       ├── requester/                  # External HTTP clients (Requester base + YugiproRequester)
    │       ├── scheduler/                  # @Scheduled tasks (RoomCleanupScheduler)
    │       ├── exception/                  # Custom exceptions
    │       └── utils/                      # FileUtils, RouteUtils, ThreadUtils, CoreUtils, CustomPageable
    └── test/                               # JUnit 5 + Mockito (Spring Boot Starter Test)
```

**Critical paths**:
- `controller/` + `service/` — REST surface, business logic.
- `model/entity/` + `db/migration/flyway/` — schema source of truth.
- `security/` — JWT lifecycle (HTTP-only refresh cookie + Bearer access token).
- `requester/YugiproRequester.java` + `service/YugiproApiService.java` — external data ingest.

## front/ — Angular SPA

```
front/
├── package.json                           # Angular 20, ngx-translate, jspdf, @angular/material
├── angular.json                           # Project config (build/serve/test/extract-i18n targets)
├── tsconfig.json, tsconfig.app.json, tsconfig.spec.json
├── proxy.conf.json                        # /api → http://localhost:8080 (dev only)
├── nginx.conf                             # Prod reverse proxy + Let's Encrypt + rate limits
├── Dockerfile                             # Multi-stage: node:20-alpine → nginx:alpine
├── e2e/
│   ├── playwright.config.ts
│   └── cache-prefetch.spec.ts             # Single Playwright suite (admin login, duel cache)
└── src/
    ├── index.html, main.ts, styles.scss
    ├── proxy.conf.json
    ├── assets/
    │   ├── i18n/{fr.json, en.json}        # ngx-translate dictionaries (FR default)
    │   └── img/                           # Static assets (icons, placeholders)
    └── app/
        ├── app.config.ts                  # Standalone bootstrap, providers, TranslateModule
        ├── app.routes.ts                  # Flat route list (no NgModule, lazy: pvp/replay/solver)
        ├── app.component.ts
        ├── core/
        │   ├── directives/                # Custom directives
        │   ├── enums/                     # CardType, CardRace, CardAttribute, Language, ...
        │   ├── interceptors/              # authInterceptor, loaderInterceptor (functional)
        │   ├── model/                     # Card, Deck, DeckCardSlot, CustomPageable, account/, dto/
        │   ├── pipes/                     # Translation, formatting pipes
        │   ├── services/                  # NotificationService, ClientLogService, GlobalErrorHandler
        │   └── utilities/                 # functions.ts (displaySuccess/displayError + helpers)
        ├── components/                    # Reusable UI (~22 classes)
        │   ├── card/                      # Card, CardInspector, CardImageFallback, CardList
        │   ├── deck/                      # DeckBox, DeckCardZone (drag-drop)
        │   ├── filters/                   # Autocomplete, between, multi-select, toggle-icon, ...
        │   ├── navbar/, loader/, system-overlay/, snackbar/, ...
        │   └── ...
        ├── pages/                         # Routed pages (1 component per route)
        │   ├── login-page/
        │   ├── deck-page/                 # Deck list + DeckBuilder editor
        │   ├── card-search-page/
        │   ├── parameter-page/            # Admin tools
        │   ├── simulator-page/            # FEATURE 1: Solo simulator (BoardState + CommandStack)
        │   │   ├── simulator-page.component.ts
        │   │   ├── sim-board, hand, zone, stacked-zone, pile-overlay, control-bar, ...
        │   │   └── services/              # BoardStateService, CommandStackService (component-scoped)
        │   ├── pvp/                       # FEATURE 2 + 3: PvP + Replay
        │   │   ├── lobby-page/            # Room list, create/join, deck picker
        │   │   ├── duel-page/             # PvP duel page (40+ services!)
        │   │   │   ├── duel-page.component.ts
        │   │   │   ├── duel-web-socket.service.ts        # AnimationDataSource impl (PvP)
        │   │   │   ├── duel-connection.ts                # Owns WS + signals + processor
        │   │   │   ├── duel-event-processor.ts           # Chain state machine (single SOT)
        │   │   │   ├── animation-orchestrator.service.ts # 3000+ LOC, drives all animations
        │   │   │   ├── animation-data-source.ts          # Interface (PvP + Replay polymorphism)
        │   │   │   ├── rendered-board-state.service.ts   # Lock-aware zone state
        │   │   │   ├── chain-resolution-manager.ts       # Chain phase (idle|building|resolving)
        │   │   │   ├── draw-sequence-manager.ts          # Draw bursts + hand expansion slots
        │   │   │   ├── move-animation-router.ts          # MoveContext branching
        │   │   │   ├── lp-animation-tracker.ts           # LP tween + pending commits
        │   │   │   ├── battle-animation-tracker.ts       # Attack lines + clash impact
        │   │   │   ├── target-indicator-manager.ts       # MSG_BECOME_TARGET reticles
        │   │   │   ├── card-travel-engine.service.ts     # Float keyframes + zone resolvers
        │   │   │   ├── board-effects.service.ts          # Slam dust, pre-destroy, target floats
        │   │   │   ├── float-registry.service.ts         # Float lifecycle (LIFO/FIFO landed)
        │   │   │   ├── buffer-replay-builder.ts          # 3-pass batch construction
        │   │   │   ├── duel-context.ts                   # Shared closures (player, motion, durations)
        │   │   │   ├── duel-logger.ts                    # Categorized debug logging
        │   │   │   ├── prompts/                          # 9 PromptXxxComponent + registry
        │   │   │   ├── pvp-board-container.component.ts, pvp-hand-row.component.ts, ...
        │   │   │   └── *.spec.ts                         # 24+ specs (animation, chain, board state)
        │   │   ├── replay/                # FEATURE 3: Replay viewer
        │   │   │   ├── replay-page.component.ts
        │   │   │   ├── replay-connection.service.ts      # WS for ?mode=replay
        │   │   │   ├── replay-transport.service.ts       # Play/pause/seek/speed
        │   │   │   ├── replay-duel-adapter.ts            # AnimationDataSource impl (Replay)
        │   │   │   ├── replay-fork.service.ts            # Fork-from-decision
        │   │   │   └── timeline-bar, transport-bar
        │   │   └── match-history-page/    # Admin replay browser
        │   └── solver/                    # FEATURE 4: Combo solver (lazy)
        │       ├── solver-page.component.ts
        │       ├── services/
        │       │   ├── solver.service.ts                  # WS for ?mode=solver
        │       │   ├── solver-prefs.service.ts            # localStorage prefs
        │       │   ├── solver-pins.service.ts             # Pinned results
        │       │   ├── solver-export.service.ts           # PDF/image export
        │       │   └── solver-debug-log.service.ts        # Optional debug log (component-scoped)
        │       ├── solver-config, solver-progress, hero-result-block, brick-state-block,
        │       │   decision-tree, breadcrumb-path, solver-history-menu, pinned-results-bar
        │       └── card-image-fallback, interruption-display, hover-popup-controller
        └── services/                      # Global services (providedIn: 'root')
            ├── auth.service.ts            # User signal + RefreshStep BehaviorSubject
            ├── card-search.service.ts, card-set.service.ts, owned-card.service.ts
            ├── deck-build.service.ts      # Deck signal + dirty tracking
            ├── export.service.ts          # jspdf + text formats
            ├── loader.service.ts, navbar-collapse.service.ts, parameter.service.ts
            ├── replay.service.ts          # Replay metadata REST client
            └── search-service-core.service.ts
```

**Critical paths**:
- `pages/pvp/duel-page/` — the PvP animation engine (mandatory: respect `CLAUDE.md` rules).
- `pages/pvp/replay/` — replay layer; reuses ~25 services from `duel-page/` via the `AnimationDataSource` interface.
- `pages/solver/services/solver.service.ts` — solver WS client.
- `core/interceptors/authInterceptor` — JWT refresh queueing.

## duel-server/ — Node WebSocket server

```
duel-server/
├── package.json                            # ws, ocgcore-wasm, better-sqlite3, piscina, vitest, zod
├── tsconfig.json                           # ES2022, nodenext, strict
├── Dockerfile                              # node:24-slim with curl/git/ca-certificates
├── DATA-SETUP.md                           # cards.cdb + scripts setup
├── data/                                   # Game data (mounted volume in prod)
│   ├── cards.cdb                           # SQLite (7.6 MB) — card stats, types
│   ├── strings.conf                        # OCGCore system strings (54 KB)
│   ├── scripts_full/                       # Lua effect scripts (1500+ files)
│   ├── solver-config.json                  # Solver hyperparameters
│   ├── handtraps.json                      # Known handtrap cardIds
│   ├── interruption-tags.json              # Card interrupt effects + scoring (60 KB)
│   ├── interruption-weights.json           # Interrupt scoring weights
│   ├── link-arrows.json                    # Link monster arrow markers
│   ├── opp-turn-summon-enablers.json       # Strategic knowledge
│   ├── archetype-expertise/                # Per-archetype data (Branded.json, DDD.json, ...)
│   ├── policy-weights/, trained-weights/   # ML model weights (binary)
│   └── eval-*/                             # Evaluation datasets
├── docs/                                   # Internal duel-server docs
├── scripts/                                # Build/data sync scripts
└── src/
    ├── server.ts                           # Boot, HTTP router, WS listener, session lifecycle
    ├── configurable.ts                     # createConfigurable<T>(name) two-phase init
    ├── logger.ts                           # Categorized structured logging
    │
    │  # === Session & duel management ===
    ├── duel-session-manager.ts             # Active duels Map + atomic token consumption
    ├── duel-worker.ts                      # WORKER thread: runDuelLoop (ocgcore sync)
    ├── timer-management.ts                 # Turn timers, inactivity warnings, ANIMATIONS_DONE
    ├── types.ts                            # Constants, Deck/CardDB types, ActiveDuelSession
    │
    │  # === Protocol (synced with front via prebuild script) ===
    ├── ws-protocol.ts                      # Barrel re-exporting 6 sub-files
    ├── ws-protocol-shared.ts               # Player, Phase, LOCATION, POSITION, BOARD_STATE
    ├── ws-protocol-game.ts                 # MSG_* (BOARD_CHANGING events live here)
    ├── ws-protocol-prompts.ts              # SELECT_*, ANNOUNCE_*, SORT_*
    ├── ws-protocol-system.ts               # Lifecycle (DUEL_END, RPS, REMATCH, TIMER, ...)
    ├── ws-protocol-replay.ts               # REPLAY_BOARD_STATES, REPLAY_METADATA, fork
    ├── ws-protocol-solver.ts               # SOLVER_INIT, START, PROGRESS, RESULT, ...
    ├── protocol-version-check.ts           # Close-code 4426 (Upgrade Required)
    ├── ws-rate-limit.ts                    # Per-IP rate limiter
    │
    │  # === Chain state (parity PvP↔Replay) ===
    ├── chain-snapshot-tracker.ts           # boardStateAfter attach (live + precompute share this)
    ├── chain-state-tracker.ts              # Server-side chain snapshot for reconnect handshake
    │
    │  # === HTTP routes ===
    ├── http-routes.ts                      # GET /health, /status, internal /api/duels, ...
    ├── http-helpers.ts                     # json(), readBody(), validateInternalAuth()
    │
    │  # === Replay system ===
    ├── replay-precompute.ts                # runReplayPreComputation: turn 0 = "Setup", ...
    ├── replay-handlers.ts                  # WS branch for ?mode=replay (Piscina pool)
    ├── replay-cache.ts                     # TTL'd cache of precomputed states
    │
    │  # === Solver system ===
    ├── solver-handlers.ts                  # Connection mgmt + JWT cache + deck cache
    ├── solver/
    │   ├── solver-orchestrator.ts          # Piscina pool of solver workers
    │   ├── solver-config-loader.ts         # solver-config.json loader
    │   ├── solver-types.ts                 # HandtrapConfig, DuelConfig, SolverConfig, ...
    │   ├── interruption-scorer.ts          # interruption-tags.json + OPT-aware scoring
    │   ├── dfs-solver.ts                   # DFS + compression mode
    │   ├── mcts-solver.ts                  # Monte Carlo Tree Search (UCB1)
    │   ├── minimax-mcts-solver.ts          # Hybrid
    │   ├── macro-dfs.ts                    # Macro-action abstraction
    │   ├── branching-oracles.ts            # Action-branch ranking
    │   ├── card-expertise-oracle.ts        # Archetype-specific expertise
    │   ├── ocgcore-adapter.ts              # FFI wrapping (SELECT prompt reconstruction)
    │   ├── plan-replay-oracles.ts          # Plan-replay + handtrap injection
    │   ├── ml/                             # Neural + graph rankers + loaders + pipeline
    │   ├── prompt-resolver.ts              # Ambiguous SELECT resolution
    │   ├── transposition-table.ts          # Zobrist memoization
    │   ├── solver-verifier.ts, solver-instrumentation.ts
    │   └── *.spec.ts                       # 50+ test files
    │
    │  # === Validation, parsing, FFI ===
    ├── validation/response-validation.ts   # Bounds-check SELECT responses (M28 audit)
    ├── validation/worker-message-validation.ts
    ├── message-filter.ts                   # Per-player field-of-view filter
    ├── ocg-scripts.ts                      # Card/script DB loading
    ├── ocg-callbacks.ts                    # CardReader / ScriptReader FFI callbacks
    ├── card-db-cache.ts                    # LRU-cached cards.cdb queries
    ├── lru-map.ts                          # Generic LRU
    ├── data-updater.ts                     # ProjectIgnis sync (cards.cdb + scripts)
    ├── wasm-snapshot.ts, wasm-snapshot-wrapper.ts # Module-state capture/restore
    │
    │  # === PoCs and standalone harnesses (excluded from build) ===
    ├── poc-duel.ts, poc-replay.ts, solver-poc.ts
    ├── test-core.ts, test-snapshot.ts
    │
    │  # === Tests ===
    └── *.spec.ts                           # vitest specs (chain-snapshot-tracker, chain-state-tracker,
                                            # duel-session-manager, response-validation, replay-precompute, ...)
```

**Critical paths**:
- `server.ts` — boot invariant: all 4 configurable modules MUST be configured before `wss.on('connection')`.
- `duel-worker.ts:runDuelLoop` — the actual game loop.
- `chain-snapshot-tracker.ts` — **shared by `runDuelLoop` and `runReplayPreComputation`** for parity.
- `solver-handlers.ts` — atomic connection lifecycle (returns discriminated `{kind: 'limit'|'attached'}`).
- `data/interruption-tags.json` — solver scoring source of truth.

## _bmad-output/ — planning artifacts

```
_bmad-output/
├── project-context.md                      # AI agent rules (regenerated by /bmad-document-project)
├── planning-artifacts/
│   ├── prd.md, prd-pvp.md, prd-solver.md
│   ├── architecture.md, architecture-pvp.md, architecture-solver.md
│   ├── ux-design-specification.md, *-pvp.md, *-replay.md, *-solver.md
│   ├── epics.md, epics-pvp.md, epics-replay.md, epics-solver.md
│   ├── yugioh-game-rules.md
│   ├── ocgcore-technical-reference.md
│   ├── ux-audit-pvp-replay-2026-05-08.md
│   ├── cancel-rollback-contract.md
│   └── implementation-readiness-report-*.md
├── implementation-artifacts/
└── solver-data/
    ├── path-beta-methodology.md
    ├── interruption-tag-generation-prompt.md   # AI-assisted prompt for new card entries
    └── graph-ml-v1/methodology.md
```

## scripts/ — Cross-part scripts

```
scripts/
└── check-ws-protocol-sync.mjs              # Byte-syncs ws-protocol-*.ts files front↔back
                                            # (run as duel-server prebuild step)
```
