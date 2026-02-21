ALTER TABLE users
    ADD COLUMN IF NOT EXISTS temp_password_hash TEXT;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ;
