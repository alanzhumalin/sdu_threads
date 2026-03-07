package repository

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"
)

type GiftRepository struct {
	db *gorm.DB
}

func NewGiftRepository(db *gorm.DB) *GiftRepository {
	return &GiftRepository{db: db}
}

type GiftRow struct {
	ID            string    `gorm:"column:id"`
	Code          string    `gorm:"column:code"`
	ToName        string    `gorm:"column:to_name"`
	FromName      string    `gorm:"column:from_name"`
	Message       string    `gorm:"column:message"`
	OpenLine      string    `gorm:"column:open_line"`
	UILanguage    string    `gorm:"column:ui_language"`
	AnimationType string    `gorm:"column:animation_type"`
	MediaURL      string    `gorm:"column:media_url"`
	MediaType     string    `gorm:"column:media_type"`
	WishesJSON    string    `gorm:"column:wishes_json"`
	CreatedAt     time.Time `gorm:"column:created_at"`
	ExpiresAt     time.Time `gorm:"column:expires_at"`
}

func (r *GiftRepository) Create(
	ctx context.Context,
	code string,
	toName string,
	fromName string,
	message string,
	openLine string,
	uiLanguage string,
	animationType string,
	mediaURL string,
	mediaType string,
	wishesJSON string,
) (*GiftRow, error) {
	var row GiftRow
	if err := r.db.WithContext(ctx).Raw(`
		INSERT INTO gift_cards (code, to_name, from_name, message, open_line, ui_language, animation_type, media_url, media_type, wishes_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
		RETURNING id, code, to_name, from_name, message, open_line, ui_language, animation_type, media_url, media_type, wishes_json::text, created_at, expires_at
	`, code, toName, fromName, message, openLine, uiLanguage, animationType, mediaURL, mediaType, wishesJSON).Scan(&row).Error; err != nil {
		return nil, err
	}
	if strings.TrimSpace(row.ID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, nil
}

func (r *GiftRepository) GetActiveByCode(ctx context.Context, code string) (*GiftRow, error) {
	code = strings.TrimSpace(strings.ToLower(code))
	var row GiftRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			id,
			code,
			to_name,
			from_name,
			message,
			open_line,
			ui_language,
			animation_type,
			media_url,
			media_type,
			wishes_json::text,
			created_at,
			expires_at
		FROM gift_cards
		WHERE lower(code) = ? AND expires_at > now()
		LIMIT 1
	`, code).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(row.ID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, nil
}

func (r *GiftRepository) GetByCodeAny(ctx context.Context, code string) (*GiftRow, error) {
	code = strings.TrimSpace(strings.ToLower(code))
	var row GiftRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			id,
			code,
			to_name,
			from_name,
			message,
			open_line,
			ui_language,
			animation_type,
			media_url,
			media_type,
			wishes_json::text,
			created_at,
			expires_at
		FROM gift_cards
		WHERE lower(code) = ?
		LIMIT 1
	`, code).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(row.ID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, nil
}

func (r *GiftRepository) DeleteExpiredByCode(ctx context.Context, code string) error {
	code = strings.TrimSpace(strings.ToLower(code))
	return r.db.WithContext(ctx).Exec(`
		DELETE FROM gift_cards
		WHERE lower(code) = ? AND expires_at <= now()
	`, code).Error
}
