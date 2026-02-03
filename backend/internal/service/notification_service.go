package service

import (
	"context"
	"fmt"
	"sort"
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
	CreatedAt     time.Time
	Message       string
}

func (s *NotificationService) List(ctx context.Context, userID string, filter string, limit, offset int) ([]dto.Notification, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	fetchLimit := limit + offset + 20

	rows := make([]notificationRow, 0)

	if filter != "mentions" {
		likeRows, err := s.fetchLikes(ctx, userID, fetchLimit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, likeRows...)

		commentRows, err := s.fetchComments(ctx, userID, fetchLimit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, commentRows...)

		followRows, err := s.fetchFollows(ctx, userID, fetchLimit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, followRows...)
	}

	if filter == "mentions" || filter == "" || filter == "all" {
		mentionRows, err := s.fetchMentions(ctx, userID, fetchLimit)
		if err != nil {
			return nil, err
		}
		rows = append(rows, mentionRows...)
	}

	sort.Slice(rows, func(i, j int) bool {
		return rows[i].CreatedAt.After(rows[j].CreatedAt)
	})

	if offset >= len(rows) {
		return []dto.Notification{}, nil
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	selected := rows[offset:end]

	result := make([]dto.Notification, 0, len(selected))
	for _, r := range selected {
		result = append(result, dto.Notification{
			ID:            fmt.Sprintf("%s:%s", r.Type, r.RowID),
			Type:          r.Type,
			ActorID:       r.ActorID,
			ActorUsername: r.ActorUsername,
			ActorFullName: r.ActorFullName,
			PostID:        derefString(r.PostID),
			CommentID:     derefString(r.CommentID),
			CreatedAt:     r.CreatedAt,
			Message:       r.Message,
		})
	}
	return result, nil
}

func (s *NotificationService) fetchLikes(ctx context.Context, userID string, limit int) ([]notificationRow, error) {
	var rows []notificationRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT l.id as row_id, 'like' as type, u.id as actor_id, u.username as actor_username, u.full_name as actor_full_name,
		       p.id as post_id, NULL::uuid as comment_id, l.created_at, '' as message
		FROM likes l
		JOIN posts p ON p.id = l.post_id
		JOIN users u ON u.id = l.user_id
		WHERE p.user_id = ? AND l.user_id <> ?
		ORDER BY l.created_at DESC
		LIMIT ?
	`, userID, userID, limit).Scan(&rows).Error
	if rows == nil {
		rows = []notificationRow{}
	}
	return rows, err
}

func (s *NotificationService) fetchComments(ctx context.Context, userID string, limit int) ([]notificationRow, error) {
	var rows []notificationRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT c.id as row_id, 'comment' as type, u.id as actor_id, u.username as actor_username, u.full_name as actor_full_name,
		       c.post_id as post_id, c.id as comment_id, c.created_at, '' as message
		FROM comments c
		JOIN posts p ON p.id = c.post_id
		JOIN users u ON u.id = c.user_id
		WHERE p.user_id = ? AND c.user_id <> ?
		ORDER BY c.created_at DESC
		LIMIT ?
	`, userID, userID, limit).Scan(&rows).Error
	if rows == nil {
		rows = []notificationRow{}
	}
	return rows, err
}

func (s *NotificationService) fetchFollows(ctx context.Context, userID string, limit int) ([]notificationRow, error) {
	var rows []notificationRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT f.id as row_id, 'follow' as type, u.id as actor_id, u.username as actor_username, u.full_name as actor_full_name,
		       NULL::uuid as post_id, NULL::uuid as comment_id, f.created_at, '' as message
		FROM follows f
		JOIN users u ON u.id = f.follower_id
		WHERE f.followee_id = ?
		ORDER BY f.created_at DESC
		LIMIT ?
	`, userID, limit).Scan(&rows).Error
	if rows == nil {
		rows = []notificationRow{}
	}
	return rows, err
}

func (s *NotificationService) fetchMentions(ctx context.Context, userID string, limit int) ([]notificationRow, error) {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	username := strings.TrimSpace(user.Username)
	if username == "" {
		return []notificationRow{}, nil
	}
	pattern := "%@" + username + "%"
	var rows []notificationRow
	err = s.db.WithContext(ctx).Raw(`
		SELECT p.id as row_id, 'mention' as type, u.id as actor_id, u.username as actor_username, u.full_name as actor_full_name,
		       p.id as post_id, NULL::uuid as comment_id, p.created_at, '' as message
		FROM posts p
		JOIN users u ON u.id = p.user_id
		WHERE p.content ILIKE ? AND p.user_id <> ?
		ORDER BY p.created_at DESC
		LIMIT ?
	`, pattern, userID, limit).Scan(&rows).Error
	if rows == nil {
		rows = []notificationRow{}
	}
	return rows, err
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
