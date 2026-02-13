package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"sduthreads/internal/auth"
	"sduthreads/internal/cache"
	"sduthreads/internal/repository"
	"sduthreads/internal/service"
)

type HashtagHandler struct {
	tags  *service.HashtagService
	jwt   *auth.JWTManager
	cache *cache.QueryCache
}

func NewHashtagHandler(tags *service.HashtagService, jwt *auth.JWTManager, c *cache.QueryCache) *HashtagHandler {
	return &HashtagHandler{tags: tags, jwt: jwt, cache: c}
}

func (h *HashtagHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/hashtags/search", h.search)
	mux.HandleFunc("/api/hashtags/popular", h.popular)
	mux.HandleFunc("/api/hashtags/", h.postsByTag)
}

func (h *HashtagHandler) search(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query().Get("q")
	limit := parseIntQuery(r, "limit", 20)
	tags, err := cache.GetOrLoadJSON(
		r.Context(),
		h.cache,
		cacheKeyHashtagsSearch(q, limit),
		45*time.Second,
		func(ctx context.Context) ([]repository.Hashtag, error) {
			return h.tags.Search(ctx, q, limit)
		},
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (h *HashtagHandler) popular(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := parseIntQuery(r, "limit", 10)
	tags, err := cache.GetOrLoadJSON(
		r.Context(),
		h.cache,
		cacheKeyHashtagsPopular(limit),
		60*time.Second,
		func(ctx context.Context) ([]repository.PopularHashtag, error) {
			return h.tags.Popular(ctx, limit)
		},
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tags)
}

func (h *HashtagHandler) postsByTag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/hashtags/")
	name := strings.Trim(path, "/")
	if name == "" || name == "search" {
		return
	}
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	var viewerID *string
	if id, err := tryGetUserID(r, h.jwt); err == nil {
		viewerID = &id
	}
	items, err := h.tags.Posts(r.Context(), name, limit, offset, viewerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}
