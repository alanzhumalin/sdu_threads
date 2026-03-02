package repository

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"gorm.io/gorm"
)

type StoryRepository struct {
	db *gorm.DB
}

func NewStoryRepository(db *gorm.DB) *StoryRepository {
	return &StoryRepository{db: db}
}

type StoryRow struct {
	ID              string         `gorm:"column:id"`
	UserID          string         `gorm:"column:user_id"`
	Content         string         `gorm:"column:content"`
	MediaURL        string         `gorm:"column:media_url"`
	MediaType       string         `gorm:"column:media_type"`
	Width           int            `gorm:"column:width"`
	Height          int            `gorm:"column:height"`
	CreatedAt       time.Time      `gorm:"column:created_at"`
	ExpiresAt       time.Time      `gorm:"column:expires_at"`
	UserLastStoryAt time.Time      `gorm:"column:user_last_story_at"`
	Username        string         `gorm:"column:username"`
	FullName        string         `gorm:"column:full_name"`
	IsVerified      bool           `gorm:"column:is_verified"`
	AvatarURL       sql.NullString `gorm:"column:avatar_url"`
}

func (r *StoryRepository) Create(
	ctx context.Context,
	userID string,
	content string,
	mediaURL string,
	mediaType string,
	width int,
	height int,
) (*StoryRow, error) {
	var row StoryRow
	if err := r.db.WithContext(ctx).Raw(`
		INSERT INTO stories (user_id, content, media_url, media_type, width, height)
		VALUES (?, ?, ?, ?, ?, ?)
		RETURNING id, user_id, content, media_url, media_type, width, height, created_at, expires_at
	`, userID, content, mediaURL, mediaType, width, height).Scan(&row).Error; err != nil {
		return nil, err
	}
	if strings.TrimSpace(row.ID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, nil
}

func (r *StoryRepository) ListActive(ctx context.Context) ([]StoryRow, error) {
	var rows []StoryRow
	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			s.id,
			s.user_id,
			s.content,
			s.media_url,
			s.media_type,
			s.width,
			s.height,
			s.created_at,
			s.expires_at,
			MAX(s.created_at) OVER (PARTITION BY s.user_id) AS user_last_story_at,
			u.username,
			u.full_name,
			u.is_verified,
			u.avatar_url
		FROM stories s
		JOIN users u ON u.id = s.user_id
		WHERE s.expires_at > now()
		ORDER BY user_last_story_at DESC, s.user_id, s.created_at ASC, s.id ASC
	`).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []StoryRow{}
	}
	return rows, nil
}

func (r *StoryRepository) ListActiveByUser(ctx context.Context, userID string) ([]StoryRow, error) {
	userID = strings.TrimSpace(userID)
	var rows []StoryRow
	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			s.id,
			s.user_id,
			s.content,
			s.media_url,
			s.media_type,
			s.width,
			s.height,
			s.created_at,
			s.expires_at,
			MAX(s.created_at) OVER (PARTITION BY s.user_id) AS user_last_story_at,
			u.username,
			u.full_name,
			u.is_verified,
			u.avatar_url
		FROM stories s
		JOIN users u ON u.id = s.user_id
		WHERE s.user_id = ? AND s.expires_at > now()
		ORDER BY s.created_at ASC, s.id ASC
	`, userID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []StoryRow{}
	}
	return rows, nil
}
