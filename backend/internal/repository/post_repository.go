package repository

import (
	"context"

	"gorm.io/gorm"
	"sduthreads/internal/models"
)

type PostRepository struct {
	db *gorm.DB
}

func NewPostRepository(db *gorm.DB) *PostRepository {
	return &PostRepository{db: db}
}

func (r *PostRepository) Create(ctx context.Context, post *models.Post) error {
	return r.db.WithContext(ctx).Create(post).Error
}

type FeedItem struct {
	ID        uint64
	UserID    uint64
	Username  string
	FullName  string
	Content   string
	MediaURL  string
	CreatedAt string
	UpdatedAt string
	LikeCount int64
	LikedByMe bool
}

func (r *PostRepository) Feed(ctx context.Context, limit, offset int, viewerID *uint64) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent := false
	var viewer uint64
	if viewerID != nil {
		viewerPresent = true
		viewer = *viewerID
	}

	var items []FeedItem
	q := `
SELECT p.id, p.user_id, u.username, u.full_name, p.content, p.media_url,
       p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`

	if err := r.db.WithContext(ctx).Raw(q, viewerPresent, viewer, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) Exists(ctx context.Context, postID uint64) (bool, error) {
	var exists bool
	err := r.db.WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM posts WHERE id = ?)`, postID).
		Scan(&exists).Error
	return exists, err
}

func (r *PostRepository) ByHashtag(ctx context.Context, name string, limit, offset int, viewerID *uint64) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent := false
	var viewer uint64
	if viewerID != nil {
		viewerPresent = true
		viewer = *viewerID
	}

	var items []FeedItem
	q := `
SELECT p.id, p.user_id, u.username, u.full_name, p.content, p.media_url,
       p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN post_hashtags ph ON ph.post_id = p.id
JOIN hashtags h ON h.id = ph.hashtag_id AND h.name = ?
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`

	if err := r.db.WithContext(ctx).Raw(q, viewerPresent, name, viewer, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}
