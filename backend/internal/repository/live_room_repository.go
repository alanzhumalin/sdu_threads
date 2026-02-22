package repository

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"gorm.io/gorm"
)

type LiveRoomRepository struct {
	db *gorm.DB
}

func NewLiveRoomRepository(db *gorm.DB) *LiveRoomRepository {
	return &LiveRoomRepository{db: db}
}

type LiveRoomRow struct {
	ID            string         `gorm:"column:id"`
	HostUserID    string         `gorm:"column:host_user_id"`
	Title         string         `gorm:"column:title"`
	IsPrivate     bool           `gorm:"column:is_private"`
	CreatedAt     time.Time      `gorm:"column:created_at"`
	HostUsername  string         `gorm:"column:host_username"`
	HostFullName  string         `gorm:"column:host_full_name"`
	HostVerified  bool           `gorm:"column:host_verified"`
	HostAvatarURL sql.NullString `gorm:"column:host_avatar_url"`
}

type LiveRoomAccessRow struct {
	ID           string `gorm:"column:id"`
	IsPrivate    bool   `gorm:"column:is_private"`
	PasswordHash string `gorm:"column:password_hash"`
}

func (r *LiveRoomRepository) Create(ctx context.Context, hostUserID, title string, isPrivate bool, passwordHash string) (string, error) {
	var id string
	if err := r.db.WithContext(ctx).Raw(`
		INSERT INTO live_rooms (host_user_id, title, is_private, password_hash, created_at, updated_at)
		VALUES (?, ?, ?, ?, now(), now())
		RETURNING id
	`, hostUserID, title, isPrivate, passwordHash).Scan(&id).Error; err != nil {
		return "", err
	}
	return strings.TrimSpace(id), nil
}

func (r *LiveRoomRepository) ListActive(ctx context.Context, limit, offset int) ([]LiveRoomRow, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var rows []LiveRoomRow
	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			r.id,
			r.host_user_id,
			r.title,
			r.is_private,
			r.created_at,
			u.username AS host_username,
			u.full_name AS host_full_name,
			u.is_verified AS host_verified,
			u.avatar_url AS host_avatar_url
		FROM live_rooms r
		JOIN users u ON u.id = r.host_user_id
		WHERE r.ended_at IS NULL
		ORDER BY r.created_at DESC, r.id DESC
		LIMIT ? OFFSET ?
	`, limit, offset).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []LiveRoomRow{}
	}
	return rows, nil
}

func (r *LiveRoomRepository) GetActiveByID(ctx context.Context, roomID string) (*LiveRoomRow, error) {
	var row LiveRoomRow
	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			r.id,
			r.host_user_id,
			r.title,
			r.is_private,
			r.created_at,
			u.username AS host_username,
			u.full_name AS host_full_name,
			u.is_verified AS host_verified,
			u.avatar_url AS host_avatar_url
		FROM live_rooms r
		JOIN users u ON u.id = r.host_user_id
		WHERE r.id = ? AND r.ended_at IS NULL
		LIMIT 1
	`, roomID).Scan(&row).Error; err != nil {
		return nil, err
	}
	if strings.TrimSpace(row.ID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, nil
}

func (r *LiveRoomRepository) GetActiveAccessByID(ctx context.Context, roomID string) (*LiveRoomAccessRow, error) {
	var row LiveRoomAccessRow
	if err := r.db.WithContext(ctx).Raw(`
		SELECT
			r.id,
			r.is_private,
			r.password_hash
		FROM live_rooms r
		WHERE r.id = ? AND r.ended_at IS NULL
		LIMIT 1
	`, roomID).Scan(&row).Error; err != nil {
		return nil, err
	}
	if strings.TrimSpace(row.ID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, nil
}

func (r *LiveRoomRepository) End(ctx context.Context, roomID string) error {
	return r.db.WithContext(ctx).Exec(`
		UPDATE live_rooms
		SET ended_at = COALESCE(ended_at, now()), updated_at = now()
		WHERE id = ?
	`, roomID).Error
}
