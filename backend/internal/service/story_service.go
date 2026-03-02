package service

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"

	"sduthreads/internal/dto"
	"sduthreads/internal/repository"
	"sduthreads/internal/storage"
)

const (
	maxStoryVideoBytes = 40 * 1024 * 1024
	maxStoryTextRunes  = 600
)

var (
	ErrStoryNotFound         = errors.New("story not found")
	ErrStoryUserNotFound     = errors.New("user not found")
	ErrStoryMediaRequired    = errors.New("story media is required")
	ErrStoryMediaURLInvalid  = errors.New("invalid story media url")
	ErrStoryMediaTypeInvalid = errors.New("invalid story media type")
	ErrStoryMediaNotFound    = errors.New("story media not found")
	ErrStoryMediaTooLarge    = errors.New("story media is too large")
	ErrStoryTextTooLong      = errors.New("story text is too long (max 600)")
)

type StoryService struct {
	stories  *repository.StoryRepository
	users    *repository.UserRepository
	uploader *storage.S3Uploader
}

func NewStoryService(
	stories *repository.StoryRepository,
	users *repository.UserRepository,
	uploader *storage.S3Uploader,
) *StoryService {
	return &StoryService{
		stories:  stories,
		users:    users,
		uploader: uploader,
	}
}

type StoryAuthor struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	FullName   string `json:"full_name"`
	IsVerified bool   `json:"is_verified"`
	AvatarURL  string `json:"avatar_url,omitempty"`
}

type StoryItem struct {
	ID        string        `json:"id"`
	UserID    string        `json:"user_id"`
	Content   string        `json:"content"`
	Media     dto.MediaItem `json:"media"`
	CreatedAt string        `json:"created_at"`
	ExpiresAt string        `json:"expires_at"`
}

type StoryGroup struct {
	User     StoryAuthor `json:"user"`
	IsMe     bool        `json:"is_me"`
	LatestAt string      `json:"latest_at"`
	Stories  []StoryItem `json:"stories"`
}

func normalizeStoryText(raw string) (string, error) {
	text := strings.TrimSpace(raw)
	if len([]rune(text)) > maxStoryTextRunes {
		return "", ErrStoryTextTooLong
	}
	return text, nil
}

func normalizeStoryMediaType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "image":
		return "image"
	case "video":
		return "video"
	default:
		return ""
	}
}

func inferStoryMediaTypeFromURL(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return ""
	}
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	switch {
	case strings.HasSuffix(raw, ".mp4"),
		strings.HasSuffix(raw, ".webm"),
		strings.HasSuffix(raw, ".mov"),
		strings.HasSuffix(raw, ".m4v"),
		strings.HasSuffix(raw, ".avi"),
		strings.HasSuffix(raw, ".mkv"),
		strings.HasSuffix(raw, ".3gp"),
		strings.HasSuffix(raw, ".ogv"):
		return "video"
	default:
		return "image"
	}
}

func storyMediaTypeFromContentType(raw string) string {
	ct := strings.ToLower(strings.TrimSpace(raw))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	switch {
	case strings.HasPrefix(ct, "image/") && ct != "image/svg+xml":
		return "image"
	case strings.HasPrefix(ct, "video/"):
		return "video"
	default:
		return ""
	}
}

func storyMediaMaxBytes(mediaType string) int64 {
	if mediaType == "video" {
		return maxStoryVideoBytes
	}
	return 0 // no size limit for story images
}

func trimAndBoundInt(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100000 {
		return 100000
	}
	return v
}

func storyFromRow(row repository.StoryRow) StoryItem {
	mediaType := normalizeStoryMediaType(row.MediaType)
	if mediaType == "" {
		mediaType = inferStoryMediaTypeFromURL(row.MediaURL)
	}
	return StoryItem{
		ID:      strings.TrimSpace(row.ID),
		UserID:  strings.TrimSpace(row.UserID),
		Content: strings.TrimSpace(row.Content),
		Media: dto.MediaItem{
			URL:    strings.TrimSpace(row.MediaURL),
			Type:   mediaType,
			Width:  trimAndBoundInt(row.Width),
			Height: trimAndBoundInt(row.Height),
		},
		CreatedAt: row.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		ExpiresAt: row.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}

func (s *StoryService) verifyStoryMedia(ctx context.Context, userID string, media dto.MediaItem) (dto.MediaItem, error) {
	media.URL = strings.TrimSpace(media.URL)
	media.Type = normalizeStoryMediaType(media.Type)
	media.Width = trimAndBoundInt(media.Width)
	media.Height = trimAndBoundInt(media.Height)
	if media.URL == "" {
		return media, ErrStoryMediaRequired
	}
	if s.uploader == nil {
		if !isHTTPURL(media.URL) {
			return media, ErrStoryMediaURLInvalid
		}
		if media.Type == "" {
			media.Type = inferStoryMediaTypeFromURL(media.URL)
		}
		if media.Type == "" {
			return media, ErrStoryMediaTypeInvalid
		}
		return media, nil
	}

	prefix := s.uploader.KeyPrefix("story", userID) + "/"
	key, ok := s.uploader.KeyFromPublicURL(media.URL)
	if !ok || !strings.HasPrefix(key, prefix) {
		return media, ErrStoryMediaURLInvalid
	}

	st, err := s.uploader.Stat(ctx, key)
	if err != nil {
		return media, ErrStoryMediaNotFound
	}

	mediaType := storyMediaTypeFromContentType(st.ContentType)
	if mediaType == "" {
		if media.Type != "" {
			mediaType = media.Type
		} else {
			mediaType = inferStoryMediaTypeFromURL(media.URL)
		}
	}
	if mediaType == "" {
		return media, ErrStoryMediaTypeInvalid
	}

	maxBytes := storyMediaMaxBytes(mediaType)
	if st.Size <= 0 || (maxBytes > 0 && st.Size > maxBytes) {
		_ = s.uploader.Remove(ctx, key)
		return media, ErrStoryMediaTooLarge
	}

	media.URL = s.uploader.PublicURL(key)
	media.Type = mediaType
	return media, nil
}

func (s *StoryService) Create(ctx context.Context, userID string, input dto.CreateStoryRequest) (*StoryItem, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrStoryUserNotFound
	}
	if _, err := s.users.GetByID(ctx, userID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrStoryUserNotFound
		}
		return nil, err
	}

	content, err := normalizeStoryText(input.Content)
	if err != nil {
		return nil, err
	}

	media := input.Media
	if strings.TrimSpace(media.URL) == "" {
		media = dto.MediaItem{
			URL:    strings.TrimSpace(input.MediaURL),
			Type:   strings.TrimSpace(input.MediaType),
			Width:  input.Width,
			Height: input.Height,
		}
	}
	media, err = s.verifyStoryMedia(ctx, userID, media)
	if err != nil {
		return nil, err
	}

	row, err := s.stories.Create(ctx, userID, content, media.URL, media.Type, media.Width, media.Height)
	if err != nil {
		return nil, err
	}
	out := storyFromRow(*row)
	return &out, nil
}

func (s *StoryService) ListActive(ctx context.Context, viewerID string) ([]StoryGroup, error) {
	viewerID = strings.TrimSpace(viewerID)
	rows, err := s.stories.ListActive(ctx)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []StoryGroup{}, nil
	}

	groups := make([]StoryGroup, 0)
	idxByUser := make(map[string]int)
	for _, row := range rows {
		userID := strings.TrimSpace(row.UserID)
		if userID == "" {
			continue
		}
		idx, ok := idxByUser[userID]
		if !ok {
			idx = len(groups)
			group := StoryGroup{
				User: StoryAuthor{
					ID:         userID,
					Username:   strings.TrimSpace(row.Username),
					FullName:   strings.TrimSpace(row.FullName),
					IsVerified: row.IsVerified,
				},
				IsMe:     viewerID != "" && viewerID == userID,
				LatestAt: row.UserLastStoryAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
				Stories:  make([]StoryItem, 0, 4),
			}
			if row.AvatarURL.Valid {
				group.User.AvatarURL = strings.TrimSpace(row.AvatarURL.String)
			}
			groups = append(groups, group)
			idxByUser[userID] = idx
		}
		groups[idx].Stories = append(groups[idx].Stories, storyFromRow(row))
	}
	return groups, nil
}

func (s *StoryService) ListActiveByUser(ctx context.Context, userID string, viewerID string) (*StoryGroup, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrStoryUserNotFound
	}
	rows, err := s.stories.ListActiveByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrStoryNotFound
	}

	first := rows[0]
	group := &StoryGroup{
		User: StoryAuthor{
			ID:         strings.TrimSpace(first.UserID),
			Username:   strings.TrimSpace(first.Username),
			FullName:   strings.TrimSpace(first.FullName),
			IsVerified: first.IsVerified,
		},
		IsMe:     strings.TrimSpace(viewerID) != "" && strings.TrimSpace(viewerID) == strings.TrimSpace(first.UserID),
		LatestAt: first.UserLastStoryAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		Stories:  make([]StoryItem, 0, len(rows)),
	}
	if first.AvatarURL.Valid {
		group.User.AvatarURL = strings.TrimSpace(first.AvatarURL.String)
	}
	for _, row := range rows {
		group.Stories = append(group.Stories, storyFromRow(row))
	}
	return group, nil
}
