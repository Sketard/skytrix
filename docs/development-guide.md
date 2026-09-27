# Development Guide

How to set up, run, test, and develop on the skytrix monorepo locally.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Java | **21** | Backend (Spring Boot 3.4.2) |
| Maven | **>= 3.8** (or use the bundled `./mvnw` wrapper) | Backend build |
| Node | **>= 20** (Docker uses 24-slim) | Frontend + duel-server |
| npm | bundled with Node | Frontend + duel-server install |
| PostgreSQL | **16** (matches Docker stack) | Backend DB |
| Docker + Compose | latest | Recommended for full stack |

## Environment variables

Create a `.env` file at the repo root for `docker compose`. The values below match `docker-compose.yml`.

```env
POSTGRES_DB=skytrix
POSTGRES_USER=skytrix
POSTGRES_PASSWORD=replace-me

JWT_SECRET=at-least-60-chars-of-entropy-here-aaaaaaaaaaaaaaaaaaaa
INTERNAL_API_KEY=shared-secret-between-back-and-duel-server
CORS_ALLOWED_ORIGINS=http://localhost:4200,https://your-domain.example

DOMAIN=your-domain.example          # Only for the certbot service
TLS_CERT_DIR=./certs                # Override after Let's Encrypt issuance
```

For local non-Docker dev, set the matching env vars in your shell or in `back/src/main/resources/application.properties` (defaults are dev-friendly: `localhost:5432/skytrix`, JWT secret already filled, internal key `dev-internal-key`).

## First-time setup

```bash
# 1. Clone
git clone <repo>
cd skytrix

# 2. Backend
cd back && ./mvnw clean install -DskipTests && cd ..

# 3. Frontend
cd front && npm ci && cd ..

# 4. Duel server
cd duel-server && npm ci && npm run build && cd ..

# 5. Game data for the duel server
# See duel-server/DATA-SETUP.md — you need cards.cdb + scripts in duel-server/data/
```

After the stack is running and you have an admin account, go to **Paramètres** in the front-end and run, in order:
1. **Update cards** (fetches all card metadata from ygoprodeck.com)
2. **Update images** (downloads card art into `back/images/{small,big}/`)
3. **Update ban-list**
4. **Update images TCG** (alternate art refresh)
5. **Update duel-data** (sync cards.cdb + scripts into the duel-server volume)

## Run locally (no Docker)

Open three terminals:

```bash
# Terminal 1 — Postgres (any way you prefer; default port 5432, db skytrix)
# e.g. via brew services start postgresql, or a one-off docker run, etc.

# Terminal 2 — Backend
cd back
./mvnw spring-boot:run
# → http://localhost:8080/api (context-path is /api)
# → actuator on http://localhost:8081/actuator/health

# Terminal 3 — Duel server
cd duel-server
npm run start          # node dist/server.js, defaults to PORT=3001
# health: http://localhost:3001/health

# Terminal 4 — Frontend
cd front
npm start              # ng serve, listens on http://localhost:4200
# /api proxied to localhost:8080 (see proxy.conf.json)
```

WebSocket connections from the front-end go directly to the duel server over `ws://localhost:3001` in dev (configure in `src/environments/`).

## Run via Docker Compose

```bash
docker compose up -d            # builds, starts db, back, duel-server, front
docker compose logs -f back     # tail backend logs
docker compose down -v          # stop + remove volumes (wipes DB + images)
```

Production-style stack: front exposes 80/443, certbot renews TLS every 12 h. The DB sits on an `internal: true` Docker network — only the backend can reach it.

## Common dev commands

### Backend (Spring Boot)
```bash
cd back
./mvnw test                              # JUnit 5 + Mockito
./mvnw spring-boot:run                   # dev server with auto-reload (devtools if present)
./mvnw package -DskipTests               # build the runnable JAR
./mvnw flyway:info                       # show migration status
```

### Frontend (Angular)
```bash
cd front
npm start                                # ng serve
npm run build                            # production build → dist/skytrix/
npm run watch                            # incremental dev build to disk
npm test                                 # Karma + Jasmine (unit tests, all *.spec.ts)
npm run test:e2e                         # Playwright (cache-prefetch.spec.ts only)
npm run test:e2e:ui                      # Playwright UI mode
```

### Duel server (Node)
```bash
cd duel-server
npm run build                            # tsc, also runs prebuild = check-ws-protocol-sync.mjs
npm test                                 # vitest run (~60 spec files, mostly solver smoke tests)
npm run start                            # node dist/server.js
npm run poc                              # tsx src/test-core.ts (standalone ocgcore PoC)
npm run solver-poc                       # tsx src/solver-poc.ts (solver standalone)
```

The `prebuild` step runs `scripts/check-ws-protocol-sync.mjs` which **byte-compares** the 6 `ws-protocol-*.ts` sub-files in `front/src/app/pages/pvp/duel-ws.types.ts` against `duel-server/src/ws-protocol-*.ts` (modulo the trailing `.js` import suffix on the back side). If they diverge, the build fails. Always edit both sides at the same time.

## Coding standards

Hard rules (enforced by review ; the front linters, run by the pre-commit hook, catch part of them : [front/LINTING.md](../front/LINTING.md)):

### Backend
- All components: `@RestController` / `@Service` / `CrudRepository` + `JpaSpecificationExecutor`.
- DI: `@Inject` (Jakarta) — **never** `@Autowired`.
- DTO mapping: MapStruct mappers (`@Mapper(componentModel = "spring")`). Manual mapping is forbidden.
- Pagination: custom `CustomPageable<T>` wrapper — **never** Spring's `Page`/`Pageable`.
- Lombok on entities/DTOs (`@Data`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`).
- `@Transactional` on services that mutate.
- Flyway migrations are `V{NNN}__description.sql`. Out-of-order is **enabled** in dev — re-check before relying on it in shared environments.

### Frontend
- All components `standalone: true`. **No NgModules** for components.
- `ChangeDetection.OnPush` on every component.
- Signal-based inputs/outputs: `input<T>()`, `output<T>()` — never `@Input()`/`@Output()`.
- State via signals: `signal()`, `computed()`, `.set()`, `.update()`. RxJS only for HTTP/observables you genuinely need to compose.
- `@Injectable({ providedIn: 'root' })` for global services. Component-scoped services declared on the page component.
- Functional HTTP interceptors (`authInterceptor`, `loaderInterceptor`) — never class-based.
- Z-index via `styles/_z-layers.scss` tokens (`z.$z-*`), never inline.
- Notifications: `MatSnackBar.openFromComponent(SnackbarComponent)` via `displaySuccess`/`displayError` in `core/utilities/functions.ts`.
- Component selector prefix: `app`. Filenames: kebab-case. Classes: PascalCase.
- Prettier (single quotes, 2-space indent, printWidth 120, arrowParens avoid, bracketSameLine).

### Component DI changes — run Karma before commit (A6, 2026-05-31)

Adding a new `inject(X)` (required, i.e. without `{ optional: true }`) to
an Angular component or directive REQUIRES running the component's spec
through Karma before commit, not just `tsc --noEmit`. Reason : missing
testbed providers surface as runtime `NG0201 No provider for X` — `tsc`
cannot see this. Pre-commit hooks (`stylelint` + ESLint via lint-staged)
also miss it.

Precedent — F1 (`7943aef4`, 2026-05-30) added `inject(DuelLogger)` to
`pvp-prompt-dialog` + `prompt-card-grid` claiming "tsc green". The specs
were not run ; F23 (`2879d0f0`, 2026-05-31) paid the debt 16 days later
by providing `DuelLogger` in both specs.

Minimum command : `ng test --include="<path-to-spec>" --watch=false
--browsers=ChromeHeadless`. If a refactor pass touches many components,
run the full duel-page / replay-page spec batch.

### Duel server
- Read [docs/duel/](duel/README.md) **before** touching `pages/pvp/duel-page/` or anything in `duel-server/src/`. Animation parity, chain state machine, lock contract, replay parity, and the `POLL-DROP REGRESSION` watchdog are non-negotiable.
- Configurable modules (`http-routes`, `replay-handlers`, `timer-management`, `solver-handlers`) MUST register their `isXxxConfigured()` in the boot invariant in `server.ts`.
- WebSocket protocol changes go in the relevant `ws-protocol-*.ts` sub-file, NEVER in the barrel — and the `check-ws-protocol-sync.mjs` script must pass.
- New animation-critical invariants use `duelAssert(condition, site, msg)` — never raw `if (isDevMode())`.
- New animation timing values go in `animation-constants.ts` with `*_MS` (base) and `*_MIN_MS` (floor) pairing.

## Git workflow

- Single `master` branch, no enforced naming convention for feature branches.
- CI : `.github/workflows/protocol-sync.yml` runs the three `scripts/check-*.mjs` guards (WS protocol byte-sync, perspective isolation, animation parity) on every push to `master` / `feat/**` and on pull requests touching the protocol or duel-page files. It runs no tests and deploys nothing : `npm run verify` (build + tests of the three parts) runs locally, wired to the `pre-push` hook.
- Commit messages follow Conventional Commits-ish style (`feat(area): ...`, `fix(area): ...`, `refactor(area): ...`, `test(area): ...`, `docs(...): ...`). Look at the recent log for tone.

## Adding a new card to the solver scoring

The full procedure (how to invoke the prompt, schema notes) : [work/solver-data/interruption-tags-howto.md](../work/solver-data/interruption-tags-howto.md).

1. Open `work/solver-data/interruption-tag-generation-prompt.md`.
2. Run the AI-assisted prompt with the cardIds you want to add.
3. Insert the resulting JSON entries into `duel-server/data/interruption-tags.json` with `_validated: false`.
4. Manually review and flip `_validated: true` for top-meta cards.
5. The schema accepts `sharedOpt`, `totalUsesPerTurn`, per-effect `trigger`, and audit metadata — the loader is forward-compatible.
6. **Critical**: get the per-effect `trigger` right — the OPT-aware scorer disambiguates effects on multi-effect cards by it. Wrong/missing triggers fall back to index 0 with a runtime warning.

## Isolated dev-stack for e2e + Claude debug (`scripts/dev-stack.mjs`)

The Playwright e2e suite needs the full stack up (postgres + back + duel
+ front). Running the suite against the user's hand-driven stack on
canonical ports collides with whatever they're doing in the browser —
data writes from tests pollute the dev DB, the back can't reload on
code changes while a test holds a WS, etc. The fix : an **isolated
parallel stack on shifted ports** that the user's stack ignores
completely.

| Service       | User stack (canonical) | dev-stack (isolated)             |
|---------------|------------------------|----------------------------------|
| Postgres      | `:5432`                | `:15432` (Docker, dedicated vol) |
| back Spring   | `:8080` / `:8081`      | `:18080` / `:18081`              |
| duel-server   | `:3001`                | `:13001`                         |
| front Angular | `:4200`                | `:14200`                         |

**CLI** — `node scripts/dev-stack.mjs <cmd>` :

- `up [--only=db,back,duel,front]` — bring stack up (idempotent ; skips
  services already responding on their probe)
- `down [--only=...]` — stop managed services (`taskkill /T /F` on
  Windows ; SIGTERM→SIGKILL after 5s on POSIX)
- `restart <svc>` — `down` + `up` a single service (use after editing
  duel-server code : ~5s vs ~30s for a full `up`)
- `status` — table of pid / port / probe / uptime
- `logs <svc> [--tail=N]` — tail per-service log (default N=100)
- `sync-db` — `pg_dump` user's `:5432` → restore into `:15432` (needed
  to debug a specific replay/deck/user that lives only in the user's DB)
- `reset-db` — drop the Postgres volume + recreate (escape hatch when
  the isolated DB gets polluted by tests)
- `doctor` — pre-flight checks (Docker daemon, mvnw, port collisions)

**Playwright integration** — `playwright.config.ts` targets the user's
hand-driven stack on canonical ports (`:4200` / `:8080`) **by default**.
This matches the typical workflow where the user is actively coding in
the browser and wants Playwright to drive what they see.
`PW_AUTO_STACK=1` opt-in flips on `globalSetup` → `ensureStack()` for
the isolated stack on shifted ports — use this when Claude debugs e2e
without colliding with the user's session. `helpers.ts` reads
`E2E_BASE_URL` + `E2E_BACK_URL` env vars set by the config when
auto-stack is on ; otherwise it falls back to canonical URLs.

**Front config plumbing** — the `e2e` Angular configuration
(`angular.json`) swaps `environment.ts` → `environment.e2e.ts` (which
points `apiUrl` / `wsUrl` at the isolated ports) and uses
`src/proxy.e2e.conf.json` for the dev-server's `/api` rewrite.

**State** — `scripts/.dev-stack/` (gitignored) holds `pids.json` +
per-service `*.log` files. Log files are append-only across runs ;
delete the dir to start fresh.

**When to use what** :

- *User is running e2e against their own stack* → `npx playwright test`.
  Default config targets `:4200` / `:8080`. Assumes the user's stack is
  already up.
- *I (Claude) need to run e2e without colliding with user's session* →
  `PW_AUTO_STACK=1 npx playwright test`. `globalSetup` brings up whatever's
  missing in the isolated stack. First run is slow (~90s for cold back) ;
  subsequent runs reuse already-up services.
- *I need to inspect what the back/duel/front did during a test* → read
  `scripts/.dev-stack/{back,duel,front}.log` directly. They're written
  in real time, no harness involvement.
- *User changed duel-server code, I need to pick it up* →
  `node scripts/dev-stack.mjs restart duel` (~5s). HMR covers front
  changes ; back changes need `restart back` (slow, ~30s).
- *User wants me to debug a replay from their DB* → `node scripts/dev-stack.mjs sync-db`.
  Snapshots their entire DB into the isolated one. Re-run when they generate
  new replays.

**Pitfalls** :

- Postgres container survives `down` — its volume is persistent by
  design. Use `reset-db` to truly wipe.
- The Spring Boot back takes 30-60s to start (Hibernate + Flyway). First
  `up` of the session is the slow one ; idempotent re-`up` is ~2s.
- `ng serve --configuration e2e` rebuilds from scratch the first time
  (~30-60s). The build is cached on disk after that.
- Windows `taskkill /T /F` kills the whole process tree (mvnw → java,
  npm → node, npx → ng → node). Don't simplify to a plain `kill` — the
  parents are shims that don't propagate signals.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `prebuild` fails on duel-server | `ws-protocol-*.ts` diverges between front and back | Edit both files identically |
| WS closes with code 4426 | Protocol version mismatch (client outdated) | Hard-refresh browser, rebuild front |
| `POLL-DROP REGRESSION` in console | Chain stuck without MSG_CHAIN_END | **Read [duel/replay.md](duel/replay.md) §"Polling Removal — Regression Surface" first.** Don't reintroduce the poll. |
| `duelAssert` fires in dev | Animation invariant breach | The error message includes a `site` tag — grep for it |
| Backend won't boot | Flyway out-of-order disabled? | `application.properties` has `spring.flyway.out-of-order=true` by default |
| `404` on card images in dev | Images not yet downloaded | Run **Update images** in the front-end Paramètres page (admin only) |
| Card data sync hangs on YGOProDeck | Rate-limited (429) | The requester retries 3× with backoff. Wait or retry manually |
