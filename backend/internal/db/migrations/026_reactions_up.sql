CREATE TABLE IF NOT EXISTS post_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_post_reactions_post_user_emoji UNIQUE (post_id, user_id, emoji),
    CONSTRAINT chk_post_reactions_emoji_len CHECK (char_length(emoji) BETWEEN 1 AND 16)
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post_id
ON post_reactions(post_id);

CREATE INDEX IF NOT EXISTS idx_post_reactions_user_id
ON post_reactions(user_id);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post_emoji
ON post_reactions(post_id, emoji);

CREATE TABLE IF NOT EXISTS message_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_message_reactions_message_user_emoji UNIQUE (message_id, user_id, emoji),
    CONSTRAINT chk_message_reactions_emoji_len CHECK (char_length(emoji) BETWEEN 1 AND 16)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id
ON message_reactions(message_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_user_id
ON message_reactions(user_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_emoji
ON message_reactions(message_id, emoji);
