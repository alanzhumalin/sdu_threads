package service

import (
	"context"
	"errors"
	"time"

	"sduthreads/internal/repository"
)

type ViewService struct {
	posts *repository.PostRepository
	ttl   time.Duration
}

func NewViewService(posts *repository.PostRepository, ttlMinutes int) *ViewService {
	return &ViewService{
		posts: posts,
		ttl:   time.Duration(ttlMinutes) * time.Minute,
	}
}

// AddView counts a view once per user per TTL window.
func (s *ViewService) AddView(ctx context.Context, postID, userID string) error {
	if postID == "" || userID == "" {
		return errors.New("post_id and user_id are required")
	}
	windowStart := time.Now().UTC().Truncate(s.ttl)
	return s.posts.AddViewOnce(ctx, postID, userID, windowStart)
}
