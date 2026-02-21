ALTER TABLE users
    DROP COLUMN IF EXISTS temp_password_expires_at;

ALTER TABLE users
    DROP COLUMN IF EXISTS temp_password_hash;
