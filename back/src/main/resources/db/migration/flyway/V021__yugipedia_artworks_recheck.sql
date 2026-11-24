-- Yugipedia artworks are re-checked when a card page changes, instead of once for all.
-- checked_at: last time the artwork list of the card was processed (the most recent one is the last sync).
-- artwork_count: artworks Yugipedia listed then; a changed page is only processed again when it lists more.
ALTER TABLE card ADD COLUMN yugipedia_artworks_checked_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE card ADD COLUMN yugipedia_artwork_count INTEGER;
UPDATE card SET yugipedia_artworks_checked_at = now() WHERE yugipedia_artworks_checked;
ALTER TABLE card DROP COLUMN yugipedia_artworks_checked;
