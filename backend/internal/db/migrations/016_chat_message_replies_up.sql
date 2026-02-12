ALTER TABLE messages
ADD COLUMN IF NOT EXISTS reply_to_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_messages_reply_to_id'
    ) THEN
        ALTER TABLE messages
        ADD CONSTRAINT fk_messages_reply_to_id
            FOREIGN KEY (reply_to_id)
            REFERENCES messages(id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id
ON messages(reply_to_id);
