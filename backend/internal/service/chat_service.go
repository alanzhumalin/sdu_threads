package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"sduthreads/internal/models"
	"sduthreads/internal/repository"
)

var (
	ErrChatForbidden     = errors.New("forbidden")
	ErrChatNotFound      = errors.New("chat not found")
	ErrChatPeerNotFound  = errors.New("target user not found")
	ErrChatTargetMissing = errors.New("target user is required")
	ErrChatMessageEmpty  = errors.New("message body is required")
	ErrChatMessageLong   = errors.New("message too long (max 4000)")
	ErrChatMessageSelf   = errors.New("cannot message yourself")
	ErrChatReplyNotFound = errors.New("reply message not found")
)

type ChatService struct {
	chats *repository.ChatRepository
	users *repository.UserRepository
}

func NewChatService(chats *repository.ChatRepository, users *repository.UserRepository) *ChatService {
	return &ChatService{chats: chats, users: users}
}

type ChatParticipant struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	FullName  string `json:"full_name"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

type ChatLastMessage struct {
	ID        string `json:"id"`
	SenderID  string `json:"sender_id"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
}

type ChatPreview struct {
	ID            string           `json:"id"`
	Participant   ChatParticipant  `json:"participant"`
	LastMessage   *ChatLastMessage `json:"last_message,omitempty"`
	LastMessageAt string           `json:"last_message_at,omitempty"`
	UnreadCount   int64            `json:"unread_count"`
}

type ChatMessage struct {
	ID        string  `json:"id"`
	ChatID    string  `json:"chat_id"`
	SenderID  string  `json:"sender_id"`
	ReplyToID *string `json:"reply_to_id,omitempty"`
	Body      string  `json:"body"`
	ReadAt    *string `json:"read_at,omitempty"`
	CreatedAt string  `json:"created_at"`
}

func mapChatPreview(row repository.DirectChatRow) ChatPreview {
	out := ChatPreview{
		ID: row.ChatID,
		Participant: ChatParticipant{
			ID:       row.PeerID,
			Username: row.PeerUsername,
			FullName: row.PeerFullName,
		},
		UnreadCount: row.UnreadCount,
	}
	if row.PeerAvatarURL.Valid {
		out.Participant.AvatarURL = strings.TrimSpace(row.PeerAvatarURL.String)
	}
	if row.LastMessageID.Valid {
		createdAt := ""
		if row.LastMessageAt.Valid {
			createdAt = row.LastMessageAt.Time.UTC().Format(time.RFC3339)
			out.LastMessageAt = createdAt
		}
		out.LastMessage = &ChatLastMessage{
			ID:        strings.TrimSpace(row.LastMessageID.String),
			SenderID:  strings.TrimSpace(row.LastMessageSenderID.String),
			Body:      row.LastMessageBody.String,
			CreatedAt: createdAt,
		}
	}
	return out
}

func mapChatMessage(m models.Message) ChatMessage {
	var readAt *string
	if m.ReadAt != nil {
		v := m.ReadAt.UTC().Format(time.RFC3339)
		readAt = &v
	}

	var replyToID *string
	if m.ReplyToID != nil {
		v := strings.TrimSpace(*m.ReplyToID)
		if v != "" {
			replyToID = &v
		}
	}

	return ChatMessage{
		ID:        m.ID,
		ChatID:    m.ChatID,
		SenderID:  m.SenderID,
		ReplyToID: replyToID,
		Body:      m.Body,
		ReadAt:    readAt,
		CreatedAt: m.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *ChatService) OpenDirect(ctx context.Context, userID, targetUserID, targetUsername string) (*ChatPreview, error) {
	targetUserID = strings.TrimSpace(targetUserID)
	targetUsername = strings.TrimSpace(targetUsername)

	if targetUserID == "" && targetUsername == "" {
		return nil, ErrChatTargetMissing
	}

	var (
		target *models.User
		err    error
	)
	if targetUserID != "" {
		target, err = s.users.GetByID(ctx, targetUserID)
	} else {
		target, err = s.users.GetByUsername(ctx, targetUsername)
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrChatPeerNotFound
		}
		return nil, err
	}

	if target.ID == userID {
		return nil, ErrChatMessageSelf
	}

	chatID, err := s.chats.CreateOrGetDirect(ctx, userID, target.ID)
	if err != nil {
		return nil, err
	}

	return s.GetByID(ctx, userID, chatID)
}

func (s *ChatService) List(ctx context.Context, userID string, limit, offset int) ([]ChatPreview, error) {
	rows, err := s.chats.ListDirectChats(ctx, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	out := make([]ChatPreview, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapChatPreview(row))
	}
	return out, nil
}

func (s *ChatService) GetByID(ctx context.Context, userID, chatID string) (*ChatPreview, error) {
	row, err := s.chats.GetDirectChat(ctx, userID, chatID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrChatNotFound
		}
		return nil, err
	}
	out := mapChatPreview(*row)
	return &out, nil
}

func (s *ChatService) EnsureParticipant(ctx context.Context, userID, chatID string) error {
	ok, err := s.chats.IsParticipant(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrChatForbidden
	}
	return nil
}

func (s *ChatService) ParticipantIDs(ctx context.Context, userID, chatID string) ([]string, error) {
	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return nil, err
	}
	return s.chats.ParticipantIDs(ctx, chatID)
}

func (s *ChatService) UnreadCount(ctx context.Context, userID string) (int64, error) {
	return s.chats.UnreadCount(ctx, userID)
}

func (s *ChatService) Messages(ctx context.Context, userID, chatID string, limit, offset int) ([]ChatMessage, error) {
	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return nil, err
	}

	items, err := s.chats.ListMessages(ctx, chatID, limit, offset)
	if err != nil {
		return nil, err
	}
	out := make([]ChatMessage, 0, len(items))
	for _, it := range items {
		out = append(out, mapChatMessage(it))
	}
	return out, nil
}

func (s *ChatService) Send(ctx context.Context, userID, chatID, body, replyToID string) (*ChatMessage, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, ErrChatMessageEmpty
	}
	if len([]rune(body)) > 4000 {
		return nil, ErrChatMessageLong
	}

	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return nil, err
	}

	replyToID = strings.TrimSpace(replyToID)
	var replyToRef *string
	if replyToID != "" {
		ok, err := s.chats.MessageExistsInChat(ctx, chatID, replyToID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrChatReplyNotFound
		}
		replyToRef = &replyToID
	}

	msg, err := s.chats.CreateMessage(ctx, chatID, userID, body, replyToRef)
	if err != nil {
		return nil, err
	}
	out := mapChatMessage(*msg)
	return &out, nil
}

func (s *ChatService) MarkRead(ctx context.Context, userID, chatID string) (int64, error) {
	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return 0, err
	}
	return s.chats.MarkRead(ctx, chatID, userID)
}
