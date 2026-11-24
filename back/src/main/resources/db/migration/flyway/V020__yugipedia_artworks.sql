-- Alternate artworks imported from Yugipedia scans, next to the YGOPRODeck renders.
-- source: who provides the file (YGOPRODeck flows must never touch YUGIPEDIA rows).
-- source_file: Yugipedia file name of the scan, so an artwork is never imported twice.
ALTER TABLE card_image ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'YGOPRODECK';
ALTER TABLE card_image ADD COLUMN source_file VARCHAR(255);

-- Cards whose Yugipedia artwork list has been processed; the sync only handles the others.
ALTER TABLE card ADD COLUMN yugipedia_artworks_checked BOOLEAN NOT NULL DEFAULT FALSE;
