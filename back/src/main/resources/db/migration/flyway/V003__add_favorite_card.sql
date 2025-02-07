CREATE TABLE favorite_cards(
    user_id BIGINT REFERENCES app_user(id),
    card_id BIGINT REFERENCES card(id)
);

CREATE INDEX favorite_cards_user_id_idx on favorite_cards(user_id);
CREATE INDEX favorite_cards_card_id_idx on favorite_cards(card_id);