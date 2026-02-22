CREATE TABLE IF NOT EXISTS live_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    CONSTRAINT chk_live_rooms_title_len CHECK (char_length(title) <= 120)
);

CREATE INDEX IF NOT EXISTS idx_live_rooms_active_created_at
    ON live_rooms (created_at DESC)
    WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_live_rooms_host_user_id
    ON live_rooms (host_user_id);
