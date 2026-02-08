package repository

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"
)

type ReportRepository struct {
	db *gorm.DB
}

func NewReportRepository(db *gorm.DB) *ReportRepository {
	return &ReportRepository{db: db}
}

func (r *ReportRepository) Create(ctx context.Context, reporterID string, targetPostID any, targetUserID any, reason, details string) (string, error) {
	var id string
	q := `
INSERT INTO reports (reporter_id, target_post_id, target_user_id, reason, details)
VALUES (?, ?, ?, ?, ?)
RETURNING id`
	if err := r.db.WithContext(ctx).Raw(q, reporterID, targetPostID, targetUserID, reason, details).Scan(&id).Error; err != nil {
		return "", err
	}
	return id, nil
}

// ModerationReportRow is a report record enriched with related data for moderation UI.
type ModerationReportRow struct {
	ID                  string
	ReporterID          string
	ReporterUsername    string
	ReporterFullName    string
	ReporterAvatarURL   string
	TargetType          string
	PostID              string
	PostStatus          string
	PostContent         string
	PostAuthorID        string
	PostAuthorUsername  string
	PostAuthorFullName  string
	PostAuthorAvatarURL string
	PostRemovedAt       *time.Time
	TargetUserID        string
	TargetUsername      string
	TargetFullName      string
	TargetAvatarURL     string
	Reason              string
	Details             string
	Status              string
	CreatedAt           time.Time
	ResolvedBy          string
	ResolvedAt          *time.Time
	ResolutionNote      string
}

func (r *ReportRepository) ListModeration(ctx context.Context, status, query string, limit, offset int) ([]ModerationReportRow, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	st := strings.TrimSpace(strings.ToLower(status))
	qTrim := strings.TrimSpace(query)

	sql := ""
	args := make([]any, 0, 10)
	if r.db.Dialector.Name() == "postgres" {
		sql = `
SELECT r.id,
       r.reporter_id,
       ru.username AS reporter_username,
       ru.full_name AS reporter_full_name,
       COALESCE(ru.avatar_url, '') AS reporter_avatar_url,
       CASE WHEN r.target_post_id IS NOT NULL THEN 'post' ELSE 'user' END AS target_type,
       COALESCE(CAST(r.target_post_id AS TEXT), '') AS post_id,
       CASE
         WHEN r.target_post_id IS NULL THEN ''
         WHEN p.id IS NULL THEN 'not_found'
         WHEN p.removed_at IS NOT NULL THEN 'removed'
         ELSE 'active'
       END AS post_status,
       COALESCE(p.content, '') AS post_content,
       COALESCE(CAST(pu.id AS TEXT), '') AS post_author_id,
       COALESCE(pu.username, '') AS post_author_username,
       COALESCE(pu.full_name, '') AS post_author_full_name,
       COALESCE(pu.avatar_url, '') AS post_author_avatar_url,
       p.removed_at AS post_removed_at,
       COALESCE(CAST(r.target_user_id AS TEXT), '') AS target_user_id,
       COALESCE(tu.username, '') AS target_username,
       COALESCE(tu.full_name, '') AS target_full_name,
       COALESCE(tu.avatar_url, '') AS target_avatar_url,
       r.reason,
       COALESCE(r.details, '') AS details,
       r.status,
       r.created_at,
       COALESCE(CAST(r.resolved_by AS TEXT), '') AS resolved_by,
       r.resolved_at,
       COALESCE(r.resolution_note, '') AS resolution_note
FROM reports r
JOIN users ru ON ru.id = r.reporter_id
LEFT JOIN posts p ON p.id = r.target_post_id
LEFT JOIN users pu ON pu.id = p.user_id
LEFT JOIN users tu ON tu.id = r.target_user_id
WHERE 1=1`
		if st != "" {
			sql += `
  AND r.status = ?`
			args = append(args, st)
		}
		if qTrim != "" {
			pat := "%" + qTrim + "%"
			sql += `
  AND (
    CAST(r.id AS TEXT) ILIKE ?
    OR CAST(r.target_post_id AS TEXT) ILIKE ?
    OR CAST(r.target_user_id AS TEXT) ILIKE ?
    OR ru.username ILIKE ?
    OR ru.full_name ILIKE ?
    OR pu.username ILIKE ?
    OR pu.full_name ILIKE ?
    OR tu.username ILIKE ?
    OR tu.full_name ILIKE ?
  )`
			args = append(args, pat, pat, pat, pat, pat, pat, pat, pat, pat)
		}
		sql += `
ORDER BY r.created_at DESC
LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	} else {
		// sqlite-compatible fallback for tests/dev.
		sql = `
SELECT r.id,
       r.reporter_id,
       ru.username AS reporter_username,
       ru.full_name AS reporter_full_name,
       COALESCE(ru.avatar_url, '') AS reporter_avatar_url,
       CASE WHEN r.target_post_id IS NOT NULL THEN 'post' ELSE 'user' END AS target_type,
       COALESCE(r.target_post_id, '') AS post_id,
       CASE
         WHEN r.target_post_id IS NULL THEN ''
         WHEN p.id IS NULL THEN 'not_found'
         WHEN p.removed_at IS NOT NULL THEN 'removed'
         ELSE 'active'
       END AS post_status,
       COALESCE(p.content, '') AS post_content,
       COALESCE(pu.id, '') AS post_author_id,
       COALESCE(pu.username, '') AS post_author_username,
       COALESCE(pu.full_name, '') AS post_author_full_name,
       COALESCE(pu.avatar_url, '') AS post_author_avatar_url,
       p.removed_at AS post_removed_at,
       COALESCE(r.target_user_id, '') AS target_user_id,
       COALESCE(tu.username, '') AS target_username,
       COALESCE(tu.full_name, '') AS target_full_name,
       COALESCE(tu.avatar_url, '') AS target_avatar_url,
       r.reason,
       COALESCE(r.details, '') AS details,
       r.status,
       r.created_at,
       COALESCE(r.resolved_by, '') AS resolved_by,
       r.resolved_at,
       COALESCE(r.resolution_note, '') AS resolution_note
FROM reports r
JOIN users ru ON ru.id = r.reporter_id
LEFT JOIN posts p ON p.id = r.target_post_id
LEFT JOIN users pu ON pu.id = p.user_id
LEFT JOIN users tu ON tu.id = r.target_user_id
WHERE 1=1`
		if st != "" {
			sql += `
  AND r.status = ?`
			args = append(args, st)
		}
		if qTrim != "" {
			pat := "%" + qTrim + "%"
			sql += `
  AND (
    r.id LIKE ?
    OR r.target_post_id LIKE ?
    OR r.target_user_id LIKE ?
    OR ru.username LIKE ?
    OR ru.full_name LIKE ?
    OR pu.username LIKE ?
    OR pu.full_name LIKE ?
    OR tu.username LIKE ?
    OR tu.full_name LIKE ?
  )`
			args = append(args, pat, pat, pat, pat, pat, pat, pat, pat, pat)
		}
		sql += `
ORDER BY r.created_at DESC
LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}

	var items []ModerationReportRow
	if err := r.db.WithContext(ctx).Raw(sql, args...).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *ReportRepository) GetModeration(ctx context.Context, id string) (*ModerationReportRow, error) {
	idTrim := strings.TrimSpace(id)
	if idTrim == "" {
		return nil, gorm.ErrRecordNotFound
	}

	sql := ""
	args := []any{idTrim}
	if r.db.Dialector.Name() == "postgres" {
		sql = `
SELECT r.id,
       r.reporter_id,
       ru.username AS reporter_username,
       ru.full_name AS reporter_full_name,
       COALESCE(ru.avatar_url, '') AS reporter_avatar_url,
       CASE WHEN r.target_post_id IS NOT NULL THEN 'post' ELSE 'user' END AS target_type,
       COALESCE(CAST(r.target_post_id AS TEXT), '') AS post_id,
       CASE
         WHEN r.target_post_id IS NULL THEN ''
         WHEN p.id IS NULL THEN 'not_found'
         WHEN p.removed_at IS NOT NULL THEN 'removed'
         ELSE 'active'
       END AS post_status,
       COALESCE(p.content, '') AS post_content,
       COALESCE(CAST(pu.id AS TEXT), '') AS post_author_id,
       COALESCE(pu.username, '') AS post_author_username,
       COALESCE(pu.full_name, '') AS post_author_full_name,
       COALESCE(pu.avatar_url, '') AS post_author_avatar_url,
       p.removed_at AS post_removed_at,
       COALESCE(CAST(r.target_user_id AS TEXT), '') AS target_user_id,
       COALESCE(tu.username, '') AS target_username,
       COALESCE(tu.full_name, '') AS target_full_name,
       COALESCE(tu.avatar_url, '') AS target_avatar_url,
       r.reason,
       COALESCE(r.details, '') AS details,
       r.status,
       r.created_at,
       COALESCE(CAST(r.resolved_by AS TEXT), '') AS resolved_by,
       r.resolved_at,
       COALESCE(r.resolution_note, '') AS resolution_note
FROM reports r
JOIN users ru ON ru.id = r.reporter_id
LEFT JOIN posts p ON p.id = r.target_post_id
LEFT JOIN users pu ON pu.id = p.user_id
LEFT JOIN users tu ON tu.id = r.target_user_id
WHERE r.id = ?`
	} else {
		sql = `
SELECT r.id,
       r.reporter_id,
       ru.username AS reporter_username,
       ru.full_name AS reporter_full_name,
       COALESCE(ru.avatar_url, '') AS reporter_avatar_url,
       CASE WHEN r.target_post_id IS NOT NULL THEN 'post' ELSE 'user' END AS target_type,
       COALESCE(r.target_post_id, '') AS post_id,
       CASE
         WHEN r.target_post_id IS NULL THEN ''
         WHEN p.id IS NULL THEN 'not_found'
         WHEN p.removed_at IS NOT NULL THEN 'removed'
         ELSE 'active'
       END AS post_status,
       COALESCE(p.content, '') AS post_content,
       COALESCE(pu.id, '') AS post_author_id,
       COALESCE(pu.username, '') AS post_author_username,
       COALESCE(pu.full_name, '') AS post_author_full_name,
       COALESCE(pu.avatar_url, '') AS post_author_avatar_url,
       p.removed_at AS post_removed_at,
       COALESCE(r.target_user_id, '') AS target_user_id,
       COALESCE(tu.username, '') AS target_username,
       COALESCE(tu.full_name, '') AS target_full_name,
       COALESCE(tu.avatar_url, '') AS target_avatar_url,
       r.reason,
       COALESCE(r.details, '') AS details,
       r.status,
       r.created_at,
       COALESCE(r.resolved_by, '') AS resolved_by,
       r.resolved_at,
       COALESCE(r.resolution_note, '') AS resolution_note
FROM reports r
JOIN users ru ON ru.id = r.reporter_id
LEFT JOIN posts p ON p.id = r.target_post_id
LEFT JOIN users pu ON pu.id = p.user_id
LEFT JOIN users tu ON tu.id = r.target_user_id
WHERE r.id = ?`
	}

	var item ModerationReportRow
	if err := r.db.WithContext(ctx).Raw(sql, args...).Scan(&item).Error; err != nil {
		return nil, err
	}
	if item.ID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &item, nil
}

func (r *ReportRepository) Resolve(ctx context.Context, reportID, resolverID, status, note string) error {
	st := strings.TrimSpace(strings.ToLower(status))
	if st != "resolved" && st != "rejected" {
		return gorm.ErrInvalidData
	}
	n := strings.TrimSpace(note)

	sql := ""
	args := []any{st, resolverID, n, reportID}
	if r.db.Dialector.Name() == "postgres" {
		sql = `UPDATE reports SET status = ?, resolved_by = ?, resolved_at = now(), resolution_note = ? WHERE id = ? AND status = 'open'`
	} else {
		sql = `UPDATE reports SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, resolution_note = ? WHERE id = ? AND status = 'open'`
	}

	res := r.db.WithContext(ctx).Exec(sql, args...)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
