ALTER TABLE chats
ADD COLUMN IF NOT EXISTS theme_key TEXT NOT NULL DEFAULT 'default';

UPDATE chats c
SET theme_key = src.theme_key
FROM (
    SELECT DISTINCT ON (chat_id)
        chat_id,
        LOWER(BTRIM(theme_key)) AS theme_key
    FROM chat_user_settings
    WHERE LOWER(BTRIM(theme_key)) IN ('default', 'love', 'nature', 'sunset', 'ocean', 'midnight')
    ORDER BY chat_id, updated_at DESC, created_at DESC
) AS src
WHERE c.id = src.chat_id;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_chats_theme_key'
    ) THEN
        ALTER TABLE chats
        ADD CONSTRAINT chk_chats_theme_key
        CHECK (theme_key IN ('default', 'love', 'nature', 'sunset', 'ocean', 'midnight'));
    END IF;
END $$;
