package handler

import (
	"net/http"

	"sduthreads/internal/repository"
)

type SearchHandler struct {
	users *repository.UserRepository
}

func NewSearchHandler(users *repository.UserRepository) *SearchHandler {
	return &SearchHandler{users: users}
}

func (h *SearchHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/users/search", h.searchUsers)
}

func (h *SearchHandler) searchUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query().Get("q")
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)

	users, err := h.users.Search(r.Context(), q, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(users))
	writeJSON(w, http.StatusOK, users)
}
