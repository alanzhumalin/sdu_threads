package repository

import (
	"context"

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
