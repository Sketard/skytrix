CREATE TABLE app_user (
    id bigserial primary key,
    pseudo varchar(64)
);

CREATE TABLE card (
    id bigserial primary key,
    archetype varchar(255),
    atk int,
    def int,
    attribute varchar(64),
    level int2,
    linkmarkers varchar[],
    linkval int2,
    passcode bigint,
    ban_info int2,
    race varchar(64),
    type varchar(255),
    first_tcg_release date,
    frame_type varchar(255),
    scale int2
);

CREATE TABLE deck (
    id bigserial primary key,
    name varchar(64),
    user_id bigint references app_user(id)
);
CREATE INDEX deck_idx_user_id on deck(user_id);

CREATE TABLE card_deck_index (
    id bigserial primary key,
    index int,
    type varchar(32),
    card_id bigint references card(id),
    deck_id bigint references deck(id)
);
CREATE INDEX card_deck_index_idx_deck_id on card_deck_index(deck_id);
CREATE INDEX card_deck_index_idx_card_id on card_deck_index(card_id);

CREATE TABLE card_image (
    id bigserial primary key,
    image_id bigint,
    url varchar(255),
    small_url varchar(255),
    local boolean,
    small_local boolean,
    tcg_updated boolean,
    card_id bigint references card(id)
);
CREATE INDEX card_image_idx_card_id on card_image(card_id);

CREATE TABLE card_set (
    id bigserial primary key,
    name varchar(255),
    code varchar(64),
    rarity varchar(255),
    rarity_code varchar(64),
    price float,
    card_id bigint references card(id)
);
CREATE INDEX card_set_idx_card_id on card_set(card_id);

CREATE TABLE card_possessed (
    id bigserial primary key,
    number int,
    user_id bigint references app_user(id),
    card_set_id bigint references card_set(id)
);
CREATE INDEX card_possessed_idx_card_set_id on card_possessed(card_set_id);
CREATE INDEX card_possessed_idx_user_id on card_possessed(user_id);

CREATE TABLE translation (
    id bigserial primary key,
    description text,
    language varchar(2),
    name varchar(64),
    card_id bigint references card(id)
);
CREATE INDEX translation_idx_card_id on translation(card_id);

CREATE TABLE image_index (
    id bigserial primary key,
    index int,
    image_id bigint references card_image(id),
    deck_id bigint references deck(id)
);
CREATE INDEX image_index_idx_image_id on image_index(image_id);
CREATE INDEX image_index_idx_deck_id on image_index(deck_id);
