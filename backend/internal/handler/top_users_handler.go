package handler

import (
	"net/http"
	"sduthreads/internal/service"
)

type TopUsersHandler struct {
	follows *service.FollowService
}

func NewTopUsersHandler(f *service.FollowService) *TopUsersHandler {
	return &TopUsersHandler{follows: f}
}

func (h *TopUsersHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/top-users", h.top)
}

func (h *TopUsersHandler) top(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := parseIntQuery(r, "limit", 3)
	users, err := h.follows.TopFollowed(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}
