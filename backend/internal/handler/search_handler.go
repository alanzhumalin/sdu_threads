package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"sduthreads/internal/cache"
	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/repository"
)

type SearchHandler struct {
	users *repository.UserRepository
	cache *cache.QueryCache
}

func NewSearchHandler(users *repository.UserRepository, c *cache.QueryCache) *SearchHandler {
	return &SearchHandler{users: users, cache: c}
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
	q = strings.TrimSpace(q)
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)

	users, err := cache.GetOrLoadJSON(
		r.Context(),
		h.cache,
		cacheKeyUsersSearch(q, limit, offset),
		30*time.Second,
		func(ctx context.Context) ([]models.User, error) {
			return h.users.Search(ctx, q, limit, offset)
		},
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(users))
	resp := make([]dto.UserResponse, 0, len(users))
	for _, u := range users {
		resp = append(resp, dto.UserResponse{
			ID:            u.ID,
			Username:      u.Username,
			FullName:      u.FullName,
			Bio:           u.Bio,
			AvatarURL:     u.AvatarURL,
			BackgroundURL: u.BackgroundURL,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}
