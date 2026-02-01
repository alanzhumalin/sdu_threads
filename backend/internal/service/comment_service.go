package service

import (
	"context"
	"errors"

	"sduthreads/internal/models"
	"sduthreads/internal/repository"
)

type CommentService struct {
	comments *repository.CommentRepository
	posts    *repository.PostRepository
	likes    *repository.LikeRepository
}

func NewCommentService(comments *repository.CommentRepository, posts *repository.PostRepository, likes *repository.LikeRepository) *CommentService {
	return &CommentService{comments: comments, posts: posts, likes: likes}
}

func (s *CommentService) Create(ctx context.Context, postID, userID uint64, body string) error {
	if postID == 0 || userID == 0 {
		return errors.New("post_id and user_id are required")
	}
	if len(body) == 0 {
		return errors.New("content is required")
	}
	exists, err := s.posts.Exists(ctx, postID)
	if err != nil {
		return err
	}
	if !exists {
		return errors.New("post not found")
	}
	comment := models.Comment{
		PostID: postID,
		UserID: userID,
		Body:   body,
	}
	return s.comments.Create(ctx, &comment)
}

func (s *CommentService) List(ctx context.Context, postID uint64, limit, offset int) ([]repository.CommentWithUser, error) {
	return s.comments.ListByPost(ctx, postID, limit, offset)
}

func (s *CommentService) Delete(ctx context.Context, commentID, userID uint64) error {
	if commentID == 0 || userID == 0 {
		return errors.New("comment_id and user_id are required")
	}
	ok, err := s.comments.DeleteIfOwner(ctx, commentID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("not found or not owner")
	}
	return nil
}

func (s *CommentService) Like(ctx context.Context, commentID, userID uint64) error {
	if commentID == 0 || userID == 0 {
		return errors.New("comment_id and user_id are required")
	}
	return s.likes.AddComment(ctx, commentID, userID)
}

func (s *CommentService) Unlike(ctx context.Context, commentID, userID uint64) error {
	if commentID == 0 || userID == 0 {
		return errors.New("comment_id and user_id are required")
	}
	return s.likes.RemoveComment(ctx, commentID, userID)
}
