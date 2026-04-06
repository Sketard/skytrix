ALTER TABLE card_deck_index ADD COLUMN selected_image_id BIGINT REFERENCES card_image(id) ON DELETE SET NULL;
