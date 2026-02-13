package handler

import (
	"context"
	"net/http"
	"time"

	"sduthreads/internal/cache"
	"sduthreads/internal/repository"
	"sduthreads/internal/service"
)

type TopUsersHandler struct {
	follows *service.FollowService
	cache   *cache.QueryCache
}

func NewTopUsersHandler(f *service.FollowService, c *cache.QueryCache) *TopUsersHandler {
	return &TopUsersHandler{follows: f, cache: c}
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
	users, err := cache.GetOrLoadJSON(r.Context(), h.cache, cacheKeyTopUsers(limit), 45*time.Second, func(ctx context.Context) ([]repository.TopUser, error) {
		return h.follows.TopFollowed(ctx, limit)
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, users)
}
