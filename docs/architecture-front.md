# Architecture — Frontend (Angular SPA)

> Angular 21.2 single-page app. Standalone components everywhere. Signals as the canonical state primitive. OnPush change detection. Hosts four major features behind one shell: deck management, solo simulator, PvP duels, replay viewer, and combo path solver.

## Executive summary

The front-end is a **flat, standalone-first Angular app** with three lazy-loaded pages (`pvp`, `pvp/replay`, `pvp/duel`, `solver`) and the rest eager. State is held in **signals** with sparse RxJS holdouts (auth refresh, deck list).

The **PvP/Replay/Solver** pages are the architectural centerpieces. Each has its own component-scoped service graph (40+ services for PvP), and the **animation orchestrator + chain state machine** are shared between PvP and Replay through a polymorphic `AnimationDataSource` interface (`DuelWebSocketService` for live, `ReplayDuelAdapter` for replay).

> **Read [CLAUDE.md](../CLAUDE.md) before touching anything in `pages/pvp/duel-page/`.** The animation-parity rule, chain state machine, lock contract, and replay parity rule are non-negotiable.

## Technology stack

| Concern | Tech | Notes |
|---|---|---|
| Framework | Angular 21.2 | standalone components, signal-based I/O |
| UI kit | Angular Material 21.2 + CDK | DragDrop, dialog, snackbar, paginator |
| Language | TypeScript 5.9 | `strict: true`, `noImplicitReturns`, `strictTemplates: true` |
| Reactivity | Angular signals (primary) + RxJS 7.8.0 (auth refresh, HTTP) | |
| HTTP | functional interceptors (`authInterceptor`, `loaderInterceptor`) | never class-based |
| Forms | Reactive forms with custom `TypedForm<T>` | strongly typed FormGroup |
| Routing | flat `app.routes.ts` | no NgModule, lazy on `pvp/**` and `solver/**` |
| i18n | ngx-translate 16.0.4 | FR default, EN supported, JSON in `assets/i18n/` |
| Styling | SCSS | `@use 'z-layers' as z` for z-index tokens |
| Drag-drop | `@angular/cdk/drag-drop` | deck builder, hand zone |
| PDF export | `jspdf` 2.5.1 | deck export |
| Testing | Karma + Jasmine (unit), Playwright (e2e) | |

## Routing

Route table from `src/app/app.routes.ts`. All authenticated routes use the `AuthService.canActivate` guard. Lazy routes are loaded on demand.

| Path | Component | Guards | Strategy |
|---|---|---|---|
| `` | redirect → `/login` | — | eager |
| `login` | `LoginPageComponent` | — | eager |
| `decks` | `DeckPageComponent` | `AuthService` | eager |
| `decks/builder` | `DeckBuilderComponent` | `AuthService`, `unsavedChangesGuard` | eager |
| `decks/:id` | `DeckBuilderComponent` | `AuthService`, `unsavedChangesGuard` | eager |
| `decks/:id/simulator` | `SimulatorPageComponent` | `AuthService` | eager |
| `decks/:id/solver` | `SolverPageComponent` | `AuthService`, `solverDisabledGuard` | **lazy** |
| `search` | `CardSearchPageComponent` | `AuthService` | eager |
| `parameters` | `ParameterPageComponent` | `AuthService`, `adminGuard` | eager |
| `pvp` | `LobbyPageComponent` | `AuthService` | **lazy** |
| `pvp/history` | `MatchHistoryPageComponent` | `AuthService`, `adminGuard` | **lazy** |
| `pvp/replay/:replayId` | `ReplayPageComponent` | `AuthService`, `adminGuard` | **lazy** |
| `pvp/duel/:roomCode` | `DuelPageComponent` | `AuthService`, `canDeactivate` (surrender confirmation) | **lazy** |

## Architectural pillars

### 1. Standalone-first

There are **no NgModules for components**. Each component declares its dependencies via `imports: [...]` in the decorator. App-level providers live in `app.config.ts` (`provideRouter`, `provideHttpClient(withInterceptors([authInterceptor, loaderInterceptor]))`, `TranslateModule.forRoot(...)`, `MAT_FORM_FIELD_DEFAULT_OPTIONS`, etc.).

### 2. Signals + OnPush

- All components: `changeDetection: ChangeDetectionStrategy.OnPush`.
- Inputs/outputs: `input<T>()`, `output<T>()` — signal-based, never decorator-based.
- State: `signal()`, `computed()`, `.set()`, `.update()`. Effects only when truly needed (animation triggers, route reactions).
- The few RxJS holdouts: `AuthService` uses a `BehaviorSubject<RefreshStep>` to coordinate token refresh (multiple parallel requests park behind it); `DeckBuildService` exposes a `BehaviorSubject<ShortDeck[]>` for the deck list (legacy filter chains).

### 3. Component-scoped services for feature graphs

PvP, Replay, and Solver each hold ~10–40 services that are **scoped to the page component**, not `providedIn: 'root'`. This gives clean teardown when navigating away. The `DuelPageComponent` providers array enumerates them; the `ReplayPageComponent` re-uses ~25 of them via the same providers list.

### 4. Animation parity through `AnimationDataSource`

This is the architectural centerpiece. The `AnimationOrchestratorService` (3 000+ LOC) is **completely decoupled** from PvP-vs-replay. It depends on the `AnimationDataSource` interface (`animation-data-source.ts`), which has two implementations:

- `DuelWebSocketService` — live PvP, delegates to `DuelConnection` (the WS layer).
- `ReplayDuelAdapter` — replay mode, drives the orchestrator from precomputed states.

The orchestrator MUST NOT import `DuelWebSocketService` or `DuelConnection` directly. Any new state read/write goes through the interface. **Replay automatically inherits all animation features** because of this rule.

The shared `syncAfterBoardState()` free function (also in `animation-data-source.ts`) handles BOARD_STATE sync tier logic identically for both implementations.

### 5. Chain event processing — `DuelEventProcessor`

`DuelEventProcessor` is the **single source of truth** for chain state (`activeChainLinks`, `chainPhase`, the animation queue, chain entry commits). Both `DuelConnection` (PvP) and `ReplayDuelAdapter` instantiate their own processor — there is no manual PvP/replay parity needed because the processor guarantees identical behavior.

The chain phase transitions: `idle → building → resolving → idle`. Most importantly, `'resolving'` is set by `applyChainSolving(chainIndex)` and persists across **all links of the same chain** — it only flips back to `'idle'` at MSG_CHAIN_END. While resolving, all BOARD_CHANGING events are buffered and replayed after the chain overlay hides via queue directives (group, barrier, lp, batch-end, await-signal).

### 6. Lock-aware rendered state — `RenderedBoardStateService`

`RenderedBoardStateService` (`pages/pvp/duel-page/rendered-board-state.service.ts`) maintains the **rendered** view of the board separately from the **logical** view that ocgcore reports. Animations lock zones, render at the pre-animation state, then commit when the animation lands.

Async event handlers in `processEvent()` MUST call `lockZone()` on **every zone they animate** (source AND destination) **synchronously before the first `await`**. The `commitUnlocked()` step that runs after `processEvent()` will commit any unlocked zone immediately — so missing a lock means the zone snaps to the post-animation state mid-flight.

### 7. Card-travel stack — three-service split

The card-travel subsystem (M11 Phases 1+2) is split into three services:
- `CardTravelEngine` — animation kickoff, geometry/keyframe computation, zone resolver registry.
- `BoardEffectsService` — zone-anchored effects (impact, slam dust, pre-destroy, target floats).
- `FloatRegistryService` — lifecycle of in-flight float elements (LIFO/FIFO landed sets).

The Engine and BoardEffects form an intentional cycle (resolved via field-level `inject()`); the Engine is the only path that adds to the `FloatRegistry`. `clearAllTravels` cancels (not finishes) — so the registered `.finished.then()` callbacks don't asynchronously re-add to `_landed` after the registry is cleared.

## Top-level service map

### Global (`providedIn: 'root'`)

| Service | Role |
|---|---|
| `AuthService` | User signal + RefreshStep BehaviorSubject; login/logout/refresh; `canActivate` guard |
| `CardSearchService` | Card search query state, pagination |
| `CardSetService` | Card set list cache |
| `DeckBuildService` | Deck signal + dirty tracking + drag-active flag + ShortDeck list |
| `ExportService` | jspdf + text formats for deck export |
| `LoaderService` | Global spinner signal |
| `NavbarCollapseService` | Navbar / drawer / immersive-mode signals |
| `OwnedCardService` | Owned card collection |
| `ParameterService` | System parameters fetch + cache |
| `ReplayService` | Replay metadata REST client |
| `NotificationService` (core) | Snackbar API |
| `ClientLogService` (core) | Browser error → backend |
| `GlobalErrorHandler` (core) | Override Angular's default; logs uncaught errors |

### PvP duel page (component-scoped, ~40 services)

Top categories — see `pages/pvp/duel-page/duel-page.component.ts` for the full providers list.

| Category | Examples |
|---|---|
| WS + state | `DuelWebSocketService`, `DuelConnection`, `DuelEventProcessor`, `DuelLogger`, `DuelContext` |
| Orchestration | `AnimationOrchestratorService` (the main one), `BufferReplayBuilder` |
| Rendering | `RenderedBoardStateService`, `BoardEffectsService`, `CardTravelEngine`, `FloatRegistryService`, `DuelCardArtService`, `CardDataCacheService`, `CardInspectionService`, `DuelA11yEffectsService` |
| Animation tracking | `BattleAnimationTracker`, `LpAnimationTracker`, `MoveAnimationRouter` |
| Chain + draw | `ChainResolutionManager`, `DrawSequenceManager`, `TargetIndicatorManager` |
| Prompt UI | `PromptDerivationService`, `CardActionMenuService` |
| UX | `PhaseAnnouncementService`, `DuelToastService`, `DuelPromptEffectsService`, `DuelLoadingEffectsService`, `DuelTabGuardService` |
| Connection | `DuelConnectionEffectsService`, `RoomStateMachineService`, `SoloDuelOrchestratorService`, `SoloModeEffectsService` |

### Replay page (component-scoped)

| Service | Role |
|---|---|
| `ReplayConnectionService` | WS client for `?mode=replay`; metadata + boardStates signals |
| `ReplayTransportService` | Play/pause/seek/speed, synchronizes with the connection service |
| `ReplayDuelAdapter` | Bridge from precomputed states → `AnimationDataSource` |
| `ReplayForkService` | Fork-from-decision REST client |
| (+ ~25 services reused from `duel-page/`) |  |

### Solver page (mixed: root + component)

| Service | Provider | Role |
|---|---|---|
| `SolverService` | root | WS client; signals for state, progress, result, error, handtraps |
| `SolverPrefsService` | root | localStorage prefs (timeout, depth limit, goldfish) |
| `SolverPinsService` | root | Pinned results storage |
| `SolverExportService` | root | PDF / image export |
| `SolverDebugLogService` | component | Optional debug log (provided only if SolverPageComponent is mounted) |

## State management

| Surface | Mechanism |
|---|---|
| Auth | `userState: signal<UserDTO>` + `BehaviorSubject<RefreshStep>` |
| Deck list | `deckListState: BehaviorSubject<ShortDeck[]>` (legacy) |
| Active deck | `deckState: signal<Deck>` + `_isDirty: signal` |
| Card search | `query/page/filters` signals |
| PvP duel | 13 signals on `DuelConnection`, exposed read-only via `DuelWebSocketService` (`renderedBoardState`, `boardStateView`, `pendingPrompt`, `hintContext`, `animationQueue`, `timerState`, `timerStatePerPlayer`, `duelResult`, `rpsResult`, `ocgPlayerIndex`, `connectionStatus`, `protocolMismatch`, `opponentDisconnected`, `inactivityWarning`) |
| Replay | `metadata`, `boardStates[]`, `lastReceivedTurn`, `forkStatus` signals on `ReplayConnectionService`; `currentIndex`, `playing`, `speed` on `ReplayTransportService` |
| Solver | `solverState: signal<'idle' \| 'connecting' \| 'running' \| 'paused' \| 'done'>`, `progress`, `result`, `error`, `handtraps` |
| UI chrome | `LoaderService.isLoading`, `NavbarCollapseService.{collapsed,drawerOpen,immersiveMode,navbarHidden}` |

## WebSocket layer

The `front` connects to the duel-server directly via `WebSocket` (proxied through nginx in prod).

### PvP — `DuelWebSocketService` + `DuelConnection`

`DuelWebSocketService` proxies the 13 signals up to the component layer and implements the `AnimationDataSource` interface. `DuelConnection` owns the actual `WebSocket` instance, message parsing, and state mutations through the `DuelEventProcessor`.

Solo mode runs **two concurrent connections** (one per player perspective) — `SoloDuelOrchestratorService` toggles which is "active" and the inactive side buffers messages.

### Replay — `ReplayConnectionService`

Connects with `?mode=replay&replayId=<uuid>&token=<jwt>&pv=<protocolVersion>`. Receives:
- `REPLAY_METADATA` — match info, decks, totalResponses.
- `REPLAY_BOARD_STATES` — precomputed states per decision moment.
- `REPLAY_FORK_CREATED` — when a fork is requested.
- `REPLAY_ERROR` — divergence or backend issues.

### Solver — `SolverService`

Connects with `?mode=solver` (JWT in query string). Handshake is `SOLVER_INIT` → server responds `SOLVER_HANDTRAPS` with the inferred handtrap list cache. Client sends `SOLVER_START` with the configuration; server streams `SOLVER_PROGRESS`, then `SOLVER_RESULT`, with `SOLVER_CANCELLED` / `SOLVER_ERROR` as alternative terminals.

### Protocol-version close code

All three connection services MUST handle WebSocket close `event.code === 4426` distinctly from generic disconnects — that's the "client outdated, refresh" signal. Otherwise an outdated bundle just sees a transient drop and reconnects forever.

## Components

22 reusable components plus all the page/feature-specific ones. See [component-inventory-front.md](./component-inventory-front.md) for the full categorized list.

## i18n

- `TranslateModule.forRoot()` in `app.config.ts`.
- Loader: `TranslateHttpLoader` reading `/assets/i18n/{lang}.json`.
- Default: French (`fr`). Supported: `fr`, `en`. Persisted in `localStorage` (key `lang`).
- An `APP_INITIALIZER` factory loads the saved language at boot.
- `MatPaginatorIntl` is overridden to use `TranslateService` for paginator labels.

## Build, dev, test

### `angular.json` targets
- `build` — `@angular-devkit/build-angular:application`, `outputPath: dist/skytrix`, SCSS with `includePath: src/app/styles`.
- `serve` — dev-server with `proxyConfig: src/proxy.conf.json`.
- `extract-i18n` — extract translatable strings.
- `test` — Karma + Jasmine.

Production budgets: initial JS 1 MB warn / 2 MB error; component styles 12 KB warn / 16 KB error.

### `proxy.conf.json`
```json
{ "/api": { "target": "http://localhost:8080", "secure": true, "changeOrigin": true } }
```

### Scripts
| Script | Command |
|---|---|
| `start` | `ng serve` (default: development, port 4200) |
| `build` | `ng build` (production) |
| `watch` | `ng build --watch --configuration development` |
| `test` | `ng test` (Karma) |
| `test:e2e` | `playwright test` |
| `test:e2e:ui` | `playwright test --ui` |

### Production image (`Dockerfile`)
1. **Build**: `node:20-alpine`, `npm ci --include=dev`, `npm run build` → `dist/skytrix/browser/`.
2. **Runtime**: `nginx:alpine`, copies static files, copies `nginx.conf` → `/etc/nginx/conf.d/default.conf`. Exposes 80 + 443.

## Tests

- ~32 spec files, mostly under `pages/pvp/duel-page/` (24 specs covering chain state, animation orchestrator, board state, prompt dialog, etc.).
- A few specs in `pvp/`, `pvp/replay/`, `components/system-overlay/`.
- Single Playwright e2e suite: `e2e/cache-prefetch.spec.ts` (validates 3 cache/prefetch fixes from a post-audit; requires the local stack running with admin user + decks 19 & 20).

## Anomalies / known issues

1. **Dual state systems for auth** — UserDTO signal + RefreshStep BehaviorSubject. Consider unifying under signals after the audit settles.
2. **Solo-mode dual `DuelConnection`** — two instances per match; queue switching on player toggle. Necessary for dual-player orchestration but architecturally heavy. Document the state-transition edges if you touch this.
3. **`ReplayDuelAdapter` coupling** — adapts precomputed states into the live `DuelConnection` interface. ~25 reused duel-page services. Any breaking change to `DuelConnection`'s public surface affects replay.
4. **Prompt registry pattern** — `prompt-registry.ts` maps prompt-type strings to component constructors. Static type-safety trade-off for flexibility; if the prompt taxonomy keeps growing, consider a typed registry.
5. **Solo mode broadcast overhead** — server sends all duel messages to both players; the inactive connection buffers until switch. Memory footprint grows with game length; no observed cap.

## Where to look next

- Cross-part wiring + WebSocket protocol overview: [integration-architecture.md](./integration-architecture.md)
- Component catalogue: [component-inventory-front.md](./component-inventory-front.md)
- Annotated source tree: [source-tree-analysis.md](./source-tree-analysis.md)
- Dev/build/test recipes: [development-guide.md](./development-guide.md)
- AI agent rules (animation parity, locks, chain state): [../CLAUDE.md](../CLAUDE.md)
