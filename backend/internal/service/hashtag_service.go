package service

import (
	"context"
	"strings"

	"sduthreads/internal/dto"
	"sduthreads/internal/repository"
)

type HashtagService struct {
	tags  *repository.HashtagRepository
	posts *repository.PostRepository
	users *repository.UserRepository
}

func NewHashtagService(tags *repository.HashtagRepository, posts *repository.PostRepository, users *repository.UserRepository) *HashtagService {
	return &HashtagService{tags: tags, posts: posts, users: users}
}

func (s *HashtagService) Search(ctx context.Context, q string, limit int) ([]repository.Hashtag, error) {
	q = strings.TrimSpace(strings.TrimPrefix(q, "#"))
	if q == "" {
		return []repository.Hashtag{}, nil
	}
	return s.tags.Search(ctx, q, limit)
}

func (s *HashtagService) Posts(ctx context.Context, name string, limit, offset int, viewerID *string) ([]dto.FeedResponseItem, error) {
	name = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(name, "#")))
	if name == "" {
		return []dto.FeedResponseItem{}, nil
	}
	items, err := s.posts.ByHashtag(ctx, name, limit, offset, viewerID)
	if err != nil {
		return nil, err
	}
	mentionMap := map[string][]string{}
	hashtagMap := map[string][]string{}
	if s.users != nil {
		if m, err := func() (map[string][]string, error) {
			var candidates []string
			for _, it := range items {
				candidates = append(candidates, extractMentionCandidates(it.Content)...)
			}
			existing, err := filterExistingUsernames(ctx, s.users, candidates)
			if err != nil {
				return nil, err
			}
			res := make(map[string][]string, len(items))
			for _, it := range items {
				uniq := make(map[string]struct{})
				for _, u := range extractMentionCandidates(it.Content) {
					if _, ok := existing[strings.ToLower(u)]; ok {
						uniq[strings.ToLower(u)] = struct{}{}
					}
				}
				if len(uniq) > 0 {
					for u := range uniq {
						res[it.ID] = append(res[it.ID], u)
					}
				}
			}
			return res, nil
		}(); err == nil {
			mentionMap = m
		}
	}
	if m, err := s.tags.ByPostIDs(ctx, func() []string {
		ids := make([]string, 0, len(items))
		for _, it := range items {
			ids = append(ids, it.ID)
		}
		return ids
	}()); err == nil {
		hashtagMap = m
	}
	resp := make([]dto.FeedResponseItem, 0, len(items))
	for _, it := range items {
		resp = append(resp, dto.FeedResponseItem{
			ID:           it.ID,
			UserID:       it.UserID,
			Username:     it.Username,
			FullName:     it.FullName,
			Content:      it.Content,
			MediaURL:     it.MediaURL,
			CreatedAt:    it.CreatedAt,
			UpdatedAt:    it.UpdatedAt,
			LikeCount:    it.LikeCount,
			LikedByMe:    it.LikedByMe,
			ViewCount:    it.ViewCount,
			CommentCount: it.CommentCount,
			Mentions:     mentionMap[it.ID],
			Hashtags:     hashtagMap[it.ID],
		})
	}
	return resp, nil
}

func (s *HashtagService) Popular(ctx context.Context, limit int) ([]repository.PopularHashtag, error) {
	return s.tags.Popular(ctx, limit)
}
