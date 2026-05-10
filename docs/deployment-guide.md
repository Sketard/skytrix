# Deployment Guide

How to deploy the skytrix stack to a single VM with TLS, log rotation, and basic hardening.

## Topology

```
                          Internet
                              |
                       :80, :443 (TLS)
                              v
                  +-----------+-----------+
                  |   front (Nginx)        |   exposed
                  |   nginx.conf           |
                  +-----------+-----------+
                              |
                              v   skytrix-internal (Docker bridge)
                  +---+-------+-------+---+
                  |   |               |   |
                  v   v               v   v
              +------+ +-------+ +---------+ +-----------+
              | back | | duel- | | certbot | (renewals)  |
              | :8080| | server| +---------+
              | :8081|<- HTTP -| :3001 |
              +------+ +-------+
                  |
                  v   skytrix-data (internal: true, no external access)
              +------+
              | db   |   PostgreSQL 16, pg_isready healthcheck
              | :5432|
              +------+
```

## Compose stack (`docker-compose.yml`)

The stack is fully described in `docker-compose.yml`. Highlights:

| Service | Image | Resources | Notes |
|---|---|---|---|
| `db` | postgres:16-alpine | 256m / 0.5 CPU | `internal: true` network, healthcheck via `pg_isready` |
| `back` | built from `back/Dockerfile` | 768m / 1.0 CPU | depends on `db` healthy, healthcheck via `actuator/health` (port 8081) |
| `duel-server` | built from `duel-server/Dockerfile` | 128m / 0.5 CPU | depends on `back` healthy, healthcheck via `/health` |
| `front` | built from `front/Dockerfile` | 64m / 0.25 CPU | exposes 80/443, depends on `back` + `duel-server` |
| `certbot` | certbot/certbot:latest | — | renew loop (every 12 h) using `--webroot` |

All services have:
- `restart: unless-stopped`
- `security_opt: [no-new-privileges:true]`
- `pids_limit: 100` (300 for back)
- JSON-file logs capped at `50 MB × 5` rotated.

## Required `.env`

```env
# Database
POSTGRES_DB=skytrix
POSTGRES_USER=skytrix
POSTGRES_PASSWORD=<strong-password>

# Auth + cross-service
JWT_SECRET=<60+ char random string>
INTERNAL_API_KEY=<shared secret between back and duel-server>

# CORS
CORS_ALLOWED_ORIGINS=https://your-domain.example

# TLS
DOMAIN=your-domain.example
TLS_CERT_DIR=./certs                  # before Let's Encrypt: temp/self-signed
                                      # after: /etc/letsencrypt/live/${DOMAIN}
```

## First deploy

```bash
# 1. Clone on the target host
git clone <repo>
cd skytrix
cp .env.example .env && $EDITOR .env  # fill values

# 2. (Optional) put a temporary self-signed cert in ./certs/
#    so nginx can boot and certbot can solve the HTTP-01 challenge

# 3. Bring everything up except certbot
docker compose up -d db back duel-server front

# 4. Issue Let's Encrypt cert
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d ${DOMAIN} \
  --email your@email.com --agree-tos --no-eff-email

# 5. Switch TLS_CERT_DIR in .env
sed -i 's|TLS_CERT_DIR=.*|TLS_CERT_DIR=/etc/letsencrypt/live/'${DOMAIN}'|' .env

# 6. Restart front to pick up real certs, start cert renewal loop
docker compose up -d front certbot

# 7. Bootstrap card data (one-time)
#    - register an admin user in the front
#    - go to Paramètres → run all import buttons in order
```

## Healthchecks

| Service | Endpoint | What it asserts |
|---|---|---|
| db | `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` | DB accepts connections |
| back | `http://localhost:8081/actuator/health` (separate management port) | Spring Boot liveness, DB connectivity |
| duel-server | `http://localhost:3001/health` | Returns 200 if `isDataReady`, else 503 (data still loading) |

## Build details

### Backend (`back/Dockerfile`)
Multi-stage:
- **Build**: `maven:3.9-eclipse-temurin-21`, copies `pom.xml` + `src/`, runs `mvn package -DskipTests`.
- **Runtime**: `eclipse-temurin:21-jre-alpine`, installs `curl` (for healthcheck), copies the JAR, creates `images/{small,big}` directories, exposes 8080.
- Entry: `java $JAVA_OPTS -jar app.jar`. JAVA_OPTS in compose: `-XX:+UseG1GC -Xmx512m`.

### Frontend (`front/Dockerfile`)
Multi-stage:
- **Build**: `node:20-alpine`, `npm ci --include=dev`, `npm run build` → `dist/skytrix/browser/`.
- **Runtime**: `nginx:alpine`, copies built static files into `/usr/share/nginx/html`, copies `nginx.conf` to `/etc/nginx/conf.d/default.conf`. Exposes 80 + 443.

### Duel server (`duel-server/Dockerfile`)
Single stage:
- Base: `node:24-slim`.
- Installs `curl`, `git`, `ca-certificates`.
- Copies `scripts/check-ws-protocol-sync.mjs` from repo root, then `package*.json` and `duel-server/`.
- Runs `npm ci` + `npm run build` (which runs the protocol sync check first).
- Exposes 3001. CMD: `node dist/server.js`.

## Volumes

| Volume | Mounted at | Purpose |
|---|---|---|
| `postgres_data` | `db:/var/lib/postgresql/data` | DB persistence |
| `images_data` | `back:/app/images` | Card images cache (small + big) |
| `duel_data` | `duel-server:/app/data` | `cards.cdb`, scripts, solver-config, ML weights, etc. |
| `./logs/back` | `back:/app/logs` | App logs (rotated by app) |
| `./logs/nginx` | `front:/var/log/nginx` | Access + error logs (rotated by `logrotate-nginx.conf`) |
| `${TLS_CERT_DIR}` | `front:/etc/nginx/certs:ro` | TLS certs |
| `./certbot-webroot` | `front + certbot:/var/www/certbot` | HTTP-01 challenge dir |
| `/etc/letsencrypt` | `certbot:/etc/letsencrypt` | Let's Encrypt account/state on host |

## Network isolation

Two Docker networks:

- **skytrix-internal** (bridge): `front`, `back`, `duel-server`. The reverse proxy talks to `back:8080` and `duel-server:3001` via service DNS.
- **skytrix-data** (bridge, `internal: true`): `back` and `db` only. With `internal: true`, Docker actively blocks any external traffic — even from within the host. The DB has no published port.

## Nginx (`front/nginx.conf`) at a glance

- 80 → 301 → 443 (everything except `/.well-known/acme-challenge/`)
- 443 with TLSv1.2 + TLSv1.3
- Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Rate limits:
  - `/api/login`, `/api/create-account`: 10 req/min per IP, burst 5
  - `/api/client-logs`: 10 req/min per IP, burst 20
- Upstreams: `http://back:8080` (REST), `ws://duel-server:3001` (WebSocket)
- Correlated access log format with request ID.

## Updating in production

```bash
git pull
docker compose build              # rebuilds back/front/duel-server images
docker compose up -d              # rolls services with healthcheck-gated dependencies
```

For schema changes:
- The Spring Boot service runs Flyway on boot (`spring.flyway.enabled=true`, `spring.flyway.out-of-order=true`).
- New migrations land in `back/src/main/resources/db/migration/flyway/V{NNN}__*.sql`.

For card data refresh:
- Use the **Paramètres** admin UI (it runs `/api/parameters/update-cards`, `/update/images`, `/update/ban-list`, `/update/duel-data`).
- These endpoints are async on the backend — long-running, don't time out the front-end request.

## Backups

Not automated by the stack. To back up the DB:

```bash
docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB | gzip > skytrix-$(date -u +%FT%TZ).sql.gz
```

Card images (`images_data` volume) are reproducible from ygoprodeck.com — re-running **Update images** restores them.

## Production gotchas

- **CORS** is permissive by default in `application.properties` (allowed origins from env var). In prod, set `CORS_ALLOWED_ORIGINS` to your real domain only.
- **JWT secret** in `application.properties` is dev-only — `.env` `JWT_SECRET` overrides it. **Never commit a real secret.**
- **Out-of-order migrations** (`spring.flyway.out-of-order=true`) is convenient in dev but risky on multi-node deployments. Single-node here, so it's tolerable.
- **Image path traversal**: `DocumentService` reads paths from `CardImage.url` directly. The data is internal but harden if you ever expose user-controlled URLs.
- **Unbounded card-favorite list**: `GET /api/cards/favorites/remove` returns the full owned list — no pagination. Long-time users will see growing payloads.
- **Solo-mode buffered messages** (PvP solo p1↔p2 view swap): no hard cap on the inactive-side buffer. Long solo sessions could grow memory.
- **Replay retention**: `replay.retention-days=30` controls deletion. Override via `REPLAY_RETENTION_DAYS` env var.
