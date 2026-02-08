-- Add moderation lifecycle fields to reports.
ALTER TABLE reports
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

ALTER TABLE reports
ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE reports
ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- Ensure status is one of the supported values.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_reports_status'
    ) THEN
        ALTER TABLE reports
        ADD CONSTRAINT chk_reports_status CHECK (status IN ('open', 'resolved', 'rejected'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_status_created_at ON reports(status, created_at DESC);

