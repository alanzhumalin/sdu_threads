CREATE TABLE IF NOT EXISTS message_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    width INT NOT NULL DEFAULT 0,
    height INT NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'image',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id
ON message_attachments(message_id);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_sort
ON message_attachments(message_id, sort_order, created_at, id);
