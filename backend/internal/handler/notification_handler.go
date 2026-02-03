package handler

import (
	"net/http"
	"strings"

	"sduthreads/internal/auth"
	"sduthreads/internal/service"
)

type NotificationHandler struct {
	service *service.NotificationService
	jwt     *auth.JWTManager
}

func NewNotificationHandler(s *service.NotificationService, jwt *auth.JWTManager) *NotificationHandler {
	return &NotificationHandler{service: s, jwt: jwt}
}

func (h *NotificationHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/notifications", h.list)
	mux.HandleFunc("/api/notifications/", h.markRead)
	mux.HandleFunc("/api/notifications-read-all", h.markAllRead)
}

func (h *NotificationHandler) list(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	filter := r.URL.Query().Get("filter")
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)

	items, err := h.service.List(r.Context(), userID, filter, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}

func (h *NotificationHandler) markRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	// path: /api/notifications/{id}/read
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/notifications/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) != 2 || parts[1] != "read" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	notificationID := parts[0]
	if notificationID == "" {
		writeError(w, http.StatusBadRequest, "notification id required")
		return
	}
	if err := h.service.MarkRead(r.Context(), userID, notificationID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "read"})
}

func (h *NotificationHandler) markAllRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	updated, err := h.service.MarkAllRead(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "all_read", "updated": updated})
}
