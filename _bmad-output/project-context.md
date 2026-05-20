---
project_name: 'skytrix'
user_name: 'Axel'
date: '2026-05-10'
sections_completed: ['repository_structure', 'technology_stack', 'language_rules', 'framework_rules', 'pvp_replay_rules', 'duel_server_rules', 'solver_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules']
status: 'complete'
optimized_for_llm: true
supersedes: '2026-02-07 single-app version (PvP/replay/solver/duel-server were unrepresented)'
---

# Project Context for AI Agents

_Critical rules and patterns AI agents must follow when implementing code. Focus on unobvious details. For deep architectural rules (animation parity, chain state, lock contract, replay parity, polling watchdog), see [`../CLAUDE.md`](../../CLAUDE.md). For generated reference docs, see [`../docs/`](../../docs/)._

---

## Repository Structure

**Multi-part monorepo with 3 deployable artifacts.**

| Part | Path | Stack |
|---|---|---|
| Backend | `back/` | Spring Boot 3.4.2 / Java 21 |
| Frontend | `front/` | Angular 21.2 SPA |
| Duel server | `duel-server/` | Node 24 + ocgcore-wasm |

Docker stack: `db` (postgres) ↔ `back` ↔ `duel-server` ↔ `front` (Nginx). Two networks: `skytrix-internal` (bridge), `skytrix-data` (`internal: true`, only back+db).

Features shipped:
- Deck management (search, builder, owned cards)
- Solo Simulator v1
- PvP Online Duels v1 (7 epics)
- PvP Replay Mode v1 (4 epics)
- Combo Path Solver v1 (R&D paused 2026-05-05)

---

## Technology Stack & Versions

### Frontend (`front/`)
- Angular 21.2 (standalone components, signals, OnPush)
- Angular Material 21.2 + CDK DragDrop
- TypeScript 5.9 (strict, target ES2022)
- RxJS 7.8.0 (sparse — auth refresh, deck list)
- ngx-translate 16.0.4 (FR default, EN supported)
- jspdf 2.5.1
- SCSS (`includePaths: src/app/styles`)
- Karma + Jasmine (unit), Playwright (e2e)
- Prettier 3.4.2

### Backend (`back/`)
- Java 21 / Spring Boot 3.4.2
- Spring Security + JWT (JJWT 0.12.6)
- Spring Data JPA / Hibernate (PostgreSQL 16 dialect)
- Flyway 11.2.0 (migrations, `out-of-order: true`)
- Lombok 1.18.36
- MapStruct 1.5.5 (`componentModel: spring`)
- Maven (with `mvnw` wrapper)
- JUnit 5 + Mockito (Spring Boot Starter Test)

### Duel Server (`duel-server/`)
- Node 24 (Docker `node:24-slim`)
- TypeScript ES2022, `module: nodenext`, strict
- `ws` (WebSocket server)
- `@n1xx1/ocgcore-wasm` (sync mode via `createCore({ sync: true })`)
- `better-sqlite3` (cards.cdb access)
- `piscina` (worker pool: replay precompute + solver)
- `zod` (runtime validation)
- `vitest` (tests)
- `@anthropic-ai/sdk` (vendored, not on live solver path yet)

### Infrastructure
- Docker Compose (4 services + certbot)
- Nginx + Let's Encrypt (Certbot every 12 h)
- API proxy in dev: `/api` → `localhost:8080` (front `proxy.conf.json`)
- Servlet context-path: `/api`
- Image storage: mounted volume `images_data` → `back:/app/images/{small,big}/`
- Card data volume: `duel_data` → `duel-server:/app/data/`

---

## Critical Implementation Rules

### Language-Specific Rules

#### TypeScript (frontend + duel-server)

- Strict mode: `strict: true`, `noImplicitReturns`, `strictTemplates: true`, `strictInjectionParameters: true`, `strictInputAccessModifiers: true`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`.
- Target ES2022 — use modern JS (optional chaining, nullish coalescing).
- Frontend: `useDefineForClassFields: false` — required for Angular decorator compatibility, do NOT change.
- Frontend module resolution: `node`. Duel-server: `nodenext`.
- Prettier enforced (single quotes, 2-space, trailing comma es5, printWidth 120, arrowParens avoid, bracketSameLine true).

#### Java (backend)

- Java 21 — modern features (records, pattern matching, sealed classes) where appropriate.
- Use `@Inject` (Jakarta) — **NEVER** `@Autowired`.
- Lombok on entities/DTOs (`@Data`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`).
- MapStruct for **all** DTO ↔ Entity mapping — never manual mapping in services.
- `@Transactional` on services that mutate data.
- `var` for local type inference where it improves readability.

### Framework-Specific Rules

#### Angular (frontend)

- ALL components MUST be `standalone: true`. NO NgModules for components.
- Signal-based I/O: `input<T>()` and `output<T>()` — never `@Input()`/`@Output()`.
- ChangeDetection MUST be `OnPush`.
- State via signals: `signal()`, `computed()`, `.set()`, `.update()`. RxJS holdouts intentional only (auth refresh BehaviorSubject, deck list).
- Services use `@Injectable({ providedIn: 'root' })` for global; component-scoped for feature graphs (PvP/replay/solver).
- Functional HTTP interceptors (`authInterceptor`, `loaderInterceptor`) — never class-based.
- Reactive forms with typed `TypedForm<T>`.
- Routing: flat `app.routes.ts`. Lazy on `pvp/**` and `solver/**` only.
- AuthService implements `canActivate` directly on the service class.
- i18n: ngx-translate with JSON in `assets/i18n/{fr,en}.json`.
- Notifications: `MatSnackBar.openFromComponent(SnackbarComponent)` via `displaySuccess` / `displayError` in `core/utilities/functions.ts`.
- Z-index: centralized in `styles/_z-layers.scss` — always `@use 'z-layers' as z` and reference `z.$z-*` tokens.
- Component prefix: `app`. File names: kebab-case. Class names: PascalCase.

#### Spring Boot (backend)

- Layered: Controller → Service → Repository.
- Controllers: `@RestController` + `@RequestMapping("/resource")` + explicit `@ResponseStatus`.
- Repositories: `CrudRepository` + `JpaSpecificationExecutor` for dynamic queries (no `@Query` if a Specification will do).
- Mappers: abstract classes with `@Mapper(componentModel = "spring")`, `@AfterMapping` for complex logic.
- Security: stateless JWT, Bearer token, refresh via HTTP-only `Refresh` cookie + `Access` cookie; login uses HTTP Basic.
- Flyway: `V{NNN}__description.sql` in `db/migration/flyway/`. Out-of-order enabled.
- External API calls: dedicated `requester` package (e.g. `YugiproRequester` for ygoprodeck.com).
- Custom pagination: `CustomPageable<T>` — **NEVER** Spring's `Page` / `Pageable`.
- Utility helpers: `CoreUtils.{mapToList, filter, findAny, getNullSafe}`.

#### Duel server (Node)

- All four configurable modules (`http-routes`, `replay-handlers`, `timer-management`, `solver-handlers`) MUST be configured before `wss.on('connection')`. The boot invariant in `server.ts` throws otherwise — never bypass.
- New configurable module → add `isXxxConfigured()` to the boot block. That block is the regression fence for the `createConfigurable<T>` pattern.
- New WS message type → add it to the matching `ws-protocol-*.ts` sub-file (shared / game / prompts / system / replay / solver), NEVER the barrel.
- Front and back `ws-protocol-*.ts` are byte-synced by `scripts/check-ws-protocol-sync.mjs` (modulo `.js` import suffix on duel-server). Edits MUST land on both sides — script runs as duel-server `prebuild`.
- Protocol version mismatch closes the WS with code **4426**. Every connection service in front MUST handle `event.code === 4426` distinctly to surface "client outdated, refresh" instead of an infinite reconnect loop.
- Solver connection lifecycle: `attachSolverConnection` returns `{ kind: 'limit' | 'attached' (replaced?) }`; `detachSolverConnection` is idempotent and race-safe with replace.
- Server-side chain state: `ChainStateTracker.applyChainTransition(state, message)` is pure and tested.

### PvP / Replay / Animation Rules (must read [`../CLAUDE.md`](../../CLAUDE.md))

These are the most-violated rules. Quick recap:

1. **Animation Parity Rule.** Any animation in `AnimationOrchestratorService` MUST work through the `AnimationDataSource` interface, `RenderedBoardStateService`, and `DuelEventProcessor`. The orchestrator MUST NOT import `DuelWebSocketService` or `DuelConnection` directly.
2. **Chain Event Processing.** `DuelEventProcessor` is the single source of truth for chain state (activeChainLinks, chainPhase, animation queue). Both `DuelConnection` (PvP) and `ReplayDuelAdapter` (replay) delegate to their own processor. `MSG_CHAIN_NEGATED` is consumed silently by the processor.
3. **Replay Board State Parity.** Replay must provide equivalent intermediate board states so `updateLogical()` + `syncRendered()` produce the same rendered state as PvP. Replay MUST NOT call `commitAll()` (reserved for `abort()` / `jumpToState()`); it uses `syncRendered()` to respect the lock contract.
4. **`boardStateAfter` parity.** `ChainSnapshotTracker` (`duel-server/src/chain-snapshot-tracker.ts`) is the **same class** in `runDuelLoop` (live PvP, `duel-worker.ts`) and `runReplayPreComputation` (replay precompute, `replay-precompute.ts`). The attach predicate, field name, and timing are identical by construction.
5. **Lock Contract.** Async event handlers in `processEvent()` MUST call `lockZone()` on ALL zones they animate (source AND destination) **synchronously before the first `await`**. `commitUnlocked()` runs immediately after `processEvent()` returns — any unlocked zone is committed.
6. **`POLL-DROP REGRESSION` watchdog.** If you ever see `[POLL-DROP REGRESSION]` in `console.error` or a `duelAssert` fires with site `POLL-DROP-REGRESSION`, **read CLAUDE.md §"Polling Removal — Regression Surface" before investigating anything else.** Don't reintroduce the chain-poll back-off — find the missing event/signal upstream first.
7. **`duelAssert(condition, site, msg)`** for ALL animation-critical invariants. Never raw `if (isDevMode())`.
8. **Animation timing constants** in `animation-constants.ts`. Naming: `*_MS` (base), `*_MIN_MS` (floor), `*_TIMEOUT_MS` (safety, wrapped in `safetyTimeout`).

### Solver Rules

- `data/interruption-tags.json` is the SoT for interruption scoring. Forward-compatible loader (entries without `sharedOpt` / `totalUsesPerTurn` / `_validated` still load).
- **Per-effect `trigger` field is critical** — OPT-aware scorer disambiguates multi-effect cards by it. Wrong/missing triggers fall back to index 0 with a runtime warning.
- Adding new entries: AI-assisted prompt at `_bmad-output/solver-data/interruption-tag-generation-prompt.md`. Insert with `_validated: false`. Human flips `true` for top-meta cards.
- ML rankers (`src/solver/ml/`) preserved for future re-investment despite paused R&D.

### Testing Rules

- Frontend: Karma + Jasmine. Files colocated as `*.spec.ts`. `tsconfig.spec.json` with `zone.js/testing` polyfill.
- Frontend e2e: Playwright (single suite `e2e/cache-prefetch.spec.ts` — requires local stack + admin/admin + decks 19 & 20).
- Backend: Spring Boot Starter Test (JUnit 5 + Mockito).
- Duel server: vitest. ~20 spec files + 50+ smoke tests in `solver/`. Tests at the boundary (`chain-snapshot-tracker`, `chain-state-tracker`, `duel-session-manager`, `response-validation`, `replay-precompute`, `wasm-snapshot`, `lru-map`, `message-filter`, `ws-rate-limit`, `timer-management`, `inactivity-timer`).
- No enforced minimum coverage threshold currently. Big-bang rollout: no automated tests until full MVP done.

### Code Quality & Style Rules

#### File & folder structure

- **Front**: `components/` (reusable), `pages/` (routed views), `services/`, `core/` (directives, enums, interceptors, model, pipes, utilities). Page-scoped services live next to the page component.
- **Back**: `controller/`, `service/`, `repository/`, `model/{entity,dto,enums}`, `mapper/`, `config/`, `security/`, `requester/`, `utils/`, `exception/`, `scheduler/`. DTOs by domain: `dto/{card,deck,replay,room,user,yugipro}`.
- **Duel server**: flat `src/` for protocol / lifecycle / chain / HTTP / replay / solver-handlers, plus `src/solver/` (43 files) and `src/validation/`.

#### Naming conventions

- Frontend files: kebab-case (`card-search.service.ts`, `deck-builder.component.ts`).
- Frontend classes: PascalCase (`CardSearchService`, `DeckBuilderComponent`).
- Frontend suffixes: `.component.ts`, `.service.ts`, `.pipe.ts`, `.directive.ts`.
- Backend classes: PascalCase + suffix (`CardController`, `CardService`, `CardRepository`, `CardDTO`, `CardMapper`).
- Backend methods: camelCase.
- Constants: UPPER_SNAKE_CASE.
- Enums: PascalCase values mirroring string (`FUSION = 'FUSION'`).

#### Documentation

- Code is self-documenting — minimal comments.
- No JSDoc/Javadoc enforcement.
- For non-obvious WHY (workarounds, hidden invariants), add a one-line comment.
- DO NOT add `// removed`, `// unused`, or rename-marker comments. If something is unused, delete it.

### Development Workflow Rules

- Git: single `master` branch, no enforced branch naming.
- No CI/CD pipeline detected.
- Frontend dev: `ng serve` with proxy to `localhost:8080`.
- Backend: `./mvnw spring-boot:run` (port 8080) + actuator on 8081.
- Duel server: `npm run start` after `npm run build` (port 3001).
- Database: Flyway auto-migrates on startup.
- Card data sync: manual via Paramètres admin page (fetch from ygoprodeck.com).
- Image management: `card_images.zip` unzipped in backend folder; missing images fetched via Paramètres.

### Critical Don't-Miss Rules

#### Anti-patterns to avoid

- NEVER use NgModules — fully standalone.
- NEVER use `@Autowired` — always `@Inject` (Jakarta).
- NEVER use class-based interceptors — functional only.
- NEVER use `@Input()`/`@Output()` decorators — signal-based `input()`/`output()`.
- NEVER use Spring's `Page`/`Pageable` — use `CustomPageable<T>`.
- NEVER manually map DTOs in services — always MapStruct.
- NEVER edit the `ws-protocol.ts` barrel — edit a sub-file.
- NEVER skip the duel-server boot invariant — register `isXxxConfigured()` for new configurable modules.
- NEVER reintroduce the chain-poll back-off (see CLAUDE.md `POLL-DROP REGRESSION`).
- NEVER call `commitAll()` from replay (reserved for `abort()` / `jumpToState()`).
- NEVER read `renderedState().turnCount` or `phase` and combine with zone content during animations — use `logicalState()` instead.

#### Authentication gotchas

- JWT secret in `application.properties` is dev-only; `JWT_SECRET` env var overrides in prod.
- Access token in `Access` HTTP-only cookie (TTL ≈ 16.7 h).
- Refresh token in `Refresh` HTTP-only `Secure` `SameSite=Strict` cookie (TTL 24 h), hashed in DB.
- Auth interceptor handles 401 with automatic refresh via a `BehaviorSubject<RefreshStep>` queue.
- Login uses HTTP Basic auth (different from all other endpoints).
- Internal duel-server endpoints (`POST /replays`, `GET /internal/replays/{id}`) authed via `X-Internal-Key` header.

#### Data model gotchas

- Card has translations (multilingual) — default display lang is FR.
- Card types stored as `List<String>` (jsonb), not enum — flexible.
- Card images have separate small/big storage paths on disk.
- Deck cards: `index` field for ordering, `type` field (MAIN_DECK, EXTRA_DECK, SIDE_DECK).
- Passcode is the unique external identifier for cards (from ygoprodeck.com).
- 18 physical zones in the simulator (not 20) — ST1/ST5 double as Pendulum L/R (Master Rule 5).
- `Record<ZoneId, CardInstance[]>` zone-centric data model in the simulator.
- Replays: UUID PK, two `jsonb` columns (`metadata`, `replayData`).

#### Security

- CORS env-driven (`CORS_ALLOWED_ORIGINS`); default permissive in dev.
- CSRF disabled (API-only backend).
- JWT secret in plain text in `application.properties` — use env var in prod.
- DB on `internal: true` Docker network — no external traffic.
- Replay endpoints `POST /replays` and `GET /internal/replays/{id}` are X-Internal-Key gated.
- Image path traversal possible via `DocumentService` if user-controlled URLs introduced — current data is internal only.

#### Domain-specific (Yu-Gi-Oh!)

- **MR5 (Master Rule 5)** — OCGCore FieldState EMZ slots both exist for player 0; ownership resolves to whichever is occupied.
- **MR5 ED summon destination** — restriction (EMZ / linked zone only) applies ONLY to Link + Pendulum-from-face-up-ED. Fusion / Synchro / Xyz go anywhere.
- **YGO move from/to matters** — triggers check BOTH origin and destination locations.
- **Tear deck shuffle / archetype mechanics** — verify Axel's archetype-mechanics one-liners against rule sources first.
- **`link-arrows.json`** — extracted source of truth for link monster arrows.

---

## Usage Guidelines

**For AI agents:**

- Read this file before implementing any code.
- For PvP / replay / animation work: also read [`../../CLAUDE.md`](../../CLAUDE.md) cover-to-cover.
- For architectural reference: see [`../docs/`](../../docs/) (generated via `/bmad-document-project`).
- Follow ALL rules exactly as documented.
- When in doubt, prefer the more restrictive option.
- Update this file if new patterns emerge.

**For humans:**

- Keep this file lean and focused on agent needs.
- Update when stack or major architectural rule changes.
- Review periodically for outdated rules.
- Remove rules that become obvious over time.
- Re-run `/bmad-document-project` when major features ship to refresh `docs/` and this file.

Last Updated: 2026-05-10
