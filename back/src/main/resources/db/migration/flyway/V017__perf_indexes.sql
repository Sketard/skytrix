-- Performance indexes — lot L-BE2 of the perf-audit chantier
-- (_bmad-output/planning-artifacts/perf-audit-instrumentation-chantier.md).
--
-- Three indexes, all backing measured hot-path lookups. None change schema
-- semantics — pure read-path acceleration.

-- B-C4 — card.passcode lookups (getCardByCode, validatePasscodesOrThrow's
-- findAllByPasscodeIn) ran a Seq Scan on ~13k rows. Non-unique on purpose:
-- V011 reconciled duplicate passcodes, but a UNIQUE index would make this
-- migration fail outright on any residual duplicate. A plain index gives the
-- full read-path gain with zero migration risk; promoting to UNIQUE is a
-- separate, deliberate decision.
CREATE INDEX IF NOT EXISTS card_passcode_idx ON card (passcode);

-- B-C4 — app_user.pseudo: looked up on every login (CustomUserDetailsService).
-- Non-unique for the same reason — a known pseudo-uniqueness bug is still
-- open (see MEMORY: pvp-waiting-room-ready-state); a UNIQUE index could fail
-- the migration on existing duplicates.
CREATE INDEX IF NOT EXISTS app_user_pseudo_idx ON app_user (pseudo);

-- B-C3 — card name search / autocomplete. /cards/names runs
-- `LOWER(t.name) LIKE LOWER('%query%')` — a leading-wildcard LIKE that no
-- B-tree index can serve, so it did a Seq Scan over the whole translation
-- table (EXPLAIN ANALYZE: 26 049 rows scanned, 55 ms). The pg_trgm GIN
-- index makes a substring LIKE indexable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS translation_name_trgm_idx
    ON translation USING gin (LOWER(name) gin_trgm_ops);
