DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_chats_theme_key'
    ) THEN
        ALTER TABLE chats DROP CONSTRAINT chk_chats_theme_key;
    END IF;
END $$;

ALTER TABLE chats
DROP COLUMN IF EXISTS theme_key;
