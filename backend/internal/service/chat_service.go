package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/repository"
)

var (
	ErrChatForbidden       = errors.New("forbidden")
	ErrChatNotFound        = errors.New("chat not found")
	ErrChatPeerNotFound    = errors.New("target user not found")
	ErrChatTargetMissing   = errors.New("target user is required")
	ErrChatMessageEmpty    = errors.New("message body is required")
	ErrChatMessageLong     = errors.New("message too long (max 4000)")
	ErrChatMessageSelf     = errors.New("cannot message yourself")
	ErrChatReplyNotFound   = errors.New("reply message not found")
	ErrChatMessageNotFound = errors.New("message not found")
	ErrChatAttachInvalid   = errors.New("invalid message attachment")
	ErrChatAttachTooMany   = errors.New("too many message attachments (max 5)")
	ErrChatThemeInvalid    = errors.New("invalid chat theme")
)

var allowedChatAttachmentTypes = map[string]struct{}{
	"image": {},
	"audio": {},
}

const DefaultChatTheme = "default"
const ChatOnlineWindow = 2 * time.Minute

var allowedChatThemes = map[string]struct{}{
	DefaultChatTheme: {},
	"love":           {},
	"nature":         {},
	"sunset":         {},
	"ocean":          {},
	"midnight":       {},
}

type ChatService struct {
	chats     *repository.ChatRepository
	users     *repository.UserRepository
	reactions *repository.ReactionRepository
}

func NewChatService(
	chats *repository.ChatRepository,
	users *repository.UserRepository,
	reactions *repository.ReactionRepository,
) *ChatService {
	return &ChatService{chats: chats, users: users, reactions: reactions}
}

type ChatParticipant struct {
	ID         string  `json:"id"`
	Username   string  `json:"username"`
	FullName   string  `json:"full_name"`
	IsVerified bool    `json:"is_verified"`
	AvatarURL  string  `json:"avatar_url,omitempty"`
	LastSeenAt *string `json:"last_seen_at,omitempty"`
	IsOnline   bool    `json:"is_online"`
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
	ID          string                  `json:"id"`
	ChatID      string                  `json:"chat_id"`
	SenderID    string                  `json:"sender_id"`
	ReplyToID   *string                 `json:"reply_to_id,omitempty"`
	Body        string                  `json:"body"`
	Attachments []ChatMessageAttachment `json:"attachments,omitempty"`
	Reactions   []dto.ReactionItem      `json:"reactions"`
	ReadAt      *string                 `json:"read_at,omitempty"`
	CreatedAt   string                  `json:"created_at"`
}

type ChatMessageAttachment struct {
	URL      string `json:"url"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Duration int    `json:"duration_sec,omitempty"`
	Type     string `json:"type"`
}

type ChatReadUpdate struct {
	MessageID string `json:"message_id"`
	ReadAt    string `json:"read_at"`
}

type ChatAttachmentInput struct {
	URL      string
	Width    int
	Height   int
	Duration int
	Type     string
}

func normalizeChatThemeKey(value string) (string, bool) {
	key := strings.ToLower(strings.TrimSpace(value))
	if key == "" {
		key = DefaultChatTheme
	}
	_, ok := allowedChatThemes[key]
	return key, ok
}

func mapChatPreview(row repository.DirectChatRow) ChatPreview {
	out := ChatPreview{
		ID: row.ChatID,
		Participant: ChatParticipant{
			ID:         row.PeerID,
			Username:   row.PeerUsername,
			FullName:   row.PeerFullName,
			IsVerified: row.PeerIsVerified,
		},
		UnreadCount: row.UnreadCount,
	}
	if row.PeerAvatarURL.Valid {
		out.Participant.AvatarURL = strings.TrimSpace(row.PeerAvatarURL.String)
	}
	if row.PeerLastSeenAt.Valid {
		lastSeen := row.PeerLastSeenAt.Time.UTC().Format(time.RFC3339)
		out.Participant.LastSeenAt = &lastSeen
		if time.Since(row.PeerLastSeenAt.Time) <= ChatOnlineWindow {
			out.Participant.IsOnline = true
		}
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

func mapChatMessage(m models.Message, reactions []dto.ReactionItem) ChatMessage {
	if reactions == nil {
		reactions = []dto.ReactionItem{}
	}
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

	attachments := make([]ChatMessageAttachment, 0, len(m.Attachments))
	for _, att := range m.Attachments {
		typ := strings.ToLower(strings.TrimSpace(att.Type))
		if typ == "" {
			typ = "image"
		}
		attachments = append(attachments, ChatMessageAttachment{
			URL:      strings.TrimSpace(att.URL),
			Width:    att.Width,
			Height:   att.Height,
			Duration: att.Duration,
			Type:     typ,
		})
	}

	return ChatMessage{
		ID:          m.ID,
		ChatID:      m.ChatID,
		SenderID:    m.SenderID,
		ReplyToID:   replyToID,
		Body:        m.Body,
		Attachments: attachments,
		Reactions:   reactions,
		ReadAt:      readAt,
		CreatedAt:   m.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *ChatService) enrichMessageReactions(
	ctx context.Context,
	items []models.Message,
	viewerUserID string,
) (map[string][]dto.ReactionItem, error) {
	result := make(map[string][]dto.ReactionItem, len(items))
	if len(items) == 0 {
		return result, nil
	}
	ids := make([]string, 0, len(items))
	for _, it := range items {
		id := strings.TrimSpace(it.ID)
		if id == "" {
			continue
		}
		ids = append(ids, id)
	}
	if s.reactions == nil {
		for _, id := range ids {
			result[id] = []dto.ReactionItem{}
		}
		return result, nil
	}
	byMessageID, err := s.reactions.ListMessageReactions(ctx, ids, strings.TrimSpace(viewerUserID))
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		result[id] = mapReactionItems(byMessageID[id])
	}
	return result, nil
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

func (s *ChatService) ParticipantChatIDs(ctx context.Context, userID string) ([]string, error) {
	return s.chats.ParticipantChatIDs(ctx, userID)
}

func (s *ChatService) TouchPresence(ctx context.Context, userID string) error {
	return s.users.TouchLastSeen(ctx, userID, time.Now().UTC())
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
	reactionMap, err := s.enrichMessageReactions(ctx, items, userID)
	if err != nil {
		return nil, err
	}
	out := make([]ChatMessage, 0, len(items))
	for _, it := range items {
		out = append(out, mapChatMessage(it, reactionMap[it.ID]))
	}
	return out, nil
}

func (s *ChatService) Send(
	ctx context.Context,
	userID,
	chatID,
	body,
	replyToID string,
	attachments []ChatAttachmentInput,
) (*ChatMessage, error) {
	body = strings.TrimSpace(body)
	if len([]rune(body)) > 4000 {
		return nil, ErrChatMessageLong
	}

	if len(attachments) > 5 {
		return nil, ErrChatAttachTooMany
	}

	repoAttachments := make([]repository.ChatAttachmentInput, 0, len(attachments))
	for _, att := range attachments {
		url := strings.TrimSpace(att.URL)
		if url == "" {
			return nil, ErrChatAttachInvalid
		}
		typ := strings.ToLower(strings.TrimSpace(att.Type))
		if typ == "" {
			typ = "image"
		}
		if _, ok := allowedChatAttachmentTypes[typ]; !ok {
			return nil, ErrChatAttachInvalid
		}

		width := att.Width
		if width < 0 {
			width = 0
		}
		height := att.Height
		if height < 0 {
			height = 0
		}
		duration := att.Duration
		if duration < 0 {
			duration = 0
		}
		if duration > 24*60*60 {
			duration = 24 * 60 * 60
		}
		if typ == "audio" {
			width = 0
			height = 0
		} else {
			duration = 0
		}

		repoAttachments = append(repoAttachments, repository.ChatAttachmentInput{
			URL:      url,
			Width:    width,
			Height:   height,
			Duration: duration,
			Type:     typ,
		})
	}
	if body == "" && len(repoAttachments) == 0 {
		return nil, ErrChatMessageEmpty
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

	msg, err := s.chats.CreateMessage(ctx, chatID, userID, body, replyToRef, repoAttachments)
	if err != nil {
		return nil, err
	}
	out := mapChatMessage(*msg, []dto.ReactionItem{})
	return &out, nil
}

func (s *ChatService) ReactMessage(
	ctx context.Context,
	userID,
	chatID,
	messageID,
	emoji string,
) ([]dto.ReactionItem, error) {
	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return nil, err
	}
	if s.reactions == nil {
		return nil, errors.New("reactions repository is not configured")
	}

	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return nil, ErrChatMessageNotFound
	}
	exists, err := s.chats.MessageExistsInChat(ctx, chatID, messageID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrChatMessageNotFound
	}

	emoji, err = normalizeReactionEmoji(emoji)
	if err != nil {
		return nil, err
	}
	if err := s.reactions.AddMessageReaction(ctx, messageID, userID, emoji); err != nil {
		return nil, err
	}
	byMessageID, err := s.reactions.ListMessageReactions(ctx, []string{messageID}, userID)
	if err != nil {
		return nil, err
	}
	return mapReactionItems(byMessageID[messageID]), nil
}

func (s *ChatService) UnreactMessage(
	ctx context.Context,
	userID,
	chatID,
	messageID,
	emoji string,
) ([]dto.ReactionItem, error) {
	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return nil, err
	}
	if s.reactions == nil {
		return nil, errors.New("reactions repository is not configured")
	}

	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return nil, ErrChatMessageNotFound
	}
	exists, err := s.chats.MessageExistsInChat(ctx, chatID, messageID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrChatMessageNotFound
	}

	emoji, err = normalizeReactionEmoji(emoji)
	if err != nil {
		return nil, err
	}
	if err := s.reactions.RemoveMessageReaction(ctx, messageID, userID, emoji); err != nil {
		return nil, err
	}
	byMessageID, err := s.reactions.ListMessageReactions(ctx, []string{messageID}, userID)
	if err != nil {
		return nil, err
	}
	return mapReactionItems(byMessageID[messageID]), nil
}

func (s *ChatService) MarkRead(ctx context.Context, userID, chatID string) ([]ChatReadUpdate, error) {
	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return nil, err
	}
	rows, err := s.chats.MarkRead(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	updates := make([]ChatReadUpdate, 0, len(rows))
	for _, row := range rows {
		updates = append(updates, ChatReadUpdate{
			MessageID: strings.TrimSpace(row.MessageID),
			ReadAt:    row.ReadAt.UTC().Format(time.RFC3339),
		})
	}
	return updates, nil
}

func (s *ChatService) GetTheme(ctx context.Context, userID, chatID string) (string, error) {
	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return "", err
	}
	theme, err := s.chats.GetTheme(ctx, chatID)
	if err != nil {
		return "", err
	}
	if normalized, ok := normalizeChatThemeKey(theme); ok {
		return normalized, nil
	}
	return DefaultChatTheme, nil
}

func (s *ChatService) SetTheme(ctx context.Context, userID, chatID, themeKey string) (string, error) {
	if err := s.EnsureParticipant(ctx, userID, chatID); err != nil {
		return "", err
	}
	normalized, ok := normalizeChatThemeKey(themeKey)
	if !ok {
		return "", ErrChatThemeInvalid
	}
	if err := s.chats.UpdateTheme(ctx, chatID, normalized); err != nil {
		return "", err
	}
	return normalized, nil
}

func (s *ChatService) UserIdentity(ctx context.Context, userID string) (fullName string, username string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", ""
	}
	u, err := s.users.GetByID(ctx, userID)
	if err != nil || u == nil {
		return "", ""
	}
	return strings.TrimSpace(u.FullName), strings.TrimSpace(u.Username)
}
