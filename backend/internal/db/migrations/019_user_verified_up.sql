ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_verified_true
    ON users (is_verified)
    WHERE is_verified = TRUE;
