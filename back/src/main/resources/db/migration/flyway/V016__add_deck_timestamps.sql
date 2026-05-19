-- Add created_at + updated_at timestamps to the deck table so the front
-- can sort the deck list by "most recently updated" (Wave B-2, deck-list
-- alignment spec, 2026-05-18).
--
-- Backfill strategy: existing decks get NOW() for both columns — the
-- historical edit dates are not available anywhere, and using a single
-- shared timestamp simply tells the user "we don't know when these were
-- last edited; they sort together until the next save bumps updated_at".

ALTER TABLE deck
    ADD COLUMN created_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE;

UPDATE deck SET created_at = NOW(), updated_at = NOW() WHERE created_at IS NULL;

ALTER TABLE deck
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT NOW(),
    ALTER COLUMN updated_at SET DEFAULT NOW();

CREATE INDEX idx_deck_updated_at ON deck (updated_at DESC);
