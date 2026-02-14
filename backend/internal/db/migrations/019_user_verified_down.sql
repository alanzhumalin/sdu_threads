DROP INDEX IF EXISTS idx_users_is_verified_true;

ALTER TABLE users
    DROP COLUMN IF EXISTS is_verified;
