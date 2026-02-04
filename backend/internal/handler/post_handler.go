package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/service"
)

type PostHandler struct {
	service *service.PostService
	views   *service.ViewService
	jwt     *auth.JWTManager
}

func NewPostHandler(s *service.PostService, views *service.ViewService, jwt *auth.JWTManager) *PostHandler {
	return &PostHandler{service: s, views: views, jwt: jwt}
}

func (h *PostHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/posts", h.handlePosts)
	mux.HandleFunc("/api/posts/", h.handlePostActions)
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
		if err := h.service.CreateWithTags(r.Context(), userID, req.Content, req.MediaURL, req.Hashtags); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
	case http.MethodGet:
		limit := parseIntQuery(r, "limit", 20)
		offset := parseIntQuery(r, "offset", 0)
		var viewerID *string
		if id, err := tryGetUserID(r, h.jwt); err == nil {
			viewerID = &id
		}
		items, err := h.service.Feed(r.Context(), limit, offset, viewerID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		setNextOffset(w, offset, limit, len(items))
		writeJSON(w, http.StatusOK, items)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *PostHandler) handlePostActions(w http.ResponseWriter, r *http.Request) {
	// Paths: /api/posts/{id}, /api/posts/{id}/like, /api/posts/{id}/view
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

	if len(parts) != 2 || (parts[1] != "like" && parts[1] != "view") {
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
	}
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
