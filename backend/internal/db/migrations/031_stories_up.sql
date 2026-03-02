CREATE TABLE IF NOT EXISTS stories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    media_url TEXT NOT NULL,
    media_type TEXT NOT NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
    CONSTRAINT stories_media_type_chk CHECK (media_type IN ('image', 'video'))
);

CREATE INDEX IF NOT EXISTS idx_stories_expires_at
    ON stories (expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_stories_user_created
    ON stories (user_id, created_at DESC);
