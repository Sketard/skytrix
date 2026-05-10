# Data Models — Backend

> PostgreSQL 16 schema, managed by Spring Data JPA + Flyway migrations. 11 entities. Default DB name `skytrix`. Migrations in `back/src/main/resources/db/migration/flyway/V*.sql`.

## Entity-relationship overview

```
              app_user
                │   │
   refreshToken │   │ role (USER|ADMIN)
                │   │
                │   ├── @ManyToMany favorite_cards (join table) ──┐
                │   │                                              │
                │   ├── @OneToMany Deck                            │
                │   │       ├── @OneToMany CardDeckIndex ────────  │
                │   │       │       │   └── @ManyToOne Card ───────┤
                │   │       │       └── @ManyToOne CardImage       │
                │   │       └── @OneToMany ImageIndex              │
                │   │               └── @ManyToOne CardImage       │
                │   ├── @OneToMany CardUserPossessed ─────────────  │
                │   │       └── @ManyToOne Card ──────────────────  │
                │   ├── @OneToMany Room (as player1)                │
                │   └── @OneToMany Room (as player2 nullable)       │
                │                                                   │
                └─ @OneToMany Replay (as player1 / player2)         │
                                                                    │
                                                                    │
   Card ◀──────────────────────────────────────────────────────────┘
     │
     ├── @OneToMany CardSet (cascade)
     ├── @OneToMany CardImage (cascade, EAGER)
     └── @OneToMany Translation (cascade, EAGER, FR / EN)

   Replay
     ├── metadata: JSONB
     └── replayData: JSONB
```

## Tables

### `app_user`

| Column | Type | Constraint | Note |
|---|---|---|---|
| id | bigserial | PK | |
| pseudo | varchar | unique, not null | username |
| password | varchar | not null | encoded |
| refresh_token | varchar | nullable | hashed; cleared on logout |
| role | varchar (enum: `USER` \| `ADMIN`) | not null, default `USER` | populated in V012 |

Relationships:
- `@ManyToMany favoriteCards` via `favorite_cards` join table.

### `card`

| Column | Type | Constraint | Note |
|---|---|---|---|
| id | bigserial | PK | internal ID |
| passcode | bigint | unique | external identifier from ygoprodeck.com |
| types | jsonb / List\<String\> | | flexible (V002 changed storage) |
| frame_type | varchar | | |
| atk | int | nullable | |
| def | int | nullable | |
| level | smallint | nullable | |
| scale | smallint | nullable | pendulum scale |
| linkval | smallint | nullable | link rating |
| race | varchar | | |
| attribute | varchar (enum) | | LIGHT/DARK/FIRE/WATER/WIND/EARTH/DIVINE |
| archetype | varchar | nullable | |
| linkmarkers | jsonb / List\<String\> | nullable | link arrow directions |
| ban_info | smallint | nullable | OCG/TCG ban status |
| genesys_point | int | nullable | added in V006 |
| first_tcg_release | date | nullable | |

Relationships:
- `@OneToMany sets` (CardSet, cascade ALL).
- `@OneToMany images` (CardImage, cascade ALL, **EAGER**).
- `@OneToMany translations` (Translation, cascade ALL, **EAGER**, languages FR/EN).
- `@ManyToMany favoritedBy` (User, inverse of `User.favoriteCards`).

> EAGER relationships are justified by the typical access pattern (always need the FR/EN name + at least one image) but can become expensive on bulk endpoints — watch for N+1 patterns when adding new flows.

### `card_set`

| Column | Type | Constraint |
|---|---|---|
| id | bigserial | PK |
| name | varchar | |
| code | varchar | |
| rarity | varchar | |
| rarity_code | varchar | |
| price | float | |
| card_id | bigint | FK → card.id |

### `card_image`

| Column | Type | Constraint | Note |
|---|---|---|---|
| id | bigserial | PK | |
| image_id | bigint | | external image ID |
| url | varchar | | full-size URL or local path |
| small_url | varchar | | thumbnail URL or local path |
| local | boolean | | full-size cached locally |
| small_local | boolean | | thumbnail cached locally |
| tcg_updated | boolean | default false | alternate art refreshed; reset by V015 |
| card_id | bigint | FK → card.id | |

### `translation`

| Column | Type | Constraint |
|---|---|---|
| id | bigserial | PK |
| name | varchar (length expanded in V007) | not null |
| description | text | nullable |
| language | varchar (enum: `FR`\|`EN`) | not null |
| card_id | bigint | FK → card.id |

### `deck`

| Column | Type | Constraint |
|---|---|---|
| id | bigserial | PK |
| name | varchar | not null |
| user_id | bigint | FK → app_user.id, lazy |

Relationships:
- `@OneToMany cardsIndexed` (CardDeckIndex, cascade ALL, orphan removal).
- `@OneToMany images` (ImageIndex, cascade ALL, orphan removal).

### `card_deck_index`

| Column | Type | Constraint | Note |
|---|---|---|---|
| id | bigserial | PK | |
| index | int | | ordering within zone |
| type | varchar (enum) | not null | `MAIN_DECK` / `EXTRA_DECK` / `SIDE_DECK` |
| card_id | bigint | FK → card.id | |
| selected_image_id | bigint | FK → card_image.id, lazy | added in V014 |
| deck_id | bigint | FK → deck.id, lazy | |

### `image_index`

| Column | Type | Constraint |
|---|---|---|
| id | bigserial | PK |
| index | int | |
| image_id | bigint | FK → card_image.id |
| deck_id | bigint | FK → deck.id, lazy |

### `card_user_possessed` (V009)

| Column | Type | Constraint |
|---|---|---|
| id | bigserial | PK |
| card_id | bigint | FK → card.id, not null |
| user_id | bigint | FK → app_user.id, not null |
| possessed_number | int | |

Replaces the legacy single-column `possessed_number` on `card` (V008 → V009 migration arc).

### `room` (V010)

| Column | Type | Constraint | Note |
|---|---|---|---|
| id | bigserial | PK | |
| room_code | varchar(6) | unique, not null | shareable code |
| player1_id | bigint | FK → app_user.id | |
| player2_id | bigint | FK → app_user.id, nullable | |
| player1_decklist_id | bigint | FK → deck.id | |
| player2_decklist_id | bigint | FK → deck.id, nullable | |
| status | varchar (enum: `WAITING`\|`READY`\|`DUELING`\|`FINISHED`) | | `RoomStatus` |
| duel_server_id | varchar | nullable | duel-server's session UUID |
| ws_token_1 | varchar | nullable | issued by duel-server |
| ws_token_2 | varchar | nullable | issued by duel-server |
| created_at | timestamp | not null, auto | |
| updated_at | timestamp | not null, auto | |

`ws_token_1` / `ws_token_2` are stored but **never returned** to clients via list endpoints — they are issued back to the **specific** player at room create / join time.

### `replay` (V013)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK, auto-generated |
| player1_id | bigint | FK → app_user.id, lazy, not null |
| player2_id | bigint | FK → app_user.id, lazy, not null |
| metadata | jsonb | |
| replay_data | jsonb | |
| created_at | timestamp | not null, auto |

The two JSONB columns are intentionally opaque from the schema's point of view — their TypeScript shape lives in the duel-server's `ws-protocol-replay.ts` (and the synced front-side mirror).

`metadata` carries: player usernames, deck names, durationMs, winner, RPS result, total responses, timestamps.

`replayData` carries: random seed, player responses array, deck contents (for replay precompute reproducibility), card-data version hash.

Retention: `replay.retention-days = 30` (configurable via `REPLAY_RETENTION_DAYS`). The `RoomCleanupScheduler` and a cleanup task remove expired entries.

## Migration history

| File | Purpose |
|---|---|
| V001 | Initial schema (cards, card_set, app_user, deck, favorite_cards) |
| V002 | Card types storage refactor |
| V003 | Add `favorite_cards` join table |
| V004 | Type/race/attribute reference data |
| V005 | Add `password`, `refresh_token`, `role` to `app_user` |
| V006 | Add `genesys_point` to `card` |
| V007 | Expand `translation.name` length |
| V008 | Add `possessed_number` to `card` (legacy single-column owned tracking) |
| V009 | Create `card_user_possessed` (replaces V008's column-based approach) |
| V010 | Create `room` schema (PvP) |
| V011 | Reconcile duplicate passcodes via `beta_id` fallback |
| V012 | Populate `role` column (default `USER`) |
| V013 | Create `replay` table (UUID PK, JSONB metadata + data) |
| V014 | Add `selected_image_id` to `card_deck_index` |
| V015 | Reset `tcg_updated` for alternate-art refetch |

`spring.flyway.out-of-order=true` is enabled — fine on a single-node deployment, risky on multi-node. No issues observed in the current sequence.

## Repository layer

Repositories extend `CrudRepository<Entity, ID> + JpaSpecificationExecutor<Entity>`. **Never** add a custom `@Query` if a Specification will do — the project's `findBy...` API consistently uses Specifications for filterable search.

Pagination MUST go through `CustomPageable<T>` — the helpers in `utils/CoreUtils.java` (`mapToList`, `filter`, `findAny`, `getNullSafe`) cover the common conversion patterns.
