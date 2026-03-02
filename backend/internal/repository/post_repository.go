package repository

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"
	"sduthreads/internal/models"
)

type PostRepository struct {
	db *gorm.DB
}

func NewPostRepository(db *gorm.DB) *PostRepository {
	return &PostRepository{db: db}
}

func viewerArgs(viewerID *string) (bool, any) {
	if viewerID == nil {
		return false, nil
	}
	v := strings.TrimSpace(*viewerID)
	if v == "" {
		return false, nil
	}
	return true, v
}

func (r *PostRepository) Create(ctx context.Context, post *models.Post) error {
	return r.db.WithContext(ctx).Create(post).Error
}

type PostMeta struct {
	ID      string
	UserID  string
	Content string
}

func (r *PostRepository) MetaByID(ctx context.Context, postID string) (*PostMeta, error) {
	var row PostMeta
	if err := r.db.WithContext(ctx).
		Model(&models.Post{}).
		Select("id, user_id, content").
		Where("id = ? AND removed_at IS NULL", postID).
		First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

type FeedItem struct {
	ID             string
	UserID         string
	Username       string
	FullName       string
	IsVerified     bool
	AvatarURL      string
	Content        string
	ContainerColor string
	MediaURL       string
	Media          []byte
	ViewCount      int64
	CommentCount   int64
	CreatedAt      string
	UpdatedAt      string
	LikeCount      int64
	LikedByMe      bool
}

func (r *PostRepository) QuoteTargetsByPostIDs(ctx context.Context, postIDs []string) (map[string]string, error) {
	out := make(map[string]string)
	if len(postIDs) == 0 {
		return out, nil
	}

	uniq := make([]string, 0, len(postIDs))
	seen := make(map[string]struct{}, len(postIDs))
	for _, id := range postIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		uniq = append(uniq, id)
	}
	if len(uniq) == 0 {
		return out, nil
	}

	type row struct {
		ID           string
		QuotedPostID *string
	}
	var rows []row
	if err := r.db.WithContext(ctx).
		Model(&models.Post{}).
		Select("id, quoted_post_id").
		Where("id IN ? AND removed_at IS NULL AND quoted_post_id IS NOT NULL", uniq).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, r := range rows {
		if r.QuotedPostID == nil {
			continue
		}
		qid := strings.TrimSpace(*r.QuotedPostID)
		if qid == "" {
			continue
		}
		out[strings.TrimSpace(r.ID)] = qid
	}
	return out, nil
}

func (r *PostRepository) MusicByPostIDs(ctx context.Context, postIDs []string) (map[string]models.PostMusic, error) {
	out := make(map[string]models.PostMusic)
	if len(postIDs) == 0 {
		return out, nil
	}

	uniq := make([]string, 0, len(postIDs))
	seen := make(map[string]struct{}, len(postIDs))
	for _, id := range postIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		uniq = append(uniq, id)
	}
	if len(uniq) == 0 {
		return out, nil
	}

	var rows []models.PostMusic
	if err := r.db.WithContext(ctx).
		Where("post_id IN ?", uniq).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.PostID] = row
	}
	return out, nil
}

func (r *PostRepository) Feed(ctx context.Context, limit, offset int, viewerID *string) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent, viewer := viewerArgs(viewerID)

	var items []FeedItem
	q := ""
	if r.db.Dialector.Name() == "postgres" {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       COALESCE(pm.media, CASE WHEN p.media_url IS NOT NULL AND p.media_url <> '' THEN json_build_array(json_build_object('url', p.media_url, 'width', 0, 'height', 0)) ELSE '[]'::json END) AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id,
           json_agg(json_build_object('url', url, 'width', width, 'height', height) ORDER BY sort_order) AS media
    FROM post_media
    GROUP BY post_id
) pm ON pm.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.removed_at IS NULL
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	} else {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       NULL AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.removed_at IS NULL
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	}

	if err := r.db.WithContext(ctx).Raw(q, viewerPresent, viewer, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) FeedFollowing(ctx context.Context, followerID string, limit, offset int, viewerID *string) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent, viewer := viewerArgs(viewerID)

	var items []FeedItem
	q := ""
	if r.db.Dialector.Name() == "postgres" {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       COALESCE(pm.media, CASE WHEN p.media_url IS NOT NULL AND p.media_url <> '' THEN json_build_array(json_build_object('url', p.media_url, 'width', 0, 'height', 0)) ELSE '[]'::json END) AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN follows f ON f.followee_id = p.user_id AND f.follower_id = ?
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id,
           json_agg(json_build_object('url', url, 'width', width, 'height', height) ORDER BY sort_order) AS media
    FROM post_media
    GROUP BY post_id
) pm ON pm.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.removed_at IS NULL
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	} else {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       NULL AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN follows f ON f.followee_id = p.user_id AND f.follower_id = ?
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.removed_at IS NULL
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	}

	if err := r.db.WithContext(ctx).Raw(q, viewerPresent, followerID, viewer, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) ModerationFeed(ctx context.Context, query string, limit, offset int) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	qTrim := strings.TrimSpace(query)
	var items []FeedItem
	sql := ""
	args := make([]any, 0, 6)

	if r.db.Dialector.Name() == "postgres" {
		sql = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       COALESCE(pm.media, CASE WHEN p.media_url IS NOT NULL AND p.media_url <> '' THEN json_build_array(json_build_object('url', p.media_url, 'width', 0, 'height', 0)) ELSE '[]'::json END) AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       FALSE AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id,
           json_agg(json_build_object('url', url, 'width', width, 'height', height) ORDER BY sort_order) AS media
    FROM post_media
    GROUP BY post_id
) pm ON pm.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
WHERE p.removed_at IS NULL`
		if qTrim != "" {
			pat := "%" + qTrim + "%"
			sql += `
  AND (
    CAST(p.id AS TEXT) ILIKE ?
    OR p.content ILIKE ?
    OR u.username ILIKE ?
    OR u.full_name ILIKE ?
  )`
			args = append(args, pat, pat, pat, pat)
		}
		sql += `
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	} else {
		sql = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       NULL AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       FALSE AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
WHERE p.removed_at IS NULL`
		if qTrim != "" {
			pat := "%" + qTrim + "%"
			sql += `
  AND (
    p.id LIKE ?
    OR p.content LIKE ?
    OR u.username LIKE ?
    OR u.full_name LIKE ?
  )`
			args = append(args, pat, pat, pat, pat)
		}
		sql += `
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}

	if err := r.db.WithContext(ctx).Raw(sql, args...).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) Get(ctx context.Context, postID string, viewerID *string) (*FeedItem, error) {
	limit := 1
	offset := 0

	viewerPresent, viewer := viewerArgs(viewerID)

	var items []FeedItem
	q := ""
	if r.db.Dialector.Name() == "postgres" {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       COALESCE(pm.media, CASE WHEN p.media_url IS NOT NULL AND p.media_url <> '' THEN json_build_array(json_build_object('url', p.media_url, 'width', 0, 'height', 0)) ELSE '[]'::json END) AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id,
           json_agg(json_build_object('url', url, 'width', width, 'height', height) ORDER BY sort_order) AS media
    FROM post_media
    GROUP BY post_id
) pm ON pm.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.id = ? AND p.removed_at IS NULL
LIMIT ? OFFSET ?`
	} else {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       NULL AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.id = ? AND p.removed_at IS NULL
LIMIT ? OFFSET ?`
	}

	if err := r.db.WithContext(ctx).Raw(q, viewerPresent, viewer, postID, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return &items[0], nil
}

func (r *PostRepository) Exists(ctx context.Context, postID string) (bool, error) {
	var exists bool
	err := r.db.WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM posts WHERE id = ? AND removed_at IS NULL)`, postID).
		Scan(&exists).Error
	return exists, err
}

func (r *PostRepository) IncrementView(ctx context.Context, postID string) error {
	return r.db.WithContext(ctx).Exec(`UPDATE posts SET view_count = view_count + 1 WHERE id = ? AND removed_at IS NULL`, postID).Error
}

func (r *PostRepository) AddViewOnce(ctx context.Context, postID, userID string, windowStart time.Time) error {
	tx := r.db.WithContext(ctx)
	res := tx.Exec(
		`INSERT INTO post_view_windows (post_id, user_id, window_start) VALUES (?, ?, ?)
		 ON CONFLICT DO NOTHING`, postID, userID, windowStart)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return nil
	}
	return tx.Exec(`UPDATE posts SET view_count = view_count + 1 WHERE id = ? AND removed_at IS NULL`, postID).Error
}

func (r *PostRepository) ByUser(ctx context.Context, userID string, limit, offset int, viewerID *string) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent, viewer := viewerArgs(viewerID)

	var items []FeedItem
	q := ""
	if r.db.Dialector.Name() == "postgres" {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       COALESCE(pm.media, CASE WHEN p.media_url IS NOT NULL AND p.media_url <> '' THEN json_build_array(json_build_object('url', p.media_url, 'width', 0, 'height', 0)) ELSE '[]'::json END) AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id,
           json_agg(json_build_object('url', url, 'width', width, 'height', height) ORDER BY sort_order) AS media
    FROM post_media
    GROUP BY post_id
) pm ON pm.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.user_id = ? AND p.removed_at IS NULL
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	} else {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       NULL AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.user_id = ? AND p.removed_at IS NULL
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	}

	if err := r.db.WithContext(ctx).Raw(q, viewerPresent, viewer, userID, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) ByUserQuery(ctx context.Context, userID, query string, limit, offset int, viewerID *string) ([]FeedItem, error) {
	qTrim := strings.TrimSpace(query)
	if qTrim == "" {
		return r.ByUser(ctx, userID, limit, offset, viewerID)
	}

	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent, viewer := viewerArgs(viewerID)
	pat := "%" + qTrim + "%"

	var items []FeedItem
	sql := ""
	if r.db.Dialector.Name() == "postgres" {
		sql = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       COALESCE(pm.media, CASE WHEN p.media_url IS NOT NULL AND p.media_url <> '' THEN json_build_array(json_build_object('url', p.media_url, 'width', 0, 'height', 0)) ELSE '[]'::json END) AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id,
           json_agg(json_build_object('url', url, 'width', width, 'height', height) ORDER BY sort_order) AS media
    FROM post_media
    GROUP BY post_id
) pm ON pm.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.user_id = ? AND p.removed_at IS NULL
  AND (CAST(p.id AS TEXT) ILIKE ? OR p.content ILIKE ?)
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	} else {
		sql = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       NULL AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
WHERE p.user_id = ? AND p.removed_at IS NULL
  AND (p.id LIKE ? OR p.content LIKE ?)
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	}

	if err := r.db.WithContext(ctx).Raw(sql, viewerPresent, viewer, userID, pat, pat, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) ByHashtag(ctx context.Context, name string, limit, offset int, viewerID *string) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	viewerPresent, viewer := viewerArgs(viewerID)

	var items []FeedItem
	q := ""
	if r.db.Dialector.Name() == "postgres" {
		q = `
WITH ids AS (
    SELECT DISTINCT p.id
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.removed_at IS NULL AND (h.name = ? OR LOWER(p.content) LIKE ?)
)
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       COALESCE(pm.media, CASE WHEN p.media_url IS NOT NULL AND p.media_url <> '' THEN json_build_array(json_build_object('url', p.media_url, 'width', 0, 'height', 0)) ELSE '[]'::json END) AS media,
       p.view_count,
       p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN ids ON ids.id = p.id
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id,
           json_agg(json_build_object('url', url, 'width', width, 'height', height) ORDER BY sort_order) AS media
    FROM post_media
    GROUP BY post_id
) pm ON pm.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	} else {
		q = `
WITH ids AS (
    SELECT DISTINCT p.id
    FROM posts p
    LEFT JOIN post_hashtags ph ON ph.post_id = p.id
    LEFT JOIN hashtags h ON h.id = ph.hashtag_id
    WHERE p.removed_at IS NULL AND (h.name = ? OR LOWER(p.content) LIKE ?)
)
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       NULL AS media,
       p.view_count,
       p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       CASE WHEN ? = false THEN false ELSE COALESCE(lb.liked, false) END AS liked_by_me
FROM posts p
JOIN ids ON ids.id = p.id
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
LEFT JOIN (
    SELECT post_id, TRUE AS liked FROM likes WHERE user_id = ?
) lb ON lb.post_id = p.id
ORDER BY p.created_at DESC
LIMIT ? OFFSET ?`
	}

	pattern := "%" + strings.ToLower("#"+name) + "%"
	if err := r.db.WithContext(ctx).Raw(q, name, pattern, viewerPresent, viewer, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) LikedByUser(ctx context.Context, userID string, limit, offset int, viewerID *string) ([]FeedItem, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var items []FeedItem
	q := ""
	if r.db.Dialector.Name() == "postgres" {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       COALESCE(pm.media, CASE WHEN p.media_url IS NOT NULL AND p.media_url <> '' THEN json_build_array(json_build_object('url', p.media_url, 'width', 0, 'height', 0)) ELSE '[]'::json END) AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       TRUE AS liked_by_me
FROM likes li
JOIN posts p ON p.id = li.post_id
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id,
           json_agg(json_build_object('url', url, 'width', width, 'height', height) ORDER BY sort_order) AS media
    FROM post_media
    GROUP BY post_id
) pm ON pm.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
WHERE li.user_id = ? AND p.removed_at IS NULL
ORDER BY li.created_at DESC
LIMIT ? OFFSET ?`
	} else {
		q = `
SELECT p.id, p.user_id, u.username, u.full_name, u.is_verified, u.avatar_url, p.content, p.container_color, p.media_url,
       NULL AS media,
       p.view_count, p.created_at, p.updated_at,
       COALESCE(l.likes, 0) AS like_count,
       COALESCE(c.comments, 0) AS comment_count,
       TRUE AS liked_by_me
FROM likes li
JOIN posts p ON p.id = li.post_id
JOIN users u ON u.id = p.user_id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS likes FROM likes GROUP BY post_id
) l ON l.post_id = p.id
LEFT JOIN (
    SELECT post_id, COUNT(*) AS comments FROM comments GROUP BY post_id
) c ON c.post_id = p.id
WHERE li.user_id = ? AND p.removed_at IS NULL
ORDER BY li.created_at DESC
LIMIT ? OFFSET ?`
	}

	if err := r.db.WithContext(ctx).Raw(q, userID, limit, offset).Scan(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *PostRepository) Remove(ctx context.Context, postID, removedBy, reason string) error {
	reason = strings.TrimSpace(reason)
	var rr any
	if reason != "" {
		rr = reason
	}
	res := r.db.WithContext(ctx).Exec(
		`UPDATE posts SET removed_at = now(), removed_by = ?, removed_reason = ? WHERE id = ? AND removed_at IS NULL`,
		removedBy, rr, postID,
	)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *PostRepository) UpdateContentAndMedia(
	ctx context.Context,
	postID string,
	content string,
	mediaURL string,
	media []models.PostMedia,
) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&models.Post{}).
			Where("id = ? AND removed_at IS NULL", postID).
			Updates(map[string]any{
				"content":    content,
				"media_url":  strings.TrimSpace(mediaURL),
				"updated_at": gorm.Expr("now()"),
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}

		if err := tx.Where("post_id = ?", postID).Delete(&models.PostMedia{}).Error; err != nil {
			return err
		}

		if len(media) == 0 {
			return nil
		}
		if len(media) > 5 {
			media = media[:5]
		}
		rows := make([]models.PostMedia, 0, len(media))
		for idx, m := range media {
			u := strings.TrimSpace(m.URL)
			if u == "" {
				continue
			}
			w := m.Width
			h := m.Height
			if w < 0 {
				w = 0
			}
			if h < 0 {
				h = 0
			}
			rows = append(rows, models.PostMedia{
				PostID:    postID,
				URL:       u,
				Width:     w,
				Height:    h,
				SortOrder: idx,
			})
		}
		if len(rows) == 0 {
			return nil
		}
		return tx.Create(&rows).Error
	})
}
