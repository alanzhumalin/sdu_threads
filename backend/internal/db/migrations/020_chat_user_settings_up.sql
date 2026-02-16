CREATE TABLE IF NOT EXISTS chat_user_settings (
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    theme_key TEXT NOT NULL DEFAULT 'default',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, user_id),
    CONSTRAINT chat_user_settings_theme_key_len_chk CHECK (char_length(theme_key) BETWEEN 1 AND 32)
);

CREATE INDEX IF NOT EXISTS idx_chat_user_settings_user_id
ON chat_user_settings(user_id);
