package service

import (
	"context"
	"errors"
	"strings"

	"sduthreads/internal/models"
	"sduthreads/internal/repository"

	"gorm.io/gorm"
)

type PostService struct {
	posts *repository.PostRepository
	likes *repository.LikeRepository
	tags  *repository.HashtagRepository
	users *repository.UserRepository
}

func NewPostService(posts *repository.PostRepository, likes *repository.LikeRepository, tags *repository.HashtagRepository, users *repository.UserRepository) *PostService {
	return &PostService{posts: posts, likes: likes, tags: tags, users: users}
}

func (s *PostService) Create(ctx context.Context, userID string, content, mediaURL string) (*models.Post, error) {
	if userID == "" {
		return nil, errors.New("user_id is required")
	}
	if s.users != nil {
		if _, err := s.users.GetByID(ctx, userID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, errors.New("user not found, please re-login")
			}
			return nil, err
		}
	}
	if len(content) == 0 {
		return nil, errors.New("content is required")
	}
	if len(content) > 500 {
		return nil, errors.New("content too long (max 500)")
	}
	post := models.Post{
		UserID:   userID,
		Content:  content,
		MediaURL: mediaURL,
	}
	if err := s.posts.Create(ctx, &post); err != nil {
		return nil, err
	}
	return &post, nil
}

func (s *PostService) Feed(ctx context.Context, limit, offset int, viewerID *string) ([]repository.FeedItem, error) {
	return s.posts.Feed(ctx, limit, offset, viewerID)
}

func (s *PostService) Like(ctx context.Context, postID, userID string) error {
	if userID == "" || postID == "" {
		return errors.New("post_id and user_id are required")
	}
	exists, err := s.posts.Exists(ctx, postID)
	if err != nil {
		return err
	}
	if !exists {
		return errors.New("post not found")
	}
	return s.likes.Add(ctx, postID, userID)
}

func (s *PostService) Unlike(ctx context.Context, postID, userID string) error {
	if userID == "" || postID == "" {
		return errors.New("post_id and user_id are required")
	}
	return s.likes.Remove(ctx, postID, userID)
}

// CreateWithTags creates post and attaches hashtags.
func (s *PostService) CreateWithTags(ctx context.Context, userID string, content, mediaURL string, tags []string) error {
	post, err := s.Create(ctx, userID, content, mediaURL)
	if err != nil {
		return err
	}
	normalized := normalizeTags(tags)
	if len(normalized) == 0 {
		return nil
	}
	idMap, err := s.tags.Upsert(ctx, normalized)
	if err != nil {
		return err
	}
	return s.tags.AttachToPost(ctx, post.ID, idMap)
}

func normalizeTags(raw []string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(raw))
	for _, t := range raw {
		t = strings.TrimSpace(strings.TrimPrefix(t, "#"))
		t = strings.ToLower(t)
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}
