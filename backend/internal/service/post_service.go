package service

import (
	"context"
	"errors"
	"strings"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/repository"

	"gorm.io/gorm"
)

type PostService struct {
	posts *repository.PostRepository
	likes *repository.LikeRepository
	tags  *repository.HashtagRepository
	users *repository.UserRepository
	fols  *repository.FollowRepository
}

func NewPostService(posts *repository.PostRepository, likes *repository.LikeRepository, tags *repository.HashtagRepository, users *repository.UserRepository, fols *repository.FollowRepository) *PostService {
	return &PostService{posts: posts, likes: likes, tags: tags, users: users, fols: fols}
}

func (s *PostService) enrichMentions(ctx context.Context, items []repository.FeedItem) (map[string][]string, error) {
	result := make(map[string][]string, len(items))
	if s.users == nil {
		return result, nil
	}
	var candidates []string
	for _, it := range items {
		cands := extractMentionCandidates(it.Content)
		candidates = append(candidates, cands...)
	}
	existing, err := filterExistingUsernames(ctx, s.users, candidates)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		cands := extractMentionCandidates(it.Content)
		if len(cands) == 0 {
			result[it.ID] = nil
			continue
		}
		uniq := make(map[string]struct{})
		for _, u := range cands {
			if _, ok := existing[strings.ToLower(u)]; ok {
				uniq[strings.ToLower(u)] = struct{}{}
			}
		}
		if len(uniq) == 0 {
			result[it.ID] = nil
			continue
		}
		list := make([]string, 0, len(uniq))
		for u := range uniq {
			list = append(list, u)
		}
		result[it.ID] = list
	}
	return result, nil
}

func (s *PostService) enrichHashtags(ctx context.Context, items []repository.FeedItem) (map[string][]string, error) {
	result := make(map[string][]string, len(items))
	if s.tags == nil || len(items) == 0 {
		return result, nil
	}
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	tagMap, err := s.tags.ByPostIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		result[it.ID] = tagMap[it.ID]
	}
	return result, nil
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

func (s *PostService) Feed(ctx context.Context, limit, offset int, viewerID *string) ([]dto.FeedResponseItem, error) {
	items, err := s.posts.Feed(ctx, limit, offset, viewerID)
	if err != nil {
		return nil, err
	}
	mentionMap, err := s.enrichMentions(ctx, items)
	if err != nil {
		return nil, err
	}
	hashtagMap, err := s.enrichHashtags(ctx, items)
	if err != nil {
		return nil, err
	}
	followMap := map[string]bool{}
	if viewerID != nil && s.fols != nil {
		authors := make([]string, 0, len(items))
		for _, it := range items {
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
			IsSubscribed: isSub,
			IsMe:         isMe,
		})
	}
	return resp, nil
}

func (s *PostService) Get(ctx context.Context, postID string, viewerID *string) (*dto.FeedResponseItem, error) {
	if postID == "" {
		return nil, errors.New("post_id is required")
	}
	item, err := s.posts.Get(ctx, postID, viewerID)
	if err != nil {
		return nil, err
	}
	mentionMap, err := s.enrichMentions(ctx, []repository.FeedItem{*item})
	if err != nil {
		return nil, err
	}
	hashtagMap, err := s.enrichHashtags(ctx, []repository.FeedItem{*item})
	if err != nil {
		return nil, err
	}
	isMe := viewerID != nil && *viewerID == item.UserID
	isSub := false
	if !isMe && viewerID != nil && s.fols != nil {
		if ok, err := s.fols.IsFollowing(ctx, *viewerID, item.UserID); err == nil {
			isSub = ok
		}
	}
	resp := dto.FeedResponseItem{
		ID:           item.ID,
		UserID:       item.UserID,
		Username:     item.Username,
		FullName:     item.FullName,
		Content:      item.Content,
		MediaURL:     item.MediaURL,
		CreatedAt:    item.CreatedAt,
		UpdatedAt:    item.UpdatedAt,
		LikeCount:    item.LikeCount,
		LikedByMe:    item.LikedByMe,
		ViewCount:    item.ViewCount,
		CommentCount: item.CommentCount,
		Mentions:     mentionMap[item.ID],
		Hashtags:     hashtagMap[item.ID],
		IsSubscribed: isSub,
		IsMe:         isMe,
	}
	return &resp, nil
}

func (s *PostService) ByUser(ctx context.Context, userID string, limit, offset int, viewerID *string) ([]dto.FeedResponseItem, error) {
	items, err := s.posts.ByUser(ctx, userID, limit, offset, viewerID)
	if err != nil {
		return nil, err
	}
	mentionMap, err := s.enrichMentions(ctx, items)
	if err != nil {
		return nil, err
	}
	hashtagMap, err := s.enrichHashtags(ctx, items)
	if err != nil {
		return nil, err
	}
	followMap := map[string]bool{}
	if viewerID != nil && s.fols != nil && userID != *viewerID {
		if m, err := s.fols.FollowingMap(ctx, *viewerID, []string{userID}); err == nil {
			followMap = m
		}
	}
	resp := make([]dto.FeedResponseItem, 0, len(items))
	for _, it := range items {
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
			IsSubscribed: isSub,
			IsMe:         isMe,
		})
	}
	return resp, nil
}

func (s *PostService) LikedBy(ctx context.Context, userID string, limit, offset int, viewerID *string) ([]dto.FeedResponseItem, error) {
	items, err := s.posts.LikedByUser(ctx, userID, limit, offset, viewerID)
	if err != nil {
		return nil, err
	}
	mentionMap, err := s.enrichMentions(ctx, items)
	if err != nil {
		return nil, err
	}
	hashtagMap, err := s.enrichHashtags(ctx, items)
	if err != nil {
		return nil, err
	}
	followMap := map[string]bool{}
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
			IsSubscribed: isSub,
			IsMe:         isMe,
		})
	}
	return resp, nil
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
