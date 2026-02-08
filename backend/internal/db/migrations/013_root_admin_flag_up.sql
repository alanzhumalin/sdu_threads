-- Mark a bootstrap/root admin so it can be protected from role changes and hidden from other admins.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_root_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_root_admin ON users(is_root_admin);

