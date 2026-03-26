CREATE TABLE replay (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player1_id BIGINT NOT NULL REFERENCES app_user(id),
    player2_id BIGINT NOT NULL REFERENCES app_user(id),
    metadata JSONB NOT NULL,
    replay_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_replay_player1_created ON replay(player1_id, created_at DESC);
CREATE INDEX idx_replay_player2_created ON replay(player2_id, created_at DESC);
