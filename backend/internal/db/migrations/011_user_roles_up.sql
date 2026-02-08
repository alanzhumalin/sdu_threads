-- Add RBAC role for admin/moderation.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
    ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'moderator', 'admin'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

