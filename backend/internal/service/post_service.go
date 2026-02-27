package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/moderation"
	"sduthreads/internal/repository"
	"sduthreads/internal/storage"

	"gorm.io/gorm"
)

func normalizePostMediaType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "image":
		return "image"
	case "video":
		return "video"
	default:
		return ""
	}
}

func inferPostMediaTypeFromURL(raw string) string {
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

func postMediaTypeFromContentType(raw string) string {
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

func annotatePostMediaItem(it dto.MediaItem) dto.MediaItem {
	it.Type = normalizePostMediaType(it.Type)
	if it.Type == "" {
		it.Type = inferPostMediaTypeFromURL(it.URL)
	}
	return it
}

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
		out = append(out, annotatePostMediaItem(it))
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
	return []dto.MediaItem{annotatePostMediaItem(dto.MediaItem{URL: legacy})}
}

const (
	maxPostImageBytes       = 10 * 1024 * 1024
	maxPostVideoBytes       = 40 * 1024 * 1024
	maxPostMusicBytes       = 15 * 1024 * 1024
	maxPostMusicClipSeconds = 30
	maxPostMusicDurationSec = 30 * 60
)

func postMediaMaxBytes(mediaType string) int64 {
	if mediaType == "video" {
		return maxPostVideoBytes
	}
	return maxPostImageBytes
}

func postMediaMaxLabel(mediaType string) string {
	if mediaType == "video" {
		return "40MB"
	}
	return "10MB"
}

var postContainerColorAllowed = map[string]struct{}{
	"":        {},
	"ocean":   {},
	"rose":    {},
	"emerald": {},
	"amber":   {},
	"violet":  {},
}

var (
	ErrPostNotFound  = errors.New("post not found")
	ErrPostForbidden = errors.New("forbidden")
)

func normalizePostContainerColor(raw string) (string, error) {
	key := strings.TrimSpace(strings.ToLower(raw))
	if _, ok := postContainerColorAllowed[key]; !ok {
		return "", errors.New("invalid post container color")
	}
	return key, nil
}

func clampPostMusicText(raw string, max int) string {
	raw = strings.TrimSpace(raw)
	if max <= 0 {
		return raw
	}
	runes := []rune(raw)
	if len(runes) <= max {
		return raw
	}
	return string(runes[:max])
}

func isHTTPURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	if u == nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return strings.TrimSpace(u.Host) != ""
}

type PostService struct {
	posts     *repository.PostRepository
	likes     *repository.LikeRepository
	reactions *repository.ReactionRepository
	tags      *repository.HashtagRepository
	users     *repository.UserRepository
	fols      *repository.FollowRepository
	uploader  *storage.S3Uploader
	mod       *moderation.Client
}

func NewPostService(
	posts *repository.PostRepository,
	likes *repository.LikeRepository,
	reactions *repository.ReactionRepository,
	tags *repository.HashtagRepository,
	users *repository.UserRepository,
	fols *repository.FollowRepository,
	uploader *storage.S3Uploader,
	mod *moderation.Client,
) *PostService {
	return &PostService{
		posts:     posts,
		likes:     likes,
		reactions: reactions,
		tags:      tags,
		users:     users,
		fols:      fols,
		uploader:  uploader,
		mod:       mod,
	}
}

func toPostMusicDTO(m models.PostMusic) *dto.PostMusic {
	audioURL := strings.TrimSpace(m.AudioURL)
	if audioURL == "" {
		return nil
	}
	return &dto.PostMusic{
		Source:       strings.TrimSpace(m.Source),
		TrackID:      strings.TrimSpace(m.TrackID),
		Title:        strings.TrimSpace(m.Title),
		Artist:       strings.TrimSpace(m.Artist),
		CoverURL:     strings.TrimSpace(m.CoverURL),
		AudioURL:     audioURL,
		DurationSec:  m.DurationSec,
		ClipStartSec: m.ClipStartSec,
		ClipEndSec:   m.ClipEndSec,
	}
}

func (s *PostService) enrichMusic(ctx context.Context, items []repository.FeedItem) (map[string]*dto.PostMusic, error) {
	result := make(map[string]*dto.PostMusic, len(items))
	if len(items) == 0 {
		return result, nil
	}
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	rows, err := s.posts.MusicByPostIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		row, ok := rows[it.ID]
		if !ok {
			result[it.ID] = nil
			continue
		}
		result[it.ID] = toPostMusicDTO(row)
	}
	return result, nil
}

func normalizeMusicClip(durationSec, startSec, endSec int) (int, int, int, error) {
	if durationSec < 0 {
		durationSec = 0
	}
	if durationSec > maxPostMusicDurationSec {
		return 0, 0, 0, errors.New("music duration is too long")
	}
	if startSec < 0 {
		startSec = 0
	}

	if endSec <= 0 {
		if durationSec > 0 {
			endSec = durationSec
		} else {
			endSec = startSec + maxPostMusicClipSeconds
		}
	}
	if durationSec > 0 && endSec > durationSec {
		endSec = durationSec
	}
	if endSec <= startSec {
		return 0, 0, 0, errors.New("invalid music clip range")
	}
	if endSec-startSec > maxPostMusicClipSeconds {
		return 0, 0, 0, errors.New("music clip is too long (max 30 sec)")
	}
	return durationSec, startSec, endSec, nil
}

func (s *PostService) verifyUploadedPostMusic(ctx context.Context, userID, audioURL string) (string, string, error) {
	if s.uploader == nil {
		return "", "", errors.New("media storage is not configured")
	}
	key, ok := s.uploader.KeyFromPublicURL(audioURL)
	if !ok {
		return "", "", errors.New("invalid music url")
	}
	prefix := s.uploader.KeyPrefix("post_music", userID) + "/"
	if !strings.HasPrefix(key, prefix) {
		return "", "", errors.New("invalid music url")
	}
	st, err := s.uploader.Stat(ctx, key)
	if err != nil {
		return "", "", errors.New("music file not found")
	}
	if st.Size <= 0 || st.Size > maxPostMusicBytes {
		_ = s.uploader.Remove(ctx, key)
		return "", "", errors.New("music file too large (max 15MB)")
	}
	return s.uploader.PublicURL(key), key, nil
}

func runFFmpegCut(ctx context.Context, inputPath, outputPath string, clipStartSec, clipDurationSec int) error {
	args := []string{
		"-hide_banner",
		"-loglevel", "error",
		"-nostdin",
		"-y",
		"-i", inputPath,
		"-ss", strconv.Itoa(clipStartSec),
		"-t", strconv.Itoa(clipDurationSec),
		"-vn",
		"-ac", "2",
		"-ar", "44100",
		"-c:a", "libmp3lame",
		"-b:a", "160k",
		outputPath,
	}
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}
	if errors.Is(err, exec.ErrNotFound) {
		return errors.New("music processing is unavailable")
	}
	if len(out) > 0 {
		return errors.New("failed to process music clip")
	}
	return errors.New("failed to process music clip")
}

func (s *PostService) trimUploadedPostMusic(ctx context.Context, userID, sourceKey string, clipStartSec, clipEndSec int) (string, int, error) {
	if s.uploader == nil {
		return "", 0, errors.New("media storage is not configured")
	}
	clipDurationSec := clipEndSec - clipStartSec
	if clipDurationSec <= 0 {
		return "", 0, errors.New("invalid music clip range")
	}

	srcReader, srcStat, err := s.uploader.Get(ctx, sourceKey)
	if err != nil {
		return "", 0, errors.New("music file not found")
	}
	defer func() { _ = srcReader.Close() }()

	if srcStat.Size <= 0 || srcStat.Size > maxPostMusicBytes {
		return "", 0, errors.New("music file too large (max 15MB)")
	}

	tmpIn, err := os.CreateTemp("", "post-music-src-*.bin")
	if err != nil {
		return "", 0, errors.New("failed to prepare music processing")
	}
	tmpInPath := tmpIn.Name()
	defer func() {
		_ = tmpIn.Close()
		_ = os.Remove(tmpInPath)
	}()

	n, err := io.Copy(tmpIn, io.LimitReader(srcReader, maxPostMusicBytes+1))
	if err != nil {
		return "", 0, errors.New("failed to prepare music processing")
	}
	if n <= 0 || n > maxPostMusicBytes {
		return "", 0, errors.New("music file too large (max 15MB)")
	}

	tmpOut, err := os.CreateTemp("", "post-music-cut-*.mp3")
	if err != nil {
		return "", 0, errors.New("failed to prepare music processing")
	}
	tmpOutPath := tmpOut.Name()
	_ = tmpOut.Close()
	defer func() { _ = os.Remove(tmpOutPath) }()

	if err := runFFmpegCut(ctx, tmpInPath, tmpOutPath, clipStartSec, clipDurationSec); err != nil {
		return "", 0, err
	}

	outBytes, err := os.ReadFile(tmpOutPath)
	if err != nil {
		return "", 0, errors.New("failed to process music clip")
	}
	if len(outBytes) == 0 {
		return "", 0, errors.New("failed to process music clip")
	}
	if len(outBytes) > maxPostMusicBytes {
		return "", 0, errors.New("music file too large (max 15MB)")
	}

	targetKey := s.uploader.BuildKey("post_music", userID, "mp3")
	audioURL, err := s.uploader.Put(ctx, targetKey, bytes.NewReader(outBytes), int64(len(outBytes)), "audio/mpeg")
	if err != nil {
		return "", 0, errors.New("failed to save processed music")
	}
	if sourceKey != "" && sourceKey != targetKey {
		_ = s.uploader.Remove(ctx, sourceKey)
	}

	return audioURL, clipDurationSec, nil
}

func (s *PostService) preparePostMusic(ctx context.Context, userID string, input *dto.PostMusic) (*models.PostMusic, error) {
	if input == nil {
		return nil, nil
	}
	audioURL := strings.TrimSpace(input.AudioURL)
	if audioURL == "" {
		return nil, errors.New("music audio_url is required")
	}

	source := strings.ToLower(strings.TrimSpace(input.Source))
	if source == "" {
		source = "upload"
	}
	if source != "upload" {
		return nil, errors.New("only uploaded music is supported")
	}

	duration, clipStart, clipEnd, err := normalizeMusicClip(input.DurationSec, input.ClipStartSec, input.ClipEndSec)
	if err != nil {
		return nil, err
	}

	audioURL, sourceKey, err := s.verifyUploadedPostMusic(ctx, userID, audioURL)
	if err != nil {
		return nil, err
	}
	audioURL, clipDuration, err := s.trimUploadedPostMusic(ctx, userID, sourceKey, clipStart, clipEnd)
	if err != nil {
		return nil, err
	}
	duration = clipDuration
	clipStart = 0
	clipEnd = clipDuration

	title := clampPostMusicText(input.Title, 160)
	if title == "" {
		title = "Music"
	}
	artist := clampPostMusicText(input.Artist, 120)
	coverURL := strings.TrimSpace(input.CoverURL)
	if coverURL != "" && !isHTTPURL(coverURL) {
		coverURL = ""
	}

	return &models.PostMusic{
		Source:       source,
		TrackID:      clampPostMusicText(input.TrackID, 100),
		Title:        title,
		Artist:       artist,
		CoverURL:     coverURL,
		AudioURL:     audioURL,
		DurationSec:  duration,
		ClipStartSec: clipStart,
		ClipEndSec:   clipEnd,
	}, nil
}

func (s *PostService) verifyPostMedia(ctx context.Context, userID string, media []dto.MediaItem) ([]dto.MediaItem, error) {
	if s.uploader == nil || len(media) == 0 {
		return media, nil
	}

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
		mediaType := postMediaTypeFromContentType(st.ContentType)
		if mediaType == "" {
			mediaType = inferPostMediaTypeFromURL(m.URL)
		}
		if mediaType == "" {
			return nil, errors.New("invalid media type")
		}
		maxBytes := postMediaMaxBytes(mediaType)
		if st.Size <= 0 || st.Size > maxBytes {
			// If client lied about size, clean up best-effort.
			_ = s.uploader.Remove(ctx, key)
			return nil, errors.New("file too large (max " + postMediaMaxLabel(mediaType) + ")")
		}

		m.URL = s.uploader.PublicURL(key) // normalize
		m.Type = mediaType
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

func (s *PostService) enrichReactions(
	ctx context.Context,
	items []repository.FeedItem,
	viewerID *string,
) (map[string][]dto.ReactionItem, error) {
	result := make(map[string][]dto.ReactionItem, len(items))
	if len(items) == 0 {
		return result, nil
	}
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	if s.reactions == nil {
		for _, id := range ids {
			result[id] = []dto.ReactionItem{}
		}
		return result, nil
	}

	viewer := ""
	if viewerID != nil {
		viewer = strings.TrimSpace(*viewerID)
	}
	byPostID, err := s.reactions.ListPostReactions(ctx, ids, viewer)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		result[id] = mapReactionItems(byPostID[id])
	}
	return result, nil
}

func (s *PostService) Create(ctx context.Context, userID string, content string, media []dto.MediaItem, music *dto.PostMusic, containerColor string) (*models.Post, error) {
	if userID == "" {
		return nil, errors.New("user_id is required")
	}
	var author *models.User
	if s.users != nil {
		u, err := s.users.GetByID(ctx, userID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, errors.New("user not found, please re-login")
			}
			return nil, err
		}
		author = u
	}
	if len(content) == 0 {
		return nil, errors.New("content is required")
	}
	colorKey, err := normalizePostContainerColor(containerColor)
	if err != nil {
		return nil, err
	}
	if colorKey != "" {
		if author == nil {
			return nil, errors.New("verified user is required for post color")
		}
		if !author.IsVerified {
			return nil, errors.New("only verified users can set post color")
		}
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
		clean = append(clean, annotatePostMediaItem(m))
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
		if m.Type != "image" {
			continue
		}
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

	preparedMusic, err := s.preparePostMusic(ctx, userID, music)
	if err != nil {
		return nil, err
	}
	mediaURL := ""
	if len(clean) > 0 {
		mediaURL = clean[0].URL
	}

	post := models.Post{
		UserID:         userID,
		Content:        content,
		ContainerColor: colorKey,
		MediaURL:       mediaURL,
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
	if err := s.posts.CreateWithRateLimit(ctx, &post, rows, preparedMusic, limits); err != nil {
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
	musicMap, err := s.enrichMusic(ctx, items)
	if err != nil {
		return nil, err
	}
	reactionMap, err := s.enrichReactions(ctx, items, viewerID)
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
			ID:             it.ID,
			UserID:         it.UserID,
			Username:       it.Username,
			FullName:       it.FullName,
			IsVerified:     it.IsVerified,
			AvatarURL:      it.AvatarURL,
			Content:        it.Content,
			ContainerColor: it.ContainerColor,
			Media:          media,
			Music:          musicMap[it.ID],
			CreatedAt:      it.CreatedAt,
			UpdatedAt:      it.UpdatedAt,
			LikeCount:      it.LikeCount,
			LikedByMe:      it.LikedByMe,
			Reactions:      reactionMap[it.ID],
			ViewCount:      it.ViewCount,
			CommentCount:   it.CommentCount,
			Mentions:       mentionMap[it.ID],
			Hashtags:       hashtagMap[it.ID],
			IsSubscribed:   isSub,
			IsMe:           isMe,
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
	musicMap, err := s.enrichMusic(ctx, items)
	if err != nil {
		return nil, err
	}
	reactionMap, err := s.enrichReactions(ctx, items, &viewerID)
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
			ID:             it.ID,
			UserID:         it.UserID,
			Username:       it.Username,
			FullName:       it.FullName,
			IsVerified:     it.IsVerified,
			AvatarURL:      it.AvatarURL,
			Content:        it.Content,
			ContainerColor: it.ContainerColor,
			Media:          media,
			Music:          musicMap[it.ID],
			CreatedAt:      it.CreatedAt,
			UpdatedAt:      it.UpdatedAt,
			LikeCount:      it.LikeCount,
			LikedByMe:      it.LikedByMe,
			Reactions:      reactionMap[it.ID],
			ViewCount:      it.ViewCount,
			CommentCount:   it.CommentCount,
			Mentions:       mentionMap[it.ID],
			Hashtags:       hashtagMap[it.ID],
			IsSubscribed:   isSub,
			IsMe:           isMe,
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
	musicMap, err := s.enrichMusic(ctx, []repository.FeedItem{*item})
	if err != nil {
		return nil, err
	}
	reactionMap, err := s.enrichReactions(ctx, []repository.FeedItem{*item}, viewerID)
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
		ID:             item.ID,
		UserID:         item.UserID,
		Username:       item.Username,
		FullName:       item.FullName,
		IsVerified:     item.IsVerified,
		AvatarURL:      item.AvatarURL,
		Content:        item.Content,
		ContainerColor: item.ContainerColor,
		Media:          media,
		Music:          musicMap[item.ID],
		CreatedAt:      item.CreatedAt,
		UpdatedAt:      item.UpdatedAt,
		LikeCount:      item.LikeCount,
		LikedByMe:      item.LikedByMe,
		Reactions:      reactionMap[item.ID],
		ViewCount:      item.ViewCount,
		CommentCount:   item.CommentCount,
		Mentions:       mentionMap[item.ID],
		Hashtags:       hashtagMap[item.ID],
		IsSubscribed:   isSub,
		IsMe:           isMe,
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
	musicMap, err := s.enrichMusic(ctx, items)
	if err != nil {
		return nil, err
	}
	reactionMap, err := s.enrichReactions(ctx, items, viewerID)
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
			ID:             it.ID,
			UserID:         it.UserID,
			Username:       it.Username,
			FullName:       it.FullName,
			IsVerified:     it.IsVerified,
			AvatarURL:      it.AvatarURL,
			Content:        it.Content,
			ContainerColor: it.ContainerColor,
			Media:          media,
			Music:          musicMap[it.ID],
			CreatedAt:      it.CreatedAt,
			UpdatedAt:      it.UpdatedAt,
			LikeCount:      it.LikeCount,
			LikedByMe:      it.LikedByMe,
			Reactions:      reactionMap[it.ID],
			ViewCount:      it.ViewCount,
			CommentCount:   it.CommentCount,
			Mentions:       mentionMap[it.ID],
			Hashtags:       hashtagMap[it.ID],
			IsSubscribed:   isSub,
			IsMe:           isMe,
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
	musicMap, err := s.enrichMusic(ctx, items)
	if err != nil {
		return nil, err
	}
	reactionMap, err := s.enrichReactions(ctx, items, viewerID)
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
			ID:             it.ID,
			UserID:         it.UserID,
			Username:       it.Username,
			FullName:       it.FullName,
			IsVerified:     it.IsVerified,
			AvatarURL:      it.AvatarURL,
			Content:        it.Content,
			ContainerColor: it.ContainerColor,
			Media:          media,
			Music:          musicMap[it.ID],
			CreatedAt:      it.CreatedAt,
			UpdatedAt:      it.UpdatedAt,
			LikeCount:      it.LikeCount,
			LikedByMe:      it.LikedByMe,
			Reactions:      reactionMap[it.ID],
			ViewCount:      it.ViewCount,
			CommentCount:   it.CommentCount,
			Mentions:       mentionMap[it.ID],
			Hashtags:       hashtagMap[it.ID],
			IsSubscribed:   isSub,
			IsMe:           isMe,
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
	musicMap, err := s.enrichMusic(ctx, items)
	if err != nil {
		return nil, err
	}
	reactionMap, err := s.enrichReactions(ctx, items, viewerID)
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
			ID:             it.ID,
			UserID:         it.UserID,
			Username:       it.Username,
			FullName:       it.FullName,
			IsVerified:     it.IsVerified,
			AvatarURL:      it.AvatarURL,
			Content:        it.Content,
			ContainerColor: it.ContainerColor,
			Media:          media,
			Music:          musicMap[it.ID],
			CreatedAt:      it.CreatedAt,
			UpdatedAt:      it.UpdatedAt,
			LikeCount:      it.LikeCount,
			LikedByMe:      it.LikedByMe,
			Reactions:      reactionMap[it.ID],
			ViewCount:      it.ViewCount,
			CommentCount:   it.CommentCount,
			Mentions:       mentionMap[it.ID],
			Hashtags:       hashtagMap[it.ID],
			IsSubscribed:   isSub,
			IsMe:           isMe,
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
	musicMap, err := s.enrichMusic(ctx, items)
	if err != nil {
		return nil, err
	}
	reactionMap, err := s.enrichReactions(ctx, items, nil)
	if err != nil {
		return nil, err
	}
	resp := make([]dto.FeedResponseItem, 0, len(items))
	for _, it := range items {
		media := effectiveMediaItems(it.Media, it.MediaURL)
		resp = append(resp, dto.FeedResponseItem{
			ID:             it.ID,
			UserID:         it.UserID,
			Username:       it.Username,
			FullName:       it.FullName,
			IsVerified:     it.IsVerified,
			AvatarURL:      it.AvatarURL,
			Content:        it.Content,
			ContainerColor: it.ContainerColor,
			Media:          media,
			Music:          musicMap[it.ID],
			CreatedAt:      it.CreatedAt,
			UpdatedAt:      it.UpdatedAt,
			LikeCount:      it.LikeCount,
			LikedByMe:      it.LikedByMe,
			Reactions:      reactionMap[it.ID],
			ViewCount:      it.ViewCount,
			CommentCount:   it.CommentCount,
			Mentions:       mentionMap[it.ID],
			Hashtags:       hashtagMap[it.ID],
			IsSubscribed:   false,
			IsMe:           false,
		})
	}
	return resp, nil
}

func (s *PostService) Like(ctx context.Context, postID, userID string) (bool, error) {
	if userID == "" || postID == "" {
		return false, errors.New("post_id and user_id are required")
	}
	exists, err := s.posts.Exists(ctx, postID)
	if err != nil {
		return false, err
	}
	if !exists {
		return false, errors.New("post not found")
	}
	alreadyLiked, err := s.likes.IsLiked(ctx, postID, userID)
	if err != nil {
		return false, err
	}
	if alreadyLiked {
		return false, nil
	}
	if err := s.likes.Add(ctx, postID, userID); err != nil {
		return false, err
	}
	return true, nil
}

func (s *PostService) Unlike(ctx context.Context, postID, userID string) error {
	if userID == "" || postID == "" {
		return errors.New("post_id and user_id are required")
	}
	return s.likes.Remove(ctx, postID, userID)
}

func (s *PostService) React(ctx context.Context, postID, userID, emoji string) ([]dto.ReactionItem, error) {
	if userID == "" || postID == "" {
		return nil, errors.New("post_id and user_id are required")
	}
	if s.reactions == nil {
		return nil, errors.New("reactions repository is not configured")
	}
	exists, err := s.posts.Exists(ctx, postID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, errors.New("post not found")
	}

	emoji, err = normalizeReactionEmoji(emoji)
	if err != nil {
		return nil, err
	}
	if err := s.reactions.AddPostReaction(ctx, postID, userID, emoji); err != nil {
		return nil, err
	}
	reactionsByPost, err := s.reactions.ListPostReactions(ctx, []string{postID}, userID)
	if err != nil {
		return nil, err
	}
	return mapReactionItems(reactionsByPost[postID]), nil
}

func (s *PostService) Unreact(ctx context.Context, postID, userID, emoji string) ([]dto.ReactionItem, error) {
	if userID == "" || postID == "" {
		return nil, errors.New("post_id and user_id are required")
	}
	if s.reactions == nil {
		return nil, errors.New("reactions repository is not configured")
	}
	emoji, err := normalizeReactionEmoji(emoji)
	if err != nil {
		return nil, err
	}
	if err := s.reactions.RemovePostReaction(ctx, postID, userID, emoji); err != nil {
		return nil, err
	}
	reactionsByPost, err := s.reactions.ListPostReactions(ctx, []string{postID}, userID)
	if err != nil {
		return nil, err
	}
	return mapReactionItems(reactionsByPost[postID]), nil
}

// CreateWithTags creates post and attaches hashtags.
func (s *PostService) CreateWithTags(ctx context.Context, userID string, content string, media []dto.MediaItem, music *dto.PostMusic, containerColor string, tags []string) (*models.Post, error) {
	post, err := s.Create(ctx, userID, content, media, music, containerColor)
	if err != nil {
		return nil, err
	}
	normalized := normalizeTags(tags)
	if len(normalized) == 0 {
		return post, nil
	}
	idMap, err := s.tags.Upsert(ctx, normalized)
	if err != nil {
		return nil, err
	}
	if err := s.tags.AttachToPost(ctx, post.ID, idMap); err != nil {
		return nil, err
	}
	return post, nil
}

func (s *PostService) UpdateOwnWithTags(
	ctx context.Context,
	postID string,
	userID string,
	content string,
	media []dto.MediaItem,
	tags []string,
) (*dto.FeedResponseItem, error) {
	postID = strings.TrimSpace(postID)
	userID = strings.TrimSpace(userID)
	if postID == "" || userID == "" {
		return nil, errors.New("post_id and user_id are required")
	}

	meta, err := s.posts.MetaByID(ctx, postID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPostNotFound
		}
		return nil, err
	}
	if strings.TrimSpace(meta.UserID) != userID {
		return nil, ErrPostForbidden
	}

	if strings.TrimSpace(content) == "" {
		return nil, errors.New("content is required")
	}

	preview := strings.TrimSpace(content)
	if len(preview) > 160 {
		preview = preview[:160] + "..."
	}
	if err := s.mod.CheckText(ctx, content, "post_text", &moderation.AuditMeta{
		ActorUserID: userID,
		Action:      "update_post",
		TargetType:  "post",
		TargetID:    postID,
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
		clean = append(clean, annotatePostMediaItem(m))
	}

	if s.uploader != nil && len(clean) > 0 {
		verified, err := s.verifyPostMedia(ctx, userID, clean)
		if err != nil {
			return nil, err
		}
		clean = verified
	}
	for _, m := range clean {
		if m.Type != "image" {
			continue
		}
		if err := s.mod.CheckImageURL(ctx, m.URL, "post_media", &moderation.AuditMeta{
			ActorUserID: userID,
			Action:      "update_post",
			TargetType:  "post",
			TargetID:    postID,
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
	rows := make([]models.PostMedia, 0, len(clean))
	for i, m := range clean {
		rows = append(rows, models.PostMedia{
			URL:       m.URL,
			Width:     m.Width,
			Height:    m.Height,
			SortOrder: i,
		})
	}
	if err := s.posts.UpdateContentAndMedia(ctx, postID, content, mediaURL, rows); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPostNotFound
		}
		return nil, err
	}

	if s.tags != nil {
		normalized := normalizeTags(tags)
		if len(normalized) == 0 {
			normalized = normalizeTags(extractHashtagCandidates(content))
		}
		idMap, err := s.tags.Upsert(ctx, normalized)
		if err != nil {
			return nil, err
		}
		if err := s.tags.ReplaceForPost(ctx, postID, idMap); err != nil {
			return nil, err
		}
	}

	viewer := userID
	return s.Get(ctx, postID, &viewer)
}

func (s *PostService) DeleteOwn(ctx context.Context, postID string, userID string) error {
	postID = strings.TrimSpace(postID)
	userID = strings.TrimSpace(userID)
	if postID == "" || userID == "" {
		return errors.New("post_id and user_id are required")
	}

	meta, err := s.posts.MetaByID(ctx, postID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPostNotFound
		}
		return err
	}
	if strings.TrimSpace(meta.UserID) != userID {
		return ErrPostForbidden
	}

	if err := s.posts.Remove(ctx, postID, userID, "user_deleted"); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPostNotFound
		}
		return err
	}
	return nil
}

func (s *PostService) FollowerIDs(ctx context.Context, userID string) ([]string, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" || s.fols == nil {
		return []string{}, nil
	}
	return s.fols.FollowerIDs(ctx, userID)
}

func (s *PostService) UserIdentity(ctx context.Context, userID string) (fullName string, username string) {
	userID = strings.TrimSpace(userID)
	if userID == "" || s.users == nil {
		return "", ""
	}
	u, err := s.users.GetByID(ctx, userID)
	if err != nil || u == nil {
		return "", ""
	}
	return strings.TrimSpace(u.FullName), strings.TrimSpace(u.Username)
}

func (s *PostService) MetaByID(ctx context.Context, postID string) (*repository.PostMeta, error) {
	postID = strings.TrimSpace(postID)
	if postID == "" {
		return nil, errors.New("post_id is required")
	}
	return s.posts.MetaByID(ctx, postID)
}

func (s *PostService) ResolveMentionRecipients(ctx context.Context, text string, excludeUserID string) ([]MentionRecipient, error) {
	return resolveMentionRecipients(ctx, s.users, text, excludeUserID)
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
