package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sduthreads/internal/apperror"
	"sduthreads/internal/auth"
	"sduthreads/internal/cache"
	"sduthreads/internal/dto"
	"sduthreads/internal/moderation"
	"sduthreads/internal/service"
)

type PostHandler struct {
	service *service.PostService
	views   *service.ViewService
	jwt     *auth.JWTManager
	cache   *cache.QueryCache
}

func NewPostHandler(s *service.PostService, views *service.ViewService, jwt *auth.JWTManager, c *cache.QueryCache) *PostHandler {
	return &PostHandler{service: s, views: views, jwt: jwt, cache: c}
}

func (h *PostHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/posts", h.handlePosts)
	mux.HandleFunc("/api/posts/", h.handlePostActions)
	mux.HandleFunc("/api/posts-liked", h.handleLiked)
	mux.HandleFunc("/api/feed/following", h.handleFollowingFeed)
}

func (h *PostHandler) handlePosts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req dto.CreatePostRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		userID, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		media := req.Media
		if len(media) == 0 {
			urls := req.MediaURLs
			if len(urls) == 0 && strings.TrimSpace(req.MediaURL) != "" {
				urls = []string{req.MediaURL}
			}
			for _, u := range urls {
				u = strings.TrimSpace(u)
				if u == "" {
					continue
				}
				media = append(media, dto.MediaItem{URL: u})
			}
		}
		if err := h.service.CreateWithTags(r.Context(), userID, req.Content, media, req.Music, req.ContainerColor, req.Hashtags); err != nil {
			var rl *apperror.RateLimitError
			if errors.As(err, &rl) {
				w.Header().Set("Retry-After", strconv.Itoa(rl.RetryAfterSeconds))
				writeErrorPayload(w, http.StatusTooManyRequests, errorPayload{
					Code:              rl.Code,
					Message:           rl.Message,
					RetryAfterSeconds: rl.RetryAfterSeconds,
				})
				return
			}
			var viol *moderation.ViolationError
			if errors.As(err, &viol) {
				writeErrorPayload(w, http.StatusBadRequest, moderationViolationPayload(viol))
				return
			}
			if moderation.IsUnavailable(err) {
				writeErrorPayload(w, http.StatusServiceUnavailable, errorPayload{
					Code:    "MODERATION_UNAVAILABLE",
					Message: "Сервис модерации временно недоступен",
				})
				return
			}
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		invalidateCachePrefixes(r.Context(), h.cache, cachePrefixHashtagsSearch, cachePrefixHashtagsPopular, cachePrefixFeedPublic)
		writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
	case http.MethodGet:
		h.handleFeed(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *PostHandler) handlePostActions(w http.ResponseWriter, r *http.Request) {
	// Paths: /api/posts/{id}, /api/posts/{id}/like, /api/posts/{id}/view, /api/posts/{id}/reactions
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/posts/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")

	postID := parts[0]

	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		var viewerID *string
		if id, err := tryGetUserID(r, h.jwt); err == nil {
			viewerID = &id
		}
		post, err := h.service.Get(r.Context(), postID, viewerID)
		if err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, post)
		return
	}

	if len(parts) != 2 || (parts[1] != "like" && parts[1] != "view" && parts[1] != "reactions") {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	switch parts[1] {
	case "like":
		switch r.Method {
		case http.MethodPost:
			userID, err := requireUserID(r, h.jwt)
			if err != nil {
				writeError(w, http.StatusUnauthorized, err.Error())
				return
			}
			if err := h.service.Like(r.Context(), postID, userID); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			invalidateCachePrefixes(r.Context(), h.cache, cachePrefixFeedPublic)
			writeJSON(w, http.StatusOK, map[string]string{"status": "liked"})
		case http.MethodDelete:
			userID, err := requireUserID(r, h.jwt)
			if err != nil {
				writeError(w, http.StatusUnauthorized, err.Error())
				return
			}
			if err := h.service.Unlike(r.Context(), postID, userID); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			invalidateCachePrefixes(r.Context(), h.cache, cachePrefixFeedPublic)
			writeJSON(w, http.StatusOK, map[string]string{"status": "unliked"})
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	case "view":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		userID, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		if err := h.views.AddView(r.Context(), postID, userID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "viewed"})
	case "reactions":
		switch r.Method {
		case http.MethodPost:
			userID, err := requireUserID(r, h.jwt)
			if err != nil {
				writeError(w, http.StatusUnauthorized, err.Error())
				return
			}
			var req dto.ReactionRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "invalid json")
				return
			}
			reactions, err := h.service.React(r.Context(), postID, userID, req.Emoji)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			invalidateCachePrefixes(r.Context(), h.cache, cachePrefixFeedPublic)
			writeJSON(w, http.StatusOK, map[string]any{
				"status":    "reacted",
				"reactions": reactions,
			})
		case http.MethodDelete:
			userID, err := requireUserID(r, h.jwt)
			if err != nil {
				writeError(w, http.StatusUnauthorized, err.Error())
				return
			}
			emoji := strings.TrimSpace(r.URL.Query().Get("emoji"))
			reactions, err := h.service.Unreact(r.Context(), postID, userID, emoji)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			invalidateCachePrefixes(r.Context(), h.cache, cachePrefixFeedPublic)
			writeJSON(w, http.StatusOK, map[string]any{
				"status":    "unreacted",
				"reactions": reactions,
			})
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	}
}

func (h *PostHandler) handleFeed(w http.ResponseWriter, r *http.Request) {
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	var viewerID *string
	if id, err := tryGetUserID(r, h.jwt); err == nil {
		viewerID = &id
	}
	var (
		items []dto.FeedResponseItem
		err   error
	)
	if viewerID == nil {
		items, err = cache.GetOrLoadJSON(
			r.Context(),
			h.cache,
			cacheKeyFeedPublic(limit, offset),
			10*time.Second,
			func(ctx context.Context) ([]dto.FeedResponseItem, error) {
				return h.service.Feed(ctx, limit, offset, nil)
			},
		)
	} else {
		items, err = h.service.Feed(r.Context(), limit, offset, viewerID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}

func (h *PostHandler) handleFollowingFeed(w http.ResponseWriter, r *http.Request) {
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

	items, err := h.service.FeedFollowing(r.Context(), userID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}

func parseIntQuery(r *http.Request, key string, def int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func (h *PostHandler) handleLiked(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	items, err := h.service.LikedBy(r.Context(), userID, limit, offset, &userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}
