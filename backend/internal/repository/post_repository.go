package repository

import (
	"context"
	"time"

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
	ID           string
	UserID       string
	Username     string
	FullName     string
	Content      string
	MediaURL     string
	ViewCount    int64
	CommentCount int64
	CreatedAt    string
	UpdatedAt    string
	LikeCount    int64
	LikedByMe    bool
}

func (r *PostRepository) Feed(ctx context.Context, limit, offset int, viewerID *string) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent := false
	var viewer string
	if viewerID != nil {
		viewerPresent = true
		viewer = *viewerID
	}

	var items []FeedItem
	q := `
SELECT p.id, p.user_id, u.username, u.full_name, p.content, p.media_url, p.view_count,
       p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
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

func (r *PostRepository) Get(ctx context.Context, postID string, viewerID *string) (*FeedItem, error) {
	limit := 1
	offset := 0

	viewerPresent := false
	var viewer string
	if viewerID != nil {
		viewerPresent = true
		viewer = *viewerID
	}

	var items []FeedItem
	q := `
SELECT p.id, p.user_id, u.username, u.full_name, p.content, p.media_url, p.view_count,
       p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.id = ?
LIMIT ? OFFSET ?`

	if err := r.db.WithContext(ctx).Raw(q, viewerPresent, viewer, postID, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return &items[0], nil
}

func (r *PostRepository) Exists(ctx context.Context, postID string) (bool, error) {
	var exists bool
	err := r.db.WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM posts WHERE id = ?)`, postID).
		Scan(&exists).Error
	return exists, err
}

func (r *PostRepository) IncrementView(ctx context.Context, postID string) error {
	return r.db.WithContext(ctx).Exec(`UPDATE posts SET view_count = view_count + 1 WHERE id = ?`, postID).Error
}

func (r *PostRepository) AddViewOnce(ctx context.Context, postID, userID string, windowStart time.Time) error {
	tx := r.db.WithContext(ctx)
	res := tx.Exec(
		`INSERT INTO post_view_windows (post_id, user_id, window_start) VALUES (?, ?, ?)
		 ON CONFLICT DO NOTHING`, postID, userID, windowStart)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return nil
	}
	return tx.Exec(`UPDATE posts SET view_count = view_count + 1 WHERE id = ?`, postID).Error
}

func (r *PostRepository) ByUser(ctx context.Context, userID string, limit, offset int, viewerID *string) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent := false
	var viewer string
	if viewerID != nil {
		viewerPresent = true
		viewer = *viewerID
	}

	var items []FeedItem
	q := `
SELECT p.id, p.user_id, u.username, u.full_name, p.content, p.media_url, p.view_count,
       p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.user_id = ?
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`

	if err := r.db.WithContext(ctx).Raw(q, viewerPresent, viewer, userID, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) ByHashtag(ctx context.Context, name string, limit, offset int, viewerID *string) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent := false
	var viewer string
	if viewerID != nil {
		viewerPresent = true
		viewer = *viewerID
	}

	var items []FeedItem
	q := `
SELECT p.id, p.user_id, u.username, u.full_name, p.content, p.media_url, p.view_count,
       p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN post_hashtags ph ON ph.post_id = p.id
JOIN hashtags h ON h.id = ph.hashtag_id AND h.name = ?
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
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
