package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"golang.org/x/net/websocket"
	"gorm.io/gorm"

	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/service"
)

type ChatHandler struct {
	service  *service.ChatService
	telegram *service.TelegramService
	jwt      *auth.JWTManager
	ws       *chatWSHub
	userWS   *chatUserWSHub
}

func NewChatHandler(s *service.ChatService, tg *service.TelegramService, jwt *auth.JWTManager) *ChatHandler {
	return &ChatHandler{
		service:  s,
		telegram: tg,
		jwt:      jwt,
		ws:       newChatWSHub(),
		userWS:   newChatUserWSHub(),
	}
}

func (h *ChatHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/chats/direct", h.handleDirect)
	mux.HandleFunc("/api/chats", h.handleChats)
	mux.HandleFunc("/api/chats/ws", h.handleListWS)
	mux.HandleFunc("/api/chats-unread", h.handleUnreadCount)
	mux.HandleFunc("/api/chats/", h.handleChatActions)
}

func (h *ChatHandler) handleDirect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	var req dto.OpenDirectChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	chat, err := h.service.OpenDirect(r.Context(), userID, req.UserID, req.Username)
	if err != nil {
		h.writeChatError(w, err)
		return
	}
	h.applyPreviewPresence(chat)
	writeJSON(w, http.StatusOK, chat)
}

func (h *ChatHandler) handleChats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)

	items, err := h.service.List(r.Context(), userID, limit, offset)
	if err != nil {
		h.writeChatError(w, err)
		return
	}
	h.applyListPresence(items)
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}

func (h *ChatHandler) handleChatActions(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/chats/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	chatID := strings.TrimSpace(parts[0])
	if len(parts) == 1 {
		h.handleChatByID(w, r, chatID)
		return
	}

	if len(parts) != 2 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	switch parts[1] {
	case "messages":
		h.handleMessages(w, r, chatID)
	case "read":
		h.handleRead(w, r, chatID)
	case "ws":
		h.handleWS(w, r, chatID)
	case "theme":
		h.handleTheme(w, r, chatID)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func (h *ChatHandler) handleChatByID(w http.ResponseWriter, r *http.Request, chatID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	item, err := h.service.GetByID(r.Context(), userID, chatID)
	if err != nil {
		h.writeChatError(w, err)
		return
	}
	h.applyPreviewPresence(item)
	writeJSON(w, http.StatusOK, item)
}

func (h *ChatHandler) handleMessages(w http.ResponseWriter, r *http.Request, chatID string) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	switch r.Method {
	case http.MethodGet:
		limit := parseIntQuery(r, "limit", 30)
		offset := parseIntQuery(r, "offset", 0)
		items, err := h.service.Messages(r.Context(), userID, chatID, limit, offset)
		if err != nil {
			h.writeChatError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		setNextOffset(w, offset, limit, len(items))
		writeJSON(w, http.StatusOK, items)
	case http.MethodPost:
		var req dto.SendMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		attachments := make([]service.ChatAttachmentInput, 0, len(req.Attachments))
		for _, att := range req.Attachments {
			attachments = append(attachments, service.ChatAttachmentInput{
				URL:      att.URL,
				Width:    att.Width,
				Height:   att.Height,
				Duration: att.Duration,
				Type:     att.Type,
			})
		}

		item, err := h.service.Send(r.Context(), userID, chatID, req.Body, req.ReplyToID, attachments)
		if err != nil {
			h.writeChatError(w, err)
			return
		}
		go h.ws.broadcast(chatID, map[string]any{
			"type":    "message_created",
			"chat_id": chatID,
			"message": item,
		})
		participantIDs, err := h.service.ParticipantIDs(r.Context(), userID, chatID)
		if err == nil {
			go h.userWS.broadcastMany(participantIDs, map[string]any{
				"type":       "chat_list_updated",
				"chat_id":    chatID,
				"message_id": item.ID,
			})
			go h.notifyTelegramRecipients(userID, chatID, item, participantIDs)
		}
		writeJSON(w, http.StatusCreated, item)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *ChatHandler) handleWS(w http.ResponseWriter, r *http.Request, chatID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	websocket.Handler(func(conn *websocket.Conn) {
		userID, err := h.wsAuthenticate(conn)
		if err != nil {
			_ = websocket.Message.Send(conn, `{"type":"error","message":"unauthorized"}`)
			_ = conn.Close()
			return
		}

		if err := h.service.EnsureParticipant(r.Context(), userID, chatID); err != nil {
			_ = websocket.Message.Send(conn, `{"type":"error","message":"forbidden"}`)
			_ = conn.Close()
			return
		}

		wasOnline := h.isUserOnline(userID)
		client := h.ws.register(chatID, userID, conn)
		nowOnline := h.isUserOnline(userID)
		_ = h.service.TouchPresence(context.Background(), userID)

		if !wasOnline && nowOnline {
			h.broadcastPresenceToUserChats(userID, true, nil)
		}
		go h.ws.broadcast(chatID, map[string]any{
			"type":      "chat_presence_updated",
			"chat_id":   chatID,
			"user_id":   userID,
			"is_online": true,
		})
		defer func() {
			go h.ws.broadcast(chatID, map[string]any{
				"type":      "chat_typing",
				"chat_id":   chatID,
				"user_id":   userID,
				"is_typing": false,
			})
			h.ws.unregister(client)
			now := time.Now().UTC()
			if !h.isUserOnline(userID) {
				_ = h.service.TouchPresence(context.Background(), userID)
				h.broadcastPresenceToUserChats(userID, false, &now)
			}
		}()

		_ = client.send(map[string]any{
			"type":    "ready",
			"chat_id": chatID,
		})

		for {
			var raw string
			if err := websocket.Message.Receive(conn, &raw); err != nil {
				return
			}

			var frame struct {
				Type     string `json:"type"`
				ChatID   string `json:"chat_id"`
				IsTyping bool   `json:"is_typing"`
			}
			if err := json.Unmarshal([]byte(raw), &frame); err != nil {
				continue
			}

			switch strings.ToLower(strings.TrimSpace(frame.Type)) {
			case "typing", "chat_typing":
				if frame.ChatID != "" && strings.TrimSpace(frame.ChatID) != chatID {
					continue
				}
				go h.ws.broadcast(chatID, map[string]any{
					"type":      "chat_typing",
					"chat_id":   chatID,
					"user_id":   userID,
					"is_typing": frame.IsTyping,
				})
			}
		}
	}).ServeHTTP(w, r)
}

func (h *ChatHandler) handleListWS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	websocket.Handler(func(conn *websocket.Conn) {
		userID, err := h.wsAuthenticate(conn)
		if err != nil {
			_ = websocket.Message.Send(conn, `{"type":"error","message":"unauthorized"}`)
			_ = conn.Close()
			return
		}

		wasOnline := h.isUserOnline(userID)
		client := h.userWS.register(userID, conn)
		nowOnline := h.isUserOnline(userID)
		_ = h.service.TouchPresence(context.Background(), userID)

		if !wasOnline && nowOnline {
			h.broadcastPresenceToUserChats(userID, true, nil)
		}

		defer func() {
			h.userWS.unregister(client)
			now := time.Now().UTC()
			if !h.isUserOnline(userID) {
				_ = h.service.TouchPresence(context.Background(), userID)
				h.broadcastPresenceToUserChats(userID, false, &now)
			}
		}()

		_ = client.send(map[string]any{
			"type": "ready",
		})

		for {
			var raw string
			if err := websocket.Message.Receive(conn, &raw); err != nil {
				return
			}
		}
	}).ServeHTTP(w, r)
}

func (h *ChatHandler) wsAuthenticate(conn *websocket.Conn) (string, error) {
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	var authRaw string
	if err := websocket.Message.Receive(conn, &authRaw); err != nil {
		return "", err
	}

	var authFrame struct {
		Type  string `json:"type"`
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(authRaw), &authFrame); err != nil || strings.TrimSpace(authFrame.Type) != "auth" {
		return "", errors.New("unauthorized")
	}

	claims, err := h.jwt.Parse(strings.TrimSpace(authFrame.Token))
	if err != nil {
		return "", err
	}

	userID := strings.TrimSpace(claims.UserID)
	if userID == "" {
		return "", errors.New("unauthorized")
	}

	_ = conn.SetReadDeadline(time.Time{})
	return userID, nil
}

func (h *ChatHandler) handleRead(w http.ResponseWriter, r *http.Request, chatID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	updates, err := h.service.MarkRead(r.Context(), userID, chatID)
	if err != nil {
		h.writeChatError(w, err)
		return
	}
	if len(updates) > 0 {
		messageIDs := make([]string, 0, len(updates))
		readAt := ""
		for _, item := range updates {
			id := strings.TrimSpace(item.MessageID)
			if id == "" {
				continue
			}
			messageIDs = append(messageIDs, id)
			if readAt == "" {
				readAt = strings.TrimSpace(item.ReadAt)
			}
		}
		if len(messageIDs) > 0 {
			payload := map[string]any{
				"type":        "messages_read",
				"chat_id":     chatID,
				"user_id":     userID,
				"message_ids": messageIDs,
			}
			if readAt != "" {
				payload["read_at"] = readAt
			}
			go h.ws.broadcast(chatID, payload)
		}
	}
	go h.userWS.broadcastUser(userID, map[string]any{
		"type":    "chat_list_updated",
		"chat_id": chatID,
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "read", "updated": len(updates)})
}

func (h *ChatHandler) handleUnreadCount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	count, err := h.service.UnreadCount(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"unread_count": count})
}

func (h *ChatHandler) handleTheme(w http.ResponseWriter, r *http.Request, chatID string) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	switch r.Method {
	case http.MethodGet:
		themeKey, err := h.service.GetTheme(r.Context(), userID, chatID)
		if err != nil {
			h.writeChatError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, dto.ChatThemeResponse{ThemeKey: themeKey})
	case http.MethodPut:
		var req dto.UpdateChatThemeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		themeKey, err := h.service.SetTheme(r.Context(), userID, chatID, req.ThemeKey)
		if err != nil {
			h.writeChatError(w, err)
			return
		}
		go h.ws.broadcast(chatID, map[string]any{
			"type":      "chat_theme_updated",
			"chat_id":   chatID,
			"theme_key": themeKey,
		})
		writeJSON(w, http.StatusOK, dto.ChatThemeResponse{ThemeKey: themeKey})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *ChatHandler) isUserOnline(userID string) bool {
	if strings.TrimSpace(userID) == "" {
		return false
	}
	return h.userWS.isOnline(userID) || h.ws.isUserOnline(userID)
}

func (h *ChatHandler) applyPreviewPresence(item *service.ChatPreview) {
	if item == nil {
		return
	}
	item.Participant.IsOnline = item.Participant.IsOnline || h.isUserOnline(item.Participant.ID)
}

func (h *ChatHandler) applyListPresence(items []service.ChatPreview) {
	for i := range items {
		items[i].Participant.IsOnline = items[i].Participant.IsOnline || h.isUserOnline(items[i].Participant.ID)
	}
}

func (h *ChatHandler) broadcastPresenceToUserChats(userID string, isOnline bool, lastSeenAt *time.Time) {
	chatIDs, err := h.service.ParticipantChatIDs(context.Background(), userID)
	if err != nil || len(chatIDs) == 0 {
		return
	}
	for _, chatID := range chatIDs {
		payload := map[string]any{
			"type":      "chat_presence_updated",
			"chat_id":   chatID,
			"user_id":   userID,
			"is_online": isOnline,
		}
		if lastSeenAt != nil {
			payload["last_seen_at"] = lastSeenAt.UTC().Format(time.RFC3339)
		}
		go h.ws.broadcast(chatID, payload)
	}
}

func (h *ChatHandler) writeChatError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrChatForbidden):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, service.ErrChatNotFound), errors.Is(err, service.ErrChatPeerNotFound), errors.Is(err, gorm.ErrRecordNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrChatTargetMissing),
		errors.Is(err, service.ErrChatMessageEmpty),
		errors.Is(err, service.ErrChatMessageLong),
		errors.Is(err, service.ErrChatMessageSelf),
		errors.Is(err, service.ErrChatReplyNotFound),
		errors.Is(err, service.ErrChatAttachInvalid),
		errors.Is(err, service.ErrChatAttachTooMany),
		errors.Is(err, service.ErrChatThemeInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}

func (h *ChatHandler) notifyTelegramRecipients(senderID, chatID string, item *service.ChatMessage, participantIDs []string) {
	if h.telegram == nil || !h.telegram.Enabled() || item == nil {
		return
	}
	senderName, senderUsername := h.service.UserIdentity(context.Background(), senderID)
	preview := buildChatNotificationPreview(item)

	for _, rawID := range participantIDs {
		recipientID := strings.TrimSpace(rawID)
		if recipientID == "" || recipientID == strings.TrimSpace(senderID) {
			continue
		}
		if h.isUserOnline(recipientID) {
			continue
		}
		_ = h.telegram.NotifyDirectMessage(context.Background(), service.TelegramDirectMessageNotification{
			RecipientUserID: recipientID,
			ChatID:          chatID,
			SenderFullName:  senderName,
			SenderUsername:  senderUsername,
			MessagePreview:  preview,
		})
	}
}

func buildChatNotificationPreview(item *service.ChatMessage) string {
	body := strings.TrimSpace(item.Body)
	if body != "" {
		return body
	}
	if len(item.Attachments) == 0 {
		return "Новое сообщение"
	}

	hasAudio := false
	hasImage := false
	for _, att := range item.Attachments {
		switch strings.ToLower(strings.TrimSpace(att.Type)) {
		case "audio":
			hasAudio = true
		default:
			hasImage = true
		}
	}

	if hasAudio && !hasImage {
		if len(item.Attachments) == 1 {
			return "Голосовое сообщение"
		}
		return "Голосовые сообщения"
	}
	if hasImage && !hasAudio {
		if len(item.Attachments) == 1 {
			return "Фото"
		}
		return "Вложения"
	}
	return "Сообщение с вложениями"
}
