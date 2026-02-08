ALTER TABLE reports
DROP CONSTRAINT IF EXISTS chk_reports_status;

DROP INDEX IF EXISTS idx_reports_status_created_at;

ALTER TABLE reports
DROP COLUMN IF EXISTS resolution_note;

ALTER TABLE reports
DROP COLUMN IF EXISTS resolved_at;

ALTER TABLE reports
DROP COLUMN IF EXISTS resolved_by;

ALTER TABLE reports
DROP COLUMN IF EXISTS status;

