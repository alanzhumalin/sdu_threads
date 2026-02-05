CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_reports_one_target CHECK (
        (target_post_id IS NOT NULL AND target_user_id IS NULL)
        OR (target_post_id IS NULL AND target_user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_target_post_id ON reports(target_post_id);
CREATE INDEX IF NOT EXISTS idx_reports_target_user_id ON reports(target_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);

