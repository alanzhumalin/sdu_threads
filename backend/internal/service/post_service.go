package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/moderation"
	"sduthreads/internal/repository"
	"sduthreads/internal/storage"

	"gorm.io/gorm"
)

func decodeMediaURLs(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var items []dto.MediaItem
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, it := range items {
		u := strings.TrimSpace(it.URL)
		if u == "" {
			continue
		}
		out = append(out, u)
	}
	return out
}

func effectiveMediaURLs(raw []byte, legacy string) []string {
	urls := decodeMediaURLs(raw)
	if len(urls) > 0 {
		return urls
	}
	legacy = strings.TrimSpace(legacy)
	if legacy == "" {
		return nil
	}
	return []string{legacy}
}

func decodeMediaItems(raw []byte) []dto.MediaItem {
	if len(raw) == 0 {
		return nil
	}
	var items []dto.MediaItem
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil
	}
	out := make([]dto.MediaItem, 0, len(items))
	for _, it := range items {
		it.URL = strings.TrimSpace(it.URL)
		if it.URL == "" {
			continue
		}
		out = append(out, it)
	}
	return out
}

func effectiveMediaItems(raw []byte, legacy string) []dto.MediaItem {
	items := decodeMediaItems(raw)
	if len(items) > 0 {
		return items
	}
	legacy = strings.TrimSpace(legacy)
	if legacy == "" {
		return nil
	}
	return []dto.MediaItem{{URL: legacy}}
}

type PostService struct {
	posts    *repository.PostRepository
	likes    *repository.LikeRepository
	tags     *repository.HashtagRepository
	users    *repository.UserRepository
	fols     *repository.FollowRepository
	uploader *storage.S3Uploader
	mod      *moderation.Client
}

func NewPostService(posts *repository.PostRepository, likes *repository.LikeRepository, tags *repository.HashtagRepository, users *repository.UserRepository, fols *repository.FollowRepository, uploader *storage.S3Uploader, mod *moderation.Client) *PostService {
	return &PostService{posts: posts, likes: likes, tags: tags, users: users, fols: fols, uploader: uploader, mod: mod}
}

func (s *PostService) verifyPostMedia(ctx context.Context, userID string, media []dto.MediaItem) ([]dto.MediaItem, error) {
	if s.uploader == nil || len(media) == 0 {
		return media, nil
	}

	const maxBytes = 5 * 1024 * 1024
	prefix := s.uploader.KeyPrefix("post", userID) + "/"

	out := make([]dto.MediaItem, 0, len(media))
	for _, m := range media {
		key, ok := s.uploader.KeyFromPublicURL(m.URL)
		if !ok || !strings.HasPrefix(key, prefix) {
			return nil, errors.New("invalid media url")
		}
		st, err := s.uploader.Stat(ctx, key)
		if err != nil {
			// Object doesn't exist or can't be read.
			return nil, errors.New("media not found")
		}
		if st.Size <= 0 || st.Size > maxBytes {
			// If client lied about size, clean up best-effort.
			_ = s.uploader.Remove(ctx, key)
			return nil, errors.New("file too large (max 5MB)")
		}

		m.URL = s.uploader.PublicURL(key) // normalize
		out = append(out, m)
	}

	return out, nil
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

func (s *PostService) Create(ctx context.Context, userID string, content string, media []dto.MediaItem) (*models.Post, error) {
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
	preview := strings.TrimSpace(content)
	if len(preview) > 160 {
		preview = preview[:160] + "..."
	}
	if err := s.mod.CheckText(ctx, content, "post_text", &moderation.AuditMeta{
		ActorUserID: userID,
		Action:      "create_post",
		TargetType:  "post",
		Payload: map[string]any{
			"content_preview": preview,
			"media_count":     len(media),
		},
	}); err != nil {
		return nil, err
	}

	clean := make([]dto.MediaItem, 0, len(media))
	for _, m := range media {
		m.URL = strings.TrimSpace(m.URL)
		if m.URL == "" {
			continue
		}
		if m.Width < 0 {
			m.Width = 0
		}
		if m.Height < 0 {
			m.Height = 0
		}
		clean = append(clean, m)
	}

	// For direct-to-storage uploads we must verify the object properties on the backend,
	// because presigned PUT URLs (esp. Signature V2) can't enforce content-length-range.
	if s.uploader != nil && len(clean) > 0 {
		verified, err := s.verifyPostMedia(ctx, userID, clean)
		if err != nil {
			return nil, err
		}
		clean = verified
	}
	for _, m := range clean {
		if err := s.mod.CheckImageURL(ctx, m.URL, "post_media", &moderation.AuditMeta{
			ActorUserID: userID,
			Action:      "create_post",
			TargetType:  "post",
			Payload: map[string]any{
				"media_url": m.URL,
			},
		}); err != nil {
			return nil, err
		}
	}
	if len(clean) > 5 {
		return nil, errors.New("too many media files (max 5)")
	}
	mediaURL := ""
	if len(clean) > 0 {
		mediaURL = clean[0].URL
	}

	post := models.Post{
		UserID:   userID,
		Content:  content,
		MediaURL: mediaURL,
	}
	rows := make([]models.PostMedia, 0, len(clean))
	for i, m := range clean {
		rows = append(rows, models.PostMedia{
			URL:       m.URL,
			Width:     m.Width,
			Height:    m.Height,
			SortOrder: i,
		})
	}
	limits := repository.PostCreateLimits{
		Cooldown:      60 * time.Second,
		HourWindow:    60 * time.Minute,
		HourMaxPosts:  10,
		MediaCooldown: 120 * time.Second,
	}
	if err := s.posts.CreateWithRateLimit(ctx, &post, rows, limits); err != nil {
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

func (s *PostService) FeedFollowing(ctx context.Context, userID string, limit, offset int) ([]dto.FeedResponseItem, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("user_id is required")
	}
	viewerID := strings.TrimSpace(userID)
	items, err := s.posts.FeedFollowing(ctx, viewerID, limit, offset, &viewerID)
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
	resp := make([]dto.FeedResponseItem, 0, len(items))
	for _, it := range items {
		media := effectiveMediaItems(it.Media, it.MediaURL)
		isMe := viewerID == it.UserID
		// By definition for this feed: if author != me, I'm following them.
		isSub := !isMe
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

func (s *PostService) Get(ctx context.Context, postID string, viewerID *string) (*dto.FeedResponseItem, error) {
	if postID == "" {
		return nil, errors.New("post_id is required")
	}
	item, err := s.posts.Get(ctx, postID, viewerID)
	if err != nil {
		return nil, err
	}
	media := effectiveMediaItems(item.Media, item.MediaURL)
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
		AvatarURL:    item.AvatarURL,
		Content:      item.Content,
		Media:        media,
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

func (s *PostService) ByUserQuery(ctx context.Context, userID, query string, limit, offset int, viewerID *string) ([]dto.FeedResponseItem, error) {
	if strings.TrimSpace(query) == "" {
		return s.ByUser(ctx, userID, limit, offset, viewerID)
	}
	items, err := s.posts.ByUserQuery(ctx, userID, query, limit, offset, viewerID)
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

func (s *PostService) ModerationFeed(ctx context.Context, query string, limit, offset int) ([]dto.FeedResponseItem, error) {
	items, err := s.posts.ModerationFeed(ctx, query, limit, offset)
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
	resp := make([]dto.FeedResponseItem, 0, len(items))
	for _, it := range items {
		media := effectiveMediaItems(it.Media, it.MediaURL)
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
			IsSubscribed: false,
			IsMe:         false,
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
func (s *PostService) CreateWithTags(ctx context.Context, userID string, content string, media []dto.MediaItem, tags []string) error {
	post, err := s.Create(ctx, userID, content, media)
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
