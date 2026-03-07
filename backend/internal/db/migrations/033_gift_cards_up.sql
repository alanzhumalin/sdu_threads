CREATE TABLE IF NOT EXISTS gift_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE,
    to_name TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    animation_type TEXT NOT NULL DEFAULT 'envelope',
    media_url TEXT NOT NULL DEFAULT '',
    media_type TEXT NOT NULL DEFAULT '',
    wishes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_expires_at ON gift_cards (expires_at);
CREATE INDEX IF NOT EXISTS idx_gift_cards_created_at ON gift_cards (created_at DESC);
