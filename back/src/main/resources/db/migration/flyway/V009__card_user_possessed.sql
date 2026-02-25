ALTER TABLE card DROP COLUMN IF EXISTS possessed_number;
CREATE TABLE card_user_possessed (
  id bigserial PRIMARY KEY,
  card_id bigint NOT NULL REFERENCES card(id),
  user_id bigint NOT NULL REFERENCES app_user(id),
  possessed_number int NOT NULL DEFAULT 1,
  CONSTRAINT uq_card_user_possessed UNIQUE (card_id, user_id)
);
