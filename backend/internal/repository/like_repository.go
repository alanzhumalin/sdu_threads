package repository

import (
	"context"

	"gorm.io/gorm"
)

type LikeRepository struct {
	db *gorm.DB
}

func NewLikeRepository(db *gorm.DB) *LikeRepository {
	return &LikeRepository{db: db}
}

func (r *LikeRepository) Add(ctx context.Context, postID, userID uint64) error {
	const q = `INSERT INTO likes (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
	return r.db.WithContext(ctx).Exec(q, postID, userID).Error
}

func (r *LikeRepository) AddComment(ctx context.Context, commentID, userID uint64) error {
	const q = `INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
	return r.db.WithContext(ctx).Exec(q, commentID, userID).Error
}

func (r *LikeRepository) RemoveComment(ctx context.Context, commentID, userID uint64) error {
	return r.db.WithContext(ctx).
		Exec(`DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?`, commentID, userID).Error
}

func (r *LikeRepository) CommentLikedBy(ctx context.Context, commentID, userID uint64) (bool, error) {
	var exists bool
	err := r.db.WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?)`, commentID, userID).
		Scan(&exists).Error
	return exists, err
}
func (r *LikeRepository) Remove(ctx context.Context, postID, userID uint64) error {
	return r.db.WithContext(ctx).
		Exec(`DELETE FROM likes WHERE post_id = ? AND user_id = ?`, postID, userID).Error
}

func (r *LikeRepository) CountByPost(ctx context.Context, postID uint64) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM likes WHERE post_id = ?`, postID).
		Scan(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func (r *LikeRepository) IsLiked(ctx context.Context, postID, userID uint64) (bool, error) {
	var exists bool
	err := r.db.WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?)`, postID, userID).
		Scan(&exists).Error
	return exists, err
}
