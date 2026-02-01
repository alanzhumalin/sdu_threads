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

type CommentWithUser struct {
	ID        uint64
	PostID    uint64
	UserID    uint64
	Username  string
	Body      string
	CreatedAt string
	LikedByMe bool
}

func (r *CommentRepository) ListByPost(ctx context.Context, postID uint64, limit, offset int) ([]CommentWithUser, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var res []CommentWithUser
	q := `
SELECT c.id, c.post_id, c.user_id, u.username, c.body, c.created_at,
       COALESCE(cl.liked, false) AS liked_by_me
FROM comments c
JOIN users u ON u.id = c.user_id
LEFT JOIN (
    SELECT comment_id, TRUE AS liked
    FROM comment_likes
    WHERE user_id = ?
) cl ON cl.comment_id = c.id
WHERE c.post_id = ?
ORDER BY c.created_at ASC
LIMIT ? OFFSET ?`
	if err := r.db.WithContext(ctx).Raw(q, getViewerID(ctx), postID, limit, offset).Scan(&res).Error; err != nil {
		return nil, err
	}
	return res, nil
}

// getViewerID reads user id from context if middleware set it; otherwise returns nil placeholder.
func getViewerID(ctx context.Context) interface{} {
	if v := ctx.Value("viewer_id"); v != nil {
		return v
	}
	return nil
}

func (r *CommentRepository) DeleteIfOwner(ctx context.Context, commentID, userID uint64) (bool, error) {
	result := r.db.WithContext(ctx).
		Exec(`DELETE FROM comments WHERE id = ? AND user_id = ?`, commentID, userID)
	return result.RowsAffected > 0, result.Error
}
