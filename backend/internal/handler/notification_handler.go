package handler

import (
	"net/http"

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
