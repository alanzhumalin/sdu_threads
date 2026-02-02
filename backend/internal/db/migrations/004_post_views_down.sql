DROP TABLE IF EXISTS post_view_windows;
ALTER TABLE posts
    DROP COLUMN IF EXISTS view_count;
