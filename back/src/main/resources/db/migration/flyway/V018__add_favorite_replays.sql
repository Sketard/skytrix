CREATE TABLE favorite_replays(
    user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    replay_id UUID NOT NULL REFERENCES replay(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, replay_id)
);

CREATE INDEX favorite_replays_user_id_idx ON favorite_replays(user_id);
CREATE INDEX favorite_replays_replay_id_idx ON favorite_replays(replay_id);
