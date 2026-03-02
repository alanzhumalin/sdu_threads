package repository

import (
	"context"

	"gorm.io/gorm"
	"sduthreads/internal/models"
)

type CommentRepository struct {
	db *gorm.DB
}

func NewCommentRepository(db *gorm.DB) *CommentRepository {
	return &CommentRepository{db: db}
}

func (r *CommentRepository) Create(ctx context.Context, c *models.Comment) error {
	return r.db.WithContext(ctx).Create(c).Error
}

type CommentMeta struct {
	ID               string
	PostID           string
	UserID           string
	Body             string
	ReplyToCommentID *string
}

func (r *CommentRepository) MetaByID(ctx context.Context, commentID string) (*CommentMeta, error) {
	var row CommentMeta
	if err := r.db.WithContext(ctx).
		Model(&models.Comment{}).
		Select("id, post_id, user_id, body, reply_to_comment_id").
		Where("id = ?", commentID).
		First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

type CommentWithUser struct {
	ID               string
	PostID           string
	UserID           string
	Username         string
	FullName         string
	IsVerified       bool
	AvatarURL        string
	Body             string
	CreatedAt        string
	LikedByMe        bool
	LikeCount        int64
	RepliesCount     int64
	ReplyToCommentID *string
	ReplyToFullName  *string
	ReplyToUsername  *string
}

func (r *CommentRepository) ListByPost(ctx context.Context, postID string, limit, offset int, viewerID string) ([]CommentWithUser, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var res []CommentWithUser
	q := `
SELECT c.id, c.post_id, c.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, c.body, c.created_at,
       COALESCE(cl.liked, false) AS liked_by_me,
       COALESCE(clc.count, 0) AS like_count,
       COALESCE(rp.count, 0) AS replies_count,
       c.reply_to_comment_id,
       pu.full_name AS reply_to_full_name,
       pu.username AS reply_to_username
FROM comments c
JOIN users u ON u.id = c.user_id
LEFT JOIN comments pc ON pc.id = c.reply_to_comment_id
LEFT JOIN users pu ON pu.id = pc.user_id
LEFT JOIN (
    SELECT comment_id, TRUE AS liked
    FROM comment_likes
    WHERE user_id = ?
) cl ON cl.comment_id = c.id
LEFT JOIN (
    SELECT comment_id, COUNT(*) AS count FROM comment_likes GROUP BY comment_id
) clc ON clc.comment_id = c.id
LEFT JOIN (
    SELECT reply_to_comment_id AS comment_id, COUNT(*) AS count FROM comments WHERE reply_to_comment_id IS NOT NULL GROUP BY reply_to_comment_id
) rp ON rp.comment_id = c.id
WHERE c.post_id = ? AND c.reply_to_comment_id IS NULL
ORDER BY c.created_at DESC
LIMIT ? OFFSET ?`
	if err := r.db.WithContext(ctx).Raw(q, viewerID, postID, limit, offset).Scan(&res).Error; err != nil {
		return nil, err
	}
	return res, nil
}

func (r *CommentRepository) ListReplies(ctx context.Context, parentID string, limit, offset int, viewerID string) ([]CommentWithUser, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var res []CommentWithUser
	q := `
SELECT c.id, c.post_id, c.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, c.body, c.created_at,
       COALESCE(cl.liked, false) AS liked_by_me,
       COALESCE(clc.count, 0) AS like_count,
       COALESCE(rp.count, 0) AS replies_count,
       c.reply_to_comment_id,
       pu.full_name AS reply_to_full_name,
       pu.username AS reply_to_username
FROM comments c
JOIN users u ON u.id = c.user_id
LEFT JOIN comments pc ON pc.id = c.reply_to_comment_id
LEFT JOIN users pu ON pu.id = pc.user_id
LEFT JOIN (
    SELECT comment_id, TRUE AS liked
    FROM comment_likes
    WHERE user_id = ?
) cl ON cl.comment_id = c.id
LEFT JOIN (
    SELECT comment_id, COUNT(*) AS count FROM comment_likes GROUP BY comment_id
) clc ON clc.comment_id = c.id
LEFT JOIN (
    SELECT reply_to_comment_id AS comment_id, COUNT(*) AS count FROM comments WHERE reply_to_comment_id IS NOT NULL GROUP BY reply_to_comment_id
) rp ON rp.comment_id = c.id
WHERE c.reply_to_comment_id = ?
ORDER BY c.created_at DESC
LIMIT ? OFFSET ?`
	if err := r.db.WithContext(ctx).Raw(q, viewerID, parentID, limit, offset).Scan(&res).Error; err != nil {
		return nil, err
	}
	return res, nil
}

func (r *CommentRepository) DeleteIfOwner(ctx context.Context, commentID, userID string) (bool, error) {
	result := r.db.WithContext(ctx).
		Exec(`DELETE FROM comments WHERE id = ? AND user_id = ?`, commentID, userID)
	return result.RowsAffected > 0, result.Error
}

func (r *CommentRepository) UpdateBodyIfOwner(ctx context.Context, commentID, userID, body string) (bool, error) {
	result := r.db.WithContext(ctx).Exec(
		`UPDATE comments SET body = ?, updated_at = now() WHERE id = ? AND user_id = ?`,
		body, commentID, userID,
	)
	return result.RowsAffected > 0, result.Error
}
