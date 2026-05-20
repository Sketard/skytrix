# Skytrix — Documentation Index

> Generated 2026-05-10 by `/bmad-document-project` (deep scan, multi-part). Primary AI retrieval entry point. Start here.

## Project at a glance

- **Type:** multi-part monorepo, 3 deployable artifacts
- **Domain:** Yu-Gi-Oh! deck management + solo simulator + online PvP duels (replays) + automated combo solver
- **Primary languages:** Java 21 (back), TypeScript 5.9 (front), TypeScript 5.5.4 (duel-server)
- **Architecture:** layered REST (back) ↔ standalone Angular SPA (front) ↔ event-driven WebSocket worker server (duel-server)
- **Status:** all 4 features shipped (simulator v1, PvP v1, replay v1, solver v1 — solver R&D paused 2026-05-05)

## Quick reference by part

### back (Spring Boot)
- **Type:** backend
- **Stack:** Java 21, Spring Boot 3.4.2, Spring Security + JWT (JJWT 0.12.6), Spring Data JPA, PostgreSQL 16, Flyway 11.2.0, Lombok, MapStruct 1.5.5, Maven
- **Root:** [back/](../back/)
- **Port:** 8080 (REST), 8081 (Actuator)
- **Architecture:** [architecture-back.md](./architecture-back.md)

### front (Angular SPA)
- **Type:** web
- **Stack:** Angular 20.3, Material 20.2 + CDK, TypeScript 5.9 strict, RxJS 7.8.0, ngx-translate 16.0.4 (FR default), jspdf, SCSS, Karma+Jasmine, Playwright
- **Root:** [front/](../front/)
- **Port:** 80 / 443 (Nginx)
- **Architecture:** [architecture-front.md](./architecture-front.md)

### duel-server (Node + ocgcore)
- **Type:** backend
- **Stack:** Node 24, TypeScript ES2022 strict, `ws`, `@n1xx1/ocgcore-wasm`, `better-sqlite3`, `piscina`, `vitest`, `zod`
- **Root:** [duel-server/](../duel-server/)
- **Port:** 3001 (WebSocket + internal HTTP)
- **Architecture:** [architecture-duel-server.md](./architecture-duel-server.md)

## Generated documentation

### Project-wide
- [Project Overview](./project-overview.md) — what this is, where to look, repo type
- [Source Tree Analysis](./source-tree-analysis.md) — annotated directory layout per part
- [Integration Architecture](./integration-architecture.md) — how the 3 parts talk (REST + WS + internal HTTP)
- [Development Guide](./development-guide.md) — prerequisites, setup, run, test, coding standards
- [Deployment Guide](./deployment-guide.md) — Docker Compose stack, TLS, networks, healthchecks

### Per-part architecture
- [Backend (Spring Boot)](./architecture-back.md)
- [Frontend (Angular)](./architecture-front.md)
- [Duel Server (Node + ocgcore)](./architecture-duel-server.md)

### API & data contracts
- [Backend REST API](./api-contracts-back.md) — every `@RestController` endpoint
- [Duel Server HTTP + WebSocket](./api-contracts-duel-server.md) — internal HTTP + 6-file WS protocol
- [Backend Data Models](./data-models-back.md) — JPA entities + Flyway migration history

### Frontend reference
- [Component Inventory](./component-inventory-front.md) — ~75 components categorized

### Machine-readable
- [project-parts.json](./project-parts.json) — parts + integration points + shared protocol metadata
- [project-scan-report.json](./project-scan-report.json) — workflow state snapshot

## Existing documentation in the repo

- [README.md](../README.md) — minimal install / setup checklist (FR)
- [CLAUDE.md](../CLAUDE.md) — **MUST READ** before touching PvP / replay / animation / chain code. Contains:
  - Animation parity rule (DataSource interface)
  - Chain state machine (`DuelEventProcessor` as single SOT)
  - Replay parity rule (`ChainSnapshotTracker` shared on both sides)
  - Lock contract for async event handlers
  - Pre-lock handle ownership rules
  - Buffer replay batch construction (3-pass: interleave, session lock, group flush)
  - syncAfterBoardState sync tiers
  - LP commit discipline
  - Pre-computation timeline rules
  - Polling removal — regression surface (`POLL-DROP REGRESSION` watchdog)
  - Server module configuration pattern (`createConfigurable<T>`)
  - WS protocol module split + boot invariant
- [`_bmad-output/project-context.md`](../_bmad-output/project-context.md) — AI agent rules (regenerated alongside this scan)
- [duel-server/DATA-SETUP.md](../duel-server/DATA-SETUP.md) — `cards.cdb` + scripts setup

### Planning / R&D artifacts
- [`_bmad-output/planning-artifacts/`](../_bmad-output/planning-artifacts/)
  - PRDs: `prd.md`, `prd-pvp.md`, `prd-solver.md`
  - Architecture: `architecture.md`, `architecture-pvp.md`, `architecture-solver.md`
  - UX specs: `ux-design-specification.md`, `*-pvp.md`, `*-replay.md`, `*-solver.md`
  - Epics: `epics.md`, `epics-pvp.md`, `epics-replay.md`, `epics-solver.md`
  - References: `yugioh-game-rules.md`, `ocgcore-technical-reference.md`
  - Audits: `ux-audit-pvp-replay-2026-05-08.md`, `cancel-rollback-contract.md`, `implementation-readiness-report-*.md`
- [`_bmad-output/solver-data/`](../_bmad-output/solver-data/)
  - `interruption-tag-generation-prompt.md` — AI-assisted prompt for `interruption-tags.json` entries
  - `path-beta-methodology.md`
  - `graph-ml-v1/methodology.md`

## Getting started

### Newcomer to the codebase
1. Read [project-overview.md](./project-overview.md) for the 30 000 ft view.
2. Skim [integration-architecture.md](./integration-architecture.md) so you know which part owns what.
3. Pick the architecture doc for the part you're working on.
4. **If touching PvP / replay / animation, read [`../CLAUDE.md`](../CLAUDE.md) cover-to-cover first.**

### About to build something locally
- Follow [development-guide.md](./development-guide.md) — prerequisites, env vars, first-time card data sync.
- For full stack: `docker compose up -d` after filling `.env`.
- For dev only: 4 terminals (Postgres + back + duel-server + front).

### About to deploy
- Read [deployment-guide.md](./deployment-guide.md).
- Stack is single-VM Docker Compose with Let's Encrypt (Certbot every 12 h).
- DB is on an `internal: true` network — never publish its port.

### Adding a new feature
| Where it lives | Refer to |
|---|---|
| New REST endpoint | [api-contracts-back.md](./api-contracts-back.md) + [architecture-back.md](./architecture-back.md) |
| New WS message type | [api-contracts-duel-server.md](./api-contracts-duel-server.md) — edit a `ws-protocol-*.ts` sub-file (front + back) |
| New page or feature | [architecture-front.md](./architecture-front.md) — flat routing in `app.routes.ts`, lazy if heavy |
| New animation | [`../CLAUDE.md`](../CLAUDE.md) Animation Parity Rule — must work via `AnimationDataSource` |
| New solver scoring | [development-guide.md](./development-guide.md#adding-a-new-card-to-the-solver-scoring) — go through the AI-assisted prompt |
| New DB column | New Flyway migration `V016__*.sql` + adjust the entity + DTO + mapper + tests |

## Verification recap (from this scan)

- Tests / extractions executed: source-tree enumeration via 3 parallel `Explore` subagents (back / front / duel-server). Cross-referenced with `CLAUDE.md` rules and `_bmad-output/project-context.md`.
- Outstanding risks or follow-ups (see per-part anomalies):
  - `RoomService:73` pessimistic lock around external HTTP call.
  - `message-filter.ts:213` Story 4.2 player-index conversion not yet deployed.
  - `_bmad-output/project-context.md` was outdated (2026-02-07, pre-PvP) — refreshed by this scan.
  - `out-of-order` Flyway is enabled; tolerable on single-node.
- Recommended next checks before PR:
  - If you generated this doc as part of a feature branch, re-run the scan after merge to capture changes.
  - The `ws-protocol-*.ts` sync check is part of duel-server's prebuild — ensure it passes locally.
