ALTER TABLE posts
  ADD COLUMN quoted_post_id uuid NULL;

ALTER TABLE posts
  ADD CONSTRAINT posts_quoted_post_id_fkey
    FOREIGN KEY (quoted_post_id) REFERENCES posts(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_quoted_post_id ON posts(quoted_post_id);
