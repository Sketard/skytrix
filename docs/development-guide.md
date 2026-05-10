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

Hard rules (enforced by review and by `CLAUDE.md`):

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

### Duel server
- Read [CLAUDE.md](../CLAUDE.md) **before** touching `pages/pvp/duel-page/` or anything in `duel-server/src/`. Animation parity, chain state machine, lock contract, replay parity, and the `POLL-DROP REGRESSION` watchdog are non-negotiable.
- Configurable modules (`http-routes`, `replay-handlers`, `timer-management`, `solver-handlers`) MUST register their `isXxxConfigured()` in the boot invariant in `server.ts`.
- WebSocket protocol changes go in the relevant `ws-protocol-*.ts` sub-file, NEVER in the barrel — and the `check-ws-protocol-sync.mjs` script must pass.
- New animation-critical invariants use `duelAssert(condition, site, msg)` — never raw `if (isDevMode())`.
- New animation timing values go in `animation-constants.ts` with `*_MS` (base) and `*_MIN_MS` (floor) pairing.

## Git workflow

- Single `master` branch, no enforced naming convention for feature branches.
- No CI/CD pipeline detected.
- Commit messages follow Conventional Commits-ish style (`feat(area): ...`, `fix(area): ...`, `refactor(area): ...`, `test(area): ...`, `docs(...): ...`). Look at the recent log for tone.

## Adding a new card to the solver scoring

1. Open `_bmad-output/solver-data/interruption-tag-generation-prompt.md`.
2. Run the AI-assisted prompt with the cardIds you want to add.
3. Insert the resulting JSON entries into `duel-server/data/interruption-tags.json` with `_validated: false`.
4. Manually review and flip `_validated: true` for top-meta cards.
5. The schema accepts `sharedOpt`, `totalUsesPerTurn`, per-effect `trigger`, and audit metadata — the loader is forward-compatible.
6. **Critical**: get the per-effect `trigger` right — the OPT-aware scorer disambiguates effects on multi-effect cards by it. Wrong/missing triggers fall back to index 0 with a runtime warning.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `prebuild` fails on duel-server | `ws-protocol-*.ts` diverges between front and back | Edit both files identically |
| WS closes with code 4426 | Protocol version mismatch (client outdated) | Hard-refresh browser, rebuild front |
| `POLL-DROP REGRESSION` in console | Chain stuck without MSG_CHAIN_END | **Read [CLAUDE.md](../CLAUDE.md) §"Polling Removal — Regression Surface" first.** Don't reintroduce the poll. |
| `duelAssert` fires in dev | Animation invariant breach | The error message includes a `site` tag — grep for it |
| Backend won't boot | Flyway out-of-order disabled? | `application.properties` has `spring.flyway.out-of-order=true` by default |
| `404` on card images in dev | Images not yet downloaded | Run **Update images** in the front-end Paramètres page (admin only) |
| Card data sync hangs on YGOProDeck | Rate-limited (429) | The requester retries 3× with backoff. Wait or retry manually |
