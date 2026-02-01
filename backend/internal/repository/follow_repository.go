package repository

import (
	"context"

	"gorm.io/gorm"
)

type FollowRepository struct {
	db *gorm.DB
}

func NewFollowRepository(db *gorm.DB) *FollowRepository {
	return &FollowRepository{db: db}
}

func (r *FollowRepository) Follow(ctx context.Context, followerID, followeeID uint64) error {
	const q = `INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
	return r.db.WithContext(ctx).Exec(q, followerID, followeeID).Error
}

func (r *FollowRepository) Unfollow(ctx context.Context, followerID, followeeID uint64) error {
	return r.db.WithContext(ctx).
		Exec(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`, followerID, followeeID).Error
}

func (r *FollowRepository) FollowersCount(ctx context.Context, userID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM follows WHERE followee_id = ?`, userID).
		Scan(&count).Error
	return count, err
}

func (r *FollowRepository) FollowingCount(ctx context.Context, userID uint64) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM follows WHERE follower_id = ?`, userID).
		Scan(&count).Error
	return count, err
}

type FollowUser struct {
	ID       uint64
	Username string
	FullName string
}

func (r *FollowRepository) Followers(ctx context.Context, userID uint64, limit, offset int) ([]FollowUser, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var res []FollowUser
	q := `
SELECT u.id, u.username, u.full_name
FROM follows f
JOIN users u ON u.id = f.follower_id
WHERE f.followee_id = ?
ORDER BY f.created_at DESC
LIMIT ? OFFSET ?`
	if err := r.db.WithContext(ctx).Raw(q, userID, limit, offset).Scan(&res).Error; err != nil {
		return nil, err
	}
	return res, nil
}

func (r *FollowRepository) Following(ctx context.Context, userID uint64, limit, offset int) ([]FollowUser, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var res []FollowUser
	q := `
SELECT u.id, u.username, u.full_name
FROM follows f
JOIN users u ON u.id = f.followee_id
WHERE f.follower_id = ?
ORDER BY f.created_at DESC
LIMIT ? OFFSET ?`
	if err := r.db.WithContext(ctx).Raw(q, userID, limit, offset).Scan(&res).Error; err != nil {
		return nil, err
	}
	return res, nil
}
