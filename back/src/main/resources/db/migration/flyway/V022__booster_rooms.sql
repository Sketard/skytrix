-- Booster mode: players open boosters of a set in the room, build a deck from
-- what they pulled, then duel. A booster room has no decklist up front.
ALTER TABLE room ALTER COLUMN player1_decklist_id DROP NOT NULL;
ALTER TABLE room ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE room ADD COLUMN booster_set_name VARCHAR(255);
ALTER TABLE room ADD COLUMN booster_count INTEGER;
ALTER TABLE room ADD COLUMN min_main_deck_size INTEGER;
ALTER TABLE room ADD COLUMN player1_ready BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE room ADD COLUMN player2_ready BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per pulled card. deck_zone (MAIN / EXTRA) is set once the player
-- puts that copy in the deck they submit; NULL = left in the pool.
CREATE TABLE room_booster_card (
    id BIGSERIAL PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES room(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES app_user(id),
    booster_index INTEGER NOT NULL,
    slot_index INTEGER NOT NULL,
    card_id BIGINT NOT NULL REFERENCES card(id),
    deck_zone VARCHAR(10),
    deck_index INTEGER
);
CREATE INDEX idx_room_booster_card_room_user ON room_booster_card(room_id, user_id);

-- Booster pools are drawn by set name.
CREATE INDEX IF NOT EXISTS card_set_idx_name ON card_set(name);
