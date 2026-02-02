ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;

-- Дедуп просмотров на 15-минутные окна
CREATE TABLE IF NOT EXISTS post_view_windows (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    window_start TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (post_id, user_id, window_start)
);
