CREATE TABLE IF NOT EXISTS post_music (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'upload',
    track_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    audio_url TEXT NOT NULL,
    duration_sec INT NOT NULL DEFAULT 0,
    clip_start_sec INT NOT NULL DEFAULT 0,
    clip_end_sec INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_music_post_id ON post_music(post_id);
