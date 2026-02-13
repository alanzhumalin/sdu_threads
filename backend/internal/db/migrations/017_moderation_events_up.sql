CREATE TABLE IF NOT EXISTS moderation_events (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
    scope text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL DEFAULT '',
    target_id text NOT NULL DEFAULT '',
    blocked boolean NOT NULL DEFAULT true,
    reason text NOT NULL DEFAULT '',
    score double precision NOT NULL DEFAULT 0,
    source text NOT NULL DEFAULT '',
    matched_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
    labels jsonb NOT NULL DEFAULT '{}'::jsonb,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_events_created_at
    ON moderation_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_events_scope
    ON moderation_events (scope);

CREATE INDEX IF NOT EXISTS idx_moderation_events_actor_user_id
    ON moderation_events (actor_user_id);
