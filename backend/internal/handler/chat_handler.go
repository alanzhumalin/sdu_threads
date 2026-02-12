package handler

import (
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
	service *service.ChatService
	jwt     *auth.JWTManager
	ws      *chatWSHub
	userWS  *chatUserWSHub
}

func NewChatHandler(s *service.ChatService, jwt *auth.JWTManager) *ChatHandler {
	return &ChatHandler{
		service: s,
		jwt:     jwt,
		ws:      newChatWSHub(),
		userWS:  newChatUserWSHub(),
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
		item, err := h.service.Send(r.Context(), userID, chatID, req.Body, req.ReplyToID)
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

		client := h.ws.register(chatID, userID, conn)
		defer h.ws.unregister(client)

		_ = client.send(map[string]any{
			"type":    "ready",
			"chat_id": chatID,
		})

		for {
			var raw string
			if err := websocket.Message.Receive(conn, &raw); err != nil {
				return
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

		client := h.userWS.register(userID, conn)
		defer h.userWS.unregister(client)

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
	updated, err := h.service.MarkRead(r.Context(), userID, chatID)
	if err != nil {
		h.writeChatError(w, err)
		return
	}
	go h.userWS.broadcastUser(userID, map[string]any{
		"type":    "chat_list_updated",
		"chat_id": chatID,
	})
	writeJSON(w, http.StatusOK, map[string]any{"status": "read", "updated": updated})
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
		errors.Is(err, service.ErrChatReplyNotFound):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}
