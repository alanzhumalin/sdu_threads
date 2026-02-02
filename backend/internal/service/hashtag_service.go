package service

import (
	"context"
	"strings"

	"sduthreads/internal/repository"
)

type HashtagService struct {
	tags  *repository.HashtagRepository
	posts *repository.PostRepository
}

func NewHashtagService(tags *repository.HashtagRepository, posts *repository.PostRepository) *HashtagService {
	return &HashtagService{tags: tags, posts: posts}
}

func (s *HashtagService) Search(ctx context.Context, q string, limit int) ([]repository.Hashtag, error) {
	q = strings.TrimSpace(strings.TrimPrefix(q, "#"))
	if q == "" {
		return []repository.Hashtag{}, nil
	}
	return s.tags.Search(ctx, q, limit)
}

func (s *HashtagService) Posts(ctx context.Context, name string, limit, offset int, viewerID *string) ([]repository.FeedItem, error) {
	name = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(name, "#")))
	if name == "" {
		return []repository.FeedItem{}, nil
	}
	return s.posts.ByHashtag(ctx, name, limit, offset, viewerID)
}
