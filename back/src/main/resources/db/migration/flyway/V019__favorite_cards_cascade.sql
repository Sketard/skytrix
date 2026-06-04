-- F15 (2026-06-04) — align favorite_cards FKs with V018 favorite_replays
-- pattern: ON DELETE CASCADE on both sides.
--
-- Pre-V019, V003 declared favorite_cards FKs without an ON DELETE policy,
-- so the defaults left orphan rows when a user OR a card was deleted (the
-- delete itself failed if any favorite referenced the doomed row, blocking
-- user cleanup; or, depending on the operation, silently left rows pointing
-- at nonexistent ids). V018 (favorite_replays) shipped with CASCADE on both
-- FKs as the intended pattern. This migration retrofits the same on
-- favorite_cards.
--
-- Strategy: drop existing FK constraints, recreate with ON DELETE CASCADE.
-- Postgres auto-names the FK constraints when not declared inline; we drop
-- by name via the catalog so the migration survives a rename. The DO block
-- iterates `information_schema.table_constraints` for any FK on
-- favorite_cards and drops it, then we re-add the canonical pair.

DO $$
DECLARE
    fk_name TEXT;
BEGIN
    FOR fk_name IN
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'favorite_cards'
          AND constraint_type = 'FOREIGN KEY'
    LOOP
        EXECUTE format('ALTER TABLE favorite_cards DROP CONSTRAINT %I', fk_name);
    END LOOP;
END $$;

ALTER TABLE favorite_cards
    ADD CONSTRAINT favorite_cards_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;

ALTER TABLE favorite_cards
    ADD CONSTRAINT favorite_cards_card_id_fkey
    FOREIGN KEY (card_id) REFERENCES card(id) ON DELETE CASCADE;
