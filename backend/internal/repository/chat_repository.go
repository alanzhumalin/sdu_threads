package repository

import (
	"context"
	"database/sql"
	"strings"

	"gorm.io/gorm"

	"sduthreads/internal/models"
)

type ChatRepository struct {
	db *gorm.DB
}

func NewChatRepository(db *gorm.DB) *ChatRepository {
	return &ChatRepository{db: db}
}

func directChatKey(userA, userB string) string {
	if strings.Compare(userA, userB) < 0 {
		return userA + ":" + userB
	}
	return userB + ":" + userA
}

func (r *ChatRepository) CreateOrGetDirect(ctx context.Context, userA, userB string) (string, error) {
	key := directChatKey(userA, userB)
	var chatID string

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw(`SELECT id FROM chats WHERE direct_key = ? LIMIT 1`, key).Scan(&chatID).Error; err != nil {
			return err
		}

		if strings.TrimSpace(chatID) == "" {
			if err := tx.Raw(`
				INSERT INTO chats (kind, direct_key, created_at, updated_at)
				VALUES ('direct', ?, now(), now())
				ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL
				DO UPDATE SET direct_key = EXCLUDED.direct_key
				RETURNING id
			`, key).Scan(&chatID).Error; err != nil {
				return err
			}
		}

		if err := tx.Exec(`
			INSERT INTO chat_participants (chat_id, user_id, created_at)
			VALUES (?, ?, now()), (?, ?, now())
			ON CONFLICT DO NOTHING
		`, chatID, userA, chatID, userB).Error; err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return "", err
	}

	return chatID, nil
}

func (r *ChatRepository) IsParticipant(ctx context.Context, chatID, userID string) (bool, error) {
	var ok bool
	if err := r.db.WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_id = ?)`, chatID, userID).
		Scan(&ok).Error; err != nil {
		return false, err
	}
	return ok, nil
}

func (r *ChatRepository) ParticipantIDs(ctx context.Context, chatID string) ([]string, error) {
	var ids []string
	if err := r.db.WithContext(ctx).
		Raw(`SELECT user_id FROM chat_participants WHERE chat_id = ?`, chatID).
		Scan(&ids).Error; err != nil {
		return nil, err
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, nil
}

func (r *ChatRepository) UnreadCount(ctx context.Context, userID string) (int64, error) {
	var count int64
	q := `
SELECT COUNT(*)::bigint
FROM messages m
JOIN chat_participants cp ON cp.chat_id = m.chat_id
WHERE cp.user_id = ? AND m.sender_id <> ? AND m.read_at IS NULL`
	if err := r.db.WithContext(ctx).Raw(q, userID, userID).Scan(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

type DirectChatRow struct {
	ChatID              string
	PeerID              string
	PeerUsername        string
	PeerFullName        string
	PeerAvatarURL       sql.NullString
	LastMessageID       sql.NullString
	LastMessageSenderID sql.NullString
	LastMessageBody     sql.NullString
	LastMessageAt       sql.NullTime
	UnreadCount         int64
}

func (r *ChatRepository) ListDirectChats(ctx context.Context, userID string, limit, offset int) ([]DirectChatRow, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var rows []DirectChatRow
	q := `
SELECT
    c.id AS chat_id,
    peer.id AS peer_id,
    peer.username AS peer_username,
    peer.full_name AS peer_full_name,
    peer.avatar_url AS peer_avatar_url,
    lm.id AS last_message_id,
    lm.sender_id AS last_message_sender_id,
    lm.body AS last_message_body,
    lm.created_at AS last_message_at,
    COALESCE(uc.unread_count, 0) AS unread_count
FROM chats c
JOIN chat_participants me ON me.chat_id = c.id AND me.user_id = ?
JOIN chat_participants cp ON cp.chat_id = c.id AND cp.user_id <> me.user_id
JOIN users peer ON peer.id = cp.user_id
LEFT JOIN LATERAL (
    SELECT m.id, m.sender_id, m.body, m.created_at
    FROM messages m
    WHERE m.chat_id = c.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
) lm ON TRUE
LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS unread_count
    FROM messages mu
    WHERE mu.chat_id = c.id AND mu.sender_id <> me.user_id AND mu.read_at IS NULL
) uc ON TRUE
WHERE c.kind = 'direct'
ORDER BY COALESCE(lm.created_at, c.updated_at) DESC, c.id DESC
LIMIT ? OFFSET ?`

	if err := r.db.WithContext(ctx).Raw(q, userID, limit, offset).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []DirectChatRow{}
	}
	return rows, nil
}

func (r *ChatRepository) GetDirectChat(ctx context.Context, userID, chatID string) (*DirectChatRow, error) {
	var row DirectChatRow
	q := `
SELECT
    c.id AS chat_id,
    peer.id AS peer_id,
    peer.username AS peer_username,
    peer.full_name AS peer_full_name,
    peer.avatar_url AS peer_avatar_url,
    lm.id AS last_message_id,
    lm.sender_id AS last_message_sender_id,
    lm.body AS last_message_body,
    lm.created_at AS last_message_at,
    COALESCE(uc.unread_count, 0) AS unread_count
FROM chats c
JOIN chat_participants me ON me.chat_id = c.id AND me.user_id = ?
JOIN chat_participants cp ON cp.chat_id = c.id AND cp.user_id <> me.user_id
JOIN users peer ON peer.id = cp.user_id
LEFT JOIN LATERAL (
    SELECT m.id, m.sender_id, m.body, m.created_at
    FROM messages m
    WHERE m.chat_id = c.id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
) lm ON TRUE
LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS unread_count
    FROM messages mu
    WHERE mu.chat_id = c.id AND mu.sender_id <> me.user_id AND mu.read_at IS NULL
) uc ON TRUE
WHERE c.kind = 'direct' AND c.id = ?
LIMIT 1`

	if err := r.db.WithContext(ctx).Raw(q, userID, chatID).Scan(&row).Error; err != nil {
		return nil, err
	}
	if strings.TrimSpace(row.ChatID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, nil
}

func (r *ChatRepository) ListMessages(ctx context.Context, chatID string, limit, offset int) ([]models.Message, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var rows []models.Message
	q := `
SELECT id, chat_id, sender_id, reply_to_id, body, read_at, created_at
FROM messages
WHERE chat_id = ?
ORDER BY created_at DESC, id DESC
LIMIT ? OFFSET ?`
	if err := r.db.WithContext(ctx).Raw(q, chatID, limit, offset).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []models.Message{}
	}
	return rows, nil
}

func (r *ChatRepository) MessageExistsInChat(ctx context.Context, chatID, messageID string) (bool, error) {
	var exists bool
	err := r.db.WithContext(ctx).
		Raw(`SELECT EXISTS (SELECT 1 FROM messages WHERE id = ? AND chat_id = ?)`, messageID, chatID).
		Scan(&exists).Error
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *ChatRepository) CreateMessage(ctx context.Context, chatID, senderID, body string, replyToID *string) (*models.Message, error) {
	var out models.Message
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Raw(`
			INSERT INTO messages (chat_id, sender_id, reply_to_id, body, created_at)
			VALUES (?, ?, ?, ?, now())
			RETURNING id, chat_id, sender_id, reply_to_id, body, read_at, created_at
		`, chatID, senderID, replyToID, body).Scan(&out).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE chats SET updated_at = now() WHERE id = ?`, chatID).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (r *ChatRepository) MarkRead(ctx context.Context, chatID, userID string) (int64, error) {
	res := r.db.WithContext(ctx).Exec(`
		UPDATE messages
		SET read_at = now()
		WHERE chat_id = ? AND sender_id <> ? AND read_at IS NULL
	`, chatID, userID)
	return res.RowsAffected, res.Error
}
