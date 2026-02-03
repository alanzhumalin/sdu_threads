package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"sduthreads/internal/dto"
	"sduthreads/internal/repository"
)

type NotificationService struct {
	db    *gorm.DB
	users *repository.UserRepository
}

func NewNotificationService(db *gorm.DB, users *repository.UserRepository) *NotificationService {
	return &NotificationService{db: db, users: users}
}

type notificationRow struct {
	RowID         string
	Type          string
	ActorID       string
	ActorUsername string
	ActorFullName string
	PostID        *string
	CommentID     *string
	PostContent   string
	PostMediaURL  *string
	CommentBody   *string
	CreatedAt     time.Time
	Message       string
	Read          bool
}

func (s *NotificationService) List(ctx context.Context, userID string, filter string, limit, offset int) ([]dto.Notification, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	username := strings.TrimSpace(user.Username)
	pattern := "%@" + username + "%"

	mentionsOnly := filter == "mentions"

	whereClause := "1=1"
	if mentionsOnly {
		whereClause = "n.type IN ('mention_post','mention_comment','reply_comment')"
	}

	var rows []notificationRow
	q := `
WITH n AS (
    SELECT l.id AS row_id, 'like' AS type, l.user_id AS actor_id, p.id AS post_id, NULL::uuid AS comment_id,
           p.content AS post_content, p.media_url AS post_media_url, NULL::text AS comment_body, l.created_at
    FROM likes l
    JOIN posts p ON p.id = l.post_id
    WHERE p.user_id = ? AND l.user_id <> ?

    UNION ALL
    SELECT c.id AS row_id, 'comment' AS type, c.user_id AS actor_id, c.post_id AS post_id, c.id AS comment_id,
           p.content AS post_content, p.media_url AS post_media_url, c.body AS comment_body, c.created_at
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE p.user_id = ? AND c.user_id <> ?

    UNION ALL
    SELECT f.id AS row_id, 'follow' AS type, f.follower_id AS actor_id, NULL::uuid AS post_id, NULL::uuid AS comment_id,
           NULL::text AS post_content, NULL::text AS post_media_url, NULL::text AS comment_body, f.created_at
    FROM follows f
    WHERE f.followee_id = ?

    UNION ALL
    SELECT p.id AS row_id, 'mention_post' AS type, p.user_id AS actor_id, p.id AS post_id, NULL::uuid AS comment_id,
           p.content AS post_content, p.media_url AS post_media_url, NULL::text AS comment_body, p.created_at
    FROM posts p
    WHERE p.content ILIKE ? AND p.user_id <> ?

    UNION ALL
    SELECT c.id AS row_id, 'mention_comment' AS type, c.user_id AS actor_id, c.post_id AS post_id, c.id AS comment_id,
           p.content AS post_content, p.media_url AS post_media_url, c.body AS comment_body, c.created_at
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE c.body ILIKE ? AND c.user_id <> ? AND (c.reply_to_comment_id IS NULL OR c.reply_to_comment_id NOT IN (SELECT id FROM comments WHERE user_id = ?))

    UNION ALL
    SELECT c.id AS row_id, 'reply_comment' AS type, c.user_id AS actor_id, c.post_id AS post_id, c.id AS comment_id,
           p.content AS post_content, p.media_url AS post_media_url, c.body AS comment_body, c.created_at
    FROM comments c
    JOIN comments parent ON parent.id = c.reply_to_comment_id
    JOIN posts p ON p.id = parent.post_id
    WHERE parent.user_id = ? AND c.user_id <> ?
)
SELECT n.row_id, n.type, n.actor_id, n.post_id, n.comment_id, n.post_content, n.post_media_url, n.comment_body, n.created_at,
       u.username AS actor_username, u.full_name AS actor_full_name,
       COALESCE(r.read, false) AS read
FROM n
JOIN users u ON u.id = n.actor_id
LEFT JOIN (
    SELECT notification_id, TRUE AS read FROM notification_reads WHERE user_id = ?
) r ON r.notification_id = CONCAT(n.type, ':', n.row_id)
WHERE ` + whereClause + `
ORDER BY n.created_at DESC, n.row_id
LIMIT ? OFFSET ?`

	err = s.db.WithContext(ctx).Raw(
		q,
		userID, userID, // likes
		userID, userID, // comments
		userID,          // follows
		pattern, userID, // mention posts
		pattern, userID, userID, // mention comments excluding direct replies already captured
		userID, userID, // reply to my comment
		userID, // read join
		limit, offset,
	).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []notificationRow{}
	}

	result := make([]dto.Notification, 0, len(rows))
	for _, r := range rows {
		result = append(result, dto.Notification{
			ID:            fmt.Sprintf("%s:%s", r.Type, r.RowID),
			Type:          r.Type,
			ActorID:       r.ActorID,
			ActorUsername: r.ActorUsername,
			ActorFullName: r.ActorFullName,
			PostID:        derefString(r.PostID),
			CommentID:     derefString(r.CommentID),
			PostContent:   r.PostContent,
			PostMediaURL:  derefString(r.PostMediaURL),
			CommentBody:   derefString(r.CommentBody),
			CreatedAt:     r.CreatedAt,
			Message:       r.Message,
			Read:          r.Read,
		})
	}
	return result, nil
}

func (s *NotificationService) MarkRead(ctx context.Context, userID, notificationID string) error {
	if userID == "" || notificationID == "" {
		return fmt.Errorf("user_id and notification_id are required")
	}
	return s.db.WithContext(ctx).Exec(
		`INSERT INTO notification_reads (user_id, notification_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
		userID, notificationID,
	).Error
}

func (s *NotificationService) MarkAllRead(ctx context.Context, userID string) (int64, error) {
	if userID == "" {
		return 0, fmt.Errorf("user_id is required")
	}
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return 0, err
	}
	pattern := "%@" + strings.TrimSpace(user.Username) + "%"

	q := `
WITH n AS (
    SELECT l.id AS row_id, 'like' AS type, l.user_id AS actor_id, p.id AS post_id, NULL::uuid AS comment_id
    FROM likes l
    JOIN posts p ON p.id = l.post_id
    WHERE p.user_id = ? AND l.user_id <> ?

    UNION ALL
    SELECT c.id AS row_id, 'comment' AS type, c.user_id AS actor_id, c.post_id AS post_id, c.id AS comment_id
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE p.user_id = ? AND c.user_id <> ?

    UNION ALL
    SELECT f.id AS row_id, 'follow' AS type, f.follower_id AS actor_id, NULL::uuid AS post_id, NULL::uuid AS comment_id
    FROM follows f
    WHERE f.followee_id = ?

    UNION ALL
    SELECT p.id AS row_id, 'mention_post' AS type, p.user_id AS actor_id, p.id AS post_id, NULL::uuid AS comment_id
    FROM posts p
    WHERE p.content ILIKE ? AND p.user_id <> ?

    UNION ALL
    SELECT c.id AS row_id, 'mention_comment' AS type, c.user_id AS actor_id, c.post_id AS post_id, c.id AS comment_id
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE c.body ILIKE ? AND c.user_id <> ? AND (c.reply_to_comment_id IS NULL OR c.reply_to_comment_id NOT IN (SELECT id FROM comments WHERE user_id = ?))

    UNION ALL
    SELECT c.id AS row_id, 'reply_comment' AS type, c.user_id AS actor_id, c.post_id AS post_id, c.id AS comment_id
    FROM comments c
    JOIN comments parent ON parent.id = c.reply_to_comment_id
    JOIN posts p ON p.id = parent.post_id
    WHERE parent.user_id = ? AND c.user_id <> ?
)
INSERT INTO notification_reads (user_id, notification_id)
SELECT ?, CONCAT(n.type, ':', n.row_id)
FROM n
ON CONFLICT DO NOTHING;`

	res := s.db.WithContext(ctx).Exec(
		q,
		userID, userID, // likes
		userID, userID, // comments
		userID,          // follows
		pattern, userID, // mention posts
		pattern, userID, userID, // mention comments
		userID, userID, // reply to my comment
		userID, // insert user_id
	)
	return res.RowsAffected, res.Error
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
