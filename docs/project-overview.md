# Skytrix — Project Overview

> Yu-Gi-Oh! deck management web app + solo combo simulator + online PvP duels (with replays) + automated combo path solver.

## What this project is

Skytrix is a **multi-feature web application** for Yu-Gi-Oh! TCG/OCG players. It bundles four largely independent feature stacks behind a single Angular SPA:

| Feature | Purpose | Status |
|---|---|---|
| **Deck Management** | Card search, deck builder, owned-card tracking, import/export | shipped |
| **Solo Simulator** | Hand-test simulator: physical board (18 zones), command stack, undo/redo | v1 shipped |
| **PvP Online Duels** | Live multiplayer duels driven by ocgcore (real Yu-Gi-Oh! rules engine) over WebSocket | v1 shipped (7 epics) |
| **Replay Mode** | Server-side precomputed replay viewer with scrubber, timeline, fork-from-decision | v1 shipped (4 epics) |
| **Combo Path Solver** | Automated combo finder with interruption scoring + ML rankers | v1 shipped (R&D paused 2026-05-05) |

## Repository structure

This is a **multi-part monorepo** with three deployable artifacts plus shared planning artifacts.

```
skytrix/
├── back/                   # Spring Boot 3.4.2 + Java 21 (REST API, PostgreSQL, JWT auth)
├── front/                  # Angular 20.3 (SPA: deck mgmt + simulator + PvP + replay + solver)
├── duel-server/            # Node + ocgcore (WebSocket: PvP duels, replay precompute, solver pool)
├── docs/                   # Generated documentation (this directory)
├── _bmad/                  # BMAD config + scripts
├── _bmad-output/           # PRDs, architecture specs, UX specs, epics, retros, R&D logs
├── docker-compose.yml      # 4-service production stack (db / back / duel-server / front)
└── CLAUDE.md               # AI agent instructions (animation parity, chain state, lock contract, ...)
```

## Repository type

**Multi-part monorepo** with two clear network tiers:

- **Data tier**: `back` ↔ `db` only (`skytrix-data` Docker network is `internal: true` — no external traffic).
- **Internal tier**: `front` ↔ `back` ↔ `duel-server` (`skytrix-internal` bridge network).
- **Public tier**: `front` only (Nginx exposes 80/443).

## Tech stack at a glance

| Layer | Technology |
|---|---|
| Frontend | Angular 20.3, Material 20.2, CDK DragDrop, TypeScript 5.9 strict, RxJS 7.8.0, ngx-translate 16.0.4, Karma+Jasmine, Playwright (e2e) |
| Backend | Java 21, Spring Boot 3.4.2, Spring Security + JWT (JJWT 0.12.6), Spring Data JPA, PostgreSQL 16, Flyway 11.2.0, Lombok, MapStruct 1.5.5 |
| Duel Server | Node 24, TypeScript ES2022 strict, `ws`, `@n1xx1/ocgcore-wasm`, `better-sqlite3`, `piscina` (worker pool), `vitest`, `zod` |
| Infra | Docker Compose, Nginx (Let's Encrypt via Certbot), JSON-file logs (50 MB × 5 rotated) |

## Architecture pattern

- **Backend** — Layered service architecture (Controller → Service → Repository) with MapStruct DTO mapping and stateless JWT auth.
- **Frontend** — Component-based SPA using **signals + OnPush** as the canonical state primitive. NgModules are banned. Lazy routes used only for `pvp`, `replay`, and `solver`.
- **Duel Server** — Event-driven WebSocket server. Each PvP duel runs ocgcore in a dedicated **worker thread** (`duel-worker.ts:runDuelLoop`). Replay precompute and solver run on **Piscina pools**. The 4 service-side modules (`http-routes`, `replay-handlers`, `timer-management`, `solver-handlers`) follow a strict `createConfigurable<T>(name)` two-phase init contract enforced by a boot invariant.

## Cross-part integration points

```
[ Browser ]
    |
    | HTTP/REST + WebSocket (TLS)
    v
[ Nginx (front container) ]  -- proxies /api → back, /duel-server → duel-server
    |
    +--> [ Angular SPA ]
              |
              | /api/* (REST, JWT in cookies)
              v
         [ Spring Boot (back) ]
              |
              +--> [ PostgreSQL (db) ]                       (JPA, internal network)
              |
              +--> [ duel-server HTTP /api/duels ]           (X-Internal-Key)
              |    └── creates duel session, gets ws tokens
              |
              +--> [ ygoprodeck.com REST ]                   (card data ingest)
              |
   [ Angular SPA ] -- WebSocket directly --> [ duel-server WS ]
              ?mode=duel|replay|solver, JWT in query
```

See [integration-architecture.md](./integration-architecture.md) for the full inter-part contract.

## Per-part architecture documents

- [Backend (Spring Boot)](./architecture-back.md)
- [Frontend (Angular)](./architecture-front.md)
- [Duel Server (Node + ocgcore)](./architecture-duel-server.md)

## Where to look for more

| Need | File |
|---|---|
| Click around the docs | [index.md](./index.md) |
| Folder layout (annotated) | [source-tree-analysis.md](./source-tree-analysis.md) |
| Run / build / deploy | [development-guide.md](./development-guide.md), [deployment-guide.md](./deployment-guide.md) |
| Backend REST endpoints | [api-contracts-back.md](./api-contracts-back.md) |
| Backend SQL schema | [data-models-back.md](./data-models-back.md) |
| WebSocket protocol | [api-contracts-duel-server.md](./api-contracts-duel-server.md) |
| Frontend components | [component-inventory-front.md](./component-inventory-front.md) |
| AI agent rules (animation parity, chain state, lock contract) | [../CLAUDE.md](../CLAUDE.md) |
| Feature PRDs / epics / UX specs | [`_bmad-output/planning-artifacts/`](../_bmad-output/planning-artifacts/) |
