CREATE TABLE room (
    id BIGSERIAL PRIMARY KEY,
    room_code VARCHAR(6) NOT NULL UNIQUE,
    player1_id BIGINT NOT NULL REFERENCES app_user(id),
    player2_id BIGINT REFERENCES app_user(id),
    player1_decklist_id BIGINT NOT NULL REFERENCES deck(id),
    player2_decklist_id BIGINT REFERENCES deck(id),
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    duel_server_id VARCHAR(36),
    ws_token1 VARCHAR(36),
    ws_token2 VARCHAR(36),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_status ON room(status);
CREATE INDEX idx_room_room_code ON room(room_code);
