CREATE TABLE IF NOT EXISTS post_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);

-- Backfill for legacy posts that used posts.media_url only.
INSERT INTO post_media (post_id, url, sort_order)
SELECT p.id, p.media_url, 0
FROM posts p
WHERE p.media_url IS NOT NULL AND p.media_url <> ''
  AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id);

