-- Reconcile duplicate cards caused by pre-release passcodes (YGOProDeck creates
-- a new entry when the official TCG passcode is assigned, leaving the old pre-release
-- entry orphaned). For each pair with the same EN name and stats, we keep the newer
-- card (which has the official passcode) and migrate all references from the old one.

-- Step 1: Migrate card_deck_index references from old card to new card
UPDATE card_deck_index cdi
SET card_id = dups.new_id
FROM (
    SELECT DISTINCT ON (c1.id) c1.id AS old_id, c2.id AS new_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
    ORDER BY c1.id, c2.id DESC
) dups
WHERE cdi.card_id = dups.old_id;

-- Step 2: Migrate favorite_cards references
UPDATE favorite_cards fc
SET card_id = dups.new_id
FROM (
    SELECT DISTINCT ON (c1.id) c1.id AS old_id, c2.id AS new_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
    ORDER BY c1.id, c2.id DESC
) dups
WHERE fc.card_id = dups.old_id
  AND NOT EXISTS (
    SELECT 1 FROM favorite_cards fc2
    WHERE fc2.card_id = dups.new_id AND fc2.user_id = fc.user_id
  );

-- Delete old favorites that would conflict (user already favorites the new card)
DELETE FROM favorite_cards fc
USING (
    SELECT c1.id AS old_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
) dups
WHERE fc.card_id = dups.old_id;

-- Step 3: Migrate card_user_possessed references
UPDATE card_user_possessed cup
SET card_id = dups.new_id
FROM (
    SELECT DISTINCT ON (c1.id) c1.id AS old_id, c2.id AS new_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
    ORDER BY c1.id, c2.id DESC
) dups
WHERE cup.card_id = dups.old_id
  AND NOT EXISTS (
    SELECT 1 FROM card_user_possessed cup2
    WHERE cup2.card_id = dups.new_id AND cup2.user_id = cup.user_id
  );

-- Delete old possessed that would conflict
DELETE FROM card_user_possessed cup
USING (
    SELECT c1.id AS old_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
) dups
WHERE cup.card_id = dups.old_id;

-- Step 4: Delete child records of old cards

-- Delete image_index entries referencing card_image rows we're about to remove
DELETE FROM image_index ii
USING card_image ci, (
    SELECT c1.id AS old_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
) dups
WHERE ci.card_id = dups.old_id
  AND ii.image_id = ci.id;

DELETE FROM card_image ci
USING (
    SELECT c1.id AS old_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
) dups
WHERE ci.card_id = dups.old_id;

DELETE FROM card_set cs
USING (
    SELECT c1.id AS old_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
) dups
WHERE cs.card_id = dups.old_id;

DELETE FROM translation t
USING (
    SELECT c1.id AS old_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
) dups
WHERE t.card_id = dups.old_id;

-- Step 5: Delete old (pre-release) cards
DELETE FROM card c
USING (
    SELECT c1.id AS old_id
    FROM card c1
    JOIN translation t1 ON t1.card_id = c1.id AND t1.language = '1'
    JOIN translation t2 ON t2.card_id != c1.id AND t2.language = '1' AND t2.name = t1.name
    JOIN card c2 ON c2.id = t2.card_id
    WHERE c1.atk IS NOT DISTINCT FROM c2.atk
      AND c1.def IS NOT DISTINCT FROM c2.def
      AND c1.level IS NOT DISTINCT FROM c2.level
      AND c1.frame_type IS NOT DISTINCT FROM c2.frame_type
      AND c1.id < c2.id
) dups
WHERE c.id = dups.old_id;
