package repository

import (
	"context"
	"strings"

	"gorm.io/gorm"
)

type ReactionRepository struct {
	db *gorm.DB
}

func NewReactionRepository(db *gorm.DB) *ReactionRepository {
	return &ReactionRepository{db: db}
}

type ReactionAggregate struct {
	TargetID    string `gorm:"column:target_id"`
	Emoji       string `gorm:"column:emoji"`
	Count       int64  `gorm:"column:count"`
	ReactedByMe bool   `gorm:"column:reacted_by_me"`
}

func viewerUUIDArg(raw string) any {
	v := strings.TrimSpace(raw)
	if v == "" {
		return nil
	}
	return v
}

func normalizeIDs(raw []string) []string {
	if len(raw) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, id := range raw {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func buildReactionMap(targetIDs []string, rows []ReactionAggregate) map[string][]ReactionAggregate {
	out := make(map[string][]ReactionAggregate, len(targetIDs))
	for _, id := range targetIDs {
		out[id] = []ReactionAggregate{}
	}
	for _, row := range rows {
		targetID := strings.TrimSpace(row.TargetID)
		emoji := strings.TrimSpace(row.Emoji)
		if targetID == "" || emoji == "" || row.Count <= 0 {
			continue
		}
		row.TargetID = targetID
		row.Emoji = emoji
		out[targetID] = append(out[targetID], row)
	}
	return out
}

func (r *ReactionRepository) ListPostReactions(
	ctx context.Context,
	postIDs []string,
	viewerUserID string,
) (map[string][]ReactionAggregate, error) {
	targetIDs := normalizeIDs(postIDs)
	if len(targetIDs) == 0 {
		return map[string][]ReactionAggregate{}, nil
	}

	var rows []ReactionAggregate
	q := `
SELECT
	post_id AS target_id,
	emoji,
	COUNT(*)::bigint AS count,
	COALESCE(MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END), 0) = 1 AS reacted_by_me
FROM post_reactions
WHERE post_id IN ?
GROUP BY post_id, emoji
ORDER BY count DESC, emoji ASC`
	if err := r.db.WithContext(ctx).Raw(q, viewerUUIDArg(viewerUserID), targetIDs).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []ReactionAggregate{}
	}
	return buildReactionMap(targetIDs, rows), nil
}

func (r *ReactionRepository) ListMessageReactions(
	ctx context.Context,
	messageIDs []string,
	viewerUserID string,
) (map[string][]ReactionAggregate, error) {
	targetIDs := normalizeIDs(messageIDs)
	if len(targetIDs) == 0 {
		return map[string][]ReactionAggregate{}, nil
	}

	var rows []ReactionAggregate
	q := `
SELECT
	message_id AS target_id,
	emoji,
	COUNT(*)::bigint AS count,
	COALESCE(MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END), 0) = 1 AS reacted_by_me
FROM message_reactions
WHERE message_id IN ?
GROUP BY message_id, emoji
ORDER BY count DESC, emoji ASC`
	if err := r.db.WithContext(ctx).Raw(q, viewerUUIDArg(viewerUserID), targetIDs).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []ReactionAggregate{}
	}
	return buildReactionMap(targetIDs, rows), nil
}

func (r *ReactionRepository) AddPostReaction(ctx context.Context, postID, userID, emoji string) error {
	const q = `
INSERT INTO post_reactions (post_id, user_id, emoji)
VALUES (?, ?, ?)
ON CONFLICT DO NOTHING`
	return r.db.WithContext(ctx).Exec(q, postID, userID, emoji).Error
}

func (r *ReactionRepository) RemovePostReaction(ctx context.Context, postID, userID, emoji string) error {
	const q = `
DELETE FROM post_reactions
WHERE post_id = ? AND user_id = ? AND emoji = ?`
	return r.db.WithContext(ctx).Exec(q, postID, userID, emoji).Error
}

func (r *ReactionRepository) AddMessageReaction(ctx context.Context, messageID, userID, emoji string) error {
	const q = `
INSERT INTO message_reactions (message_id, user_id, emoji)
VALUES (?, ?, ?)
ON CONFLICT DO NOTHING`
	return r.db.WithContext(ctx).Exec(q, messageID, userID, emoji).Error
}

func (r *ReactionRepository) RemoveMessageReaction(ctx context.Context, messageID, userID, emoji string) error {
	const q = `
DELETE FROM message_reactions
WHERE message_id = ? AND user_id = ? AND emoji = ?`
	return r.db.WithContext(ctx).Exec(q, messageID, userID, emoji).Error
}
