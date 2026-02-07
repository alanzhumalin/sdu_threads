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
	fols  *repository.FollowRepository
}

func NewHashtagService(tags *repository.HashtagRepository, posts *repository.PostRepository, users *repository.UserRepository, fols *repository.FollowRepository) *HashtagService {
	return &HashtagService{tags: tags, posts: posts, users: users, fols: fols}
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
	followMap := map[string]bool{}
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
	if viewerID != nil && s.fols != nil {
		authors := make([]string, 0, len(items))
		seen := make(map[string]struct{})
		for _, it := range items {
			if _, ok := seen[it.UserID]; ok {
				continue
			}
			seen[it.UserID] = struct{}{}
			if it.UserID == *viewerID {
				continue
			}
			authors = append(authors, it.UserID)
		}
		if len(authors) > 0 {
			if m, err := s.fols.FollowingMap(ctx, *viewerID, authors); err == nil {
				followMap = m
			}
		}
	}
	resp := make([]dto.FeedResponseItem, 0, len(items))
	for _, it := range items {
		media := effectiveMediaItems(it.Media, it.MediaURL)
		isMe := viewerID != nil && *viewerID == it.UserID
		isSub := false
		if !isMe && viewerID != nil {
			isSub = followMap[it.UserID]
		}
		resp = append(resp, dto.FeedResponseItem{
			ID:           it.ID,
			UserID:       it.UserID,
			Username:     it.Username,
			FullName:     it.FullName,
			AvatarURL:    it.AvatarURL,
			Content:      it.Content,
			Media:        media,
			CreatedAt:    it.CreatedAt,
			UpdatedAt:    it.UpdatedAt,
			LikeCount:    it.LikeCount,
			LikedByMe:    it.LikedByMe,
			ViewCount:    it.ViewCount,
			CommentCount: it.CommentCount,
			Mentions:     mentionMap[it.ID],
			Hashtags:     hashtagMap[it.ID],
			IsSubscribed: isSub,
			IsMe:         isMe,
		})
	}
	return resp, nil
}

func (s *HashtagService) Popular(ctx context.Context, limit int) ([]repository.PopularHashtag, error) {
	return s.tags.Popular(ctx, limit)
}
