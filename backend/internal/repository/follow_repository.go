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

func (r *FollowRepository) Follow(ctx context.Context, followerID, followeeID string) error {
	const q = `INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
	return r.db.WithContext(ctx).Exec(q, followerID, followeeID).Error
}

func (r *FollowRepository) Unfollow(ctx context.Context, followerID, followeeID string) error {
	return r.db.WithContext(ctx).
		Exec(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`, followerID, followeeID).Error
}

func (r *FollowRepository) FollowersCount(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM follows WHERE followee_id = ?`, userID).
		Scan(&count).Error
	return count, err
}

func (r *FollowRepository) FollowingCount(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM follows WHERE follower_id = ?`, userID).
		Scan(&count).Error
	return count, err
}

type FollowUser struct {
	ID       string
	Username string
	FullName string
}

func (r *FollowRepository) Followers(ctx context.Context, userID string, limit, offset int) ([]FollowUser, error) {
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

func (r *FollowRepository) Following(ctx context.Context, userID string, limit, offset int) ([]FollowUser, error) {
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

func (r *FollowRepository) IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error) {
	var exists bool
	err := r.db.WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?)`, followerID, followeeID).
		Scan(&exists).Error
	return exists, err
}

func (r *FollowRepository) FollowingMap(ctx context.Context, followerID string, followeeIDs []string) (map[string]bool, error) {
	result := make(map[string]bool, len(followeeIDs))
	if len(followeeIDs) == 0 {
		return result, nil
	}
	unique := make([]string, 0, len(followeeIDs))
	seen := make(map[string]struct{})
	for _, id := range followeeIDs {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return result, nil
	}
	rows, err := r.db.WithContext(ctx).
		Raw(`SELECT followee_id FROM follows WHERE follower_id = ? AND followee_id IN ?`, followerID, unique).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result[id] = true
	}
	return result, nil
}

type TopUser struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	FullName  string `json:"full_name"`
	AvatarURL string `json:"avatar_url"`
	Followers int64  `json:"followers"`
}

func (r *FollowRepository) TopFollowed(ctx context.Context, limit int) ([]TopUser, error) {
	if limit <= 0 {
		limit = 3
	}
	if limit > 50 {
		limit = 50
	}
	var res []TopUser
	q := `
SELECT u.id, u.username, u.full_name, u.avatar_url, COUNT(f.followee_id) AS followers
FROM users u
LEFT JOIN follows f ON f.followee_id = u.id
GROUP BY u.id, u.username, u.full_name, u.avatar_url
ORDER BY followers DESC, u.full_name ASC
LIMIT ?`
	if err := r.db.WithContext(ctx).Raw(q, limit).Scan(&res).Error; err != nil {
		return nil, err
	}
	if res == nil {
		res = []TopUser{}
	}
	return res, nil
}
