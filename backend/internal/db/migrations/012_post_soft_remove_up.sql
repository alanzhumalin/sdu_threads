-- Soft-remove fields for moderation.
ALTER TABLE posts
ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

ALTER TABLE posts
ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE posts
ADD COLUMN IF NOT EXISTS removed_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_removed_at ON posts(removed_at);

