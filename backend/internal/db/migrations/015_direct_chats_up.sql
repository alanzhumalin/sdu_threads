-- Direct (1:1) chats and messages.

CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind TEXT NOT NULL DEFAULT 'direct',
    direct_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_chats_kind CHECK (kind IN ('direct'))
);

-- For direct chats we store a stable sorted pair key (userA:userB)
-- so create-or-get can be race-safe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chats_direct_key
ON chats(direct_key)
WHERE direct_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chats_updated_at
ON chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user
ON chat_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created_at
ON messages(chat_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_chat_unread
ON messages(chat_id, read_at);
