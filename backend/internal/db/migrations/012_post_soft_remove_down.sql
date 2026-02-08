DROP INDEX IF EXISTS idx_posts_removed_at;

ALTER TABLE posts
DROP COLUMN IF EXISTS removed_reason;

ALTER TABLE posts
DROP COLUMN IF EXISTS removed_by;

ALTER TABLE posts
DROP COLUMN IF EXISTS removed_at;

