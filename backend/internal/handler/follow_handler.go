package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/service"
)

type FollowHandler struct {
	follows *service.FollowService
	profile *service.ProfileService
	posts   *service.PostService
	jwt     *auth.JWTManager
}

func NewFollowHandler(f *service.FollowService, p *service.ProfileService, posts *service.PostService, jwt *auth.JWTManager) *FollowHandler {
	return &FollowHandler{follows: f, profile: p, posts: posts, jwt: jwt}
}

func (h *FollowHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/users/", h.handleFollowRoutes)
}

func (h *FollowHandler) handleFollowRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/users/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return
	}

	// profile route: /api/users/{id} or /api/users/me
	if len(parts) == 1 {
		h.handleProfile(w, r, parts[0])
		return
	}

	// follow-related routes
	userID := parts[0]

	switch parts[1] {
	case "posts":
		h.handleUserPosts(w, r, userID)
	case "follow":
		h.handleFollow(w, r, userID)
	case "followers":
		h.handleFollowers(w, r, userID)
	case "following":
		h.handleFollowing(w, r, userID)
	default:
		return
	}
}

func (h *FollowHandler) handleFollow(w http.ResponseWriter, r *http.Request, targetID string) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	switch r.Method {
	case http.MethodPost:
		if err := h.follows.Follow(r.Context(), userID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "followed"})
	case http.MethodDelete:
		if err := h.follows.Unfollow(r.Context(), userID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "unfollowed"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *FollowHandler) handleFollowers(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	list, err := h.follows.Followers(r.Context(), userID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(list))
	writeJSON(w, http.StatusOK, list)
}

func (h *FollowHandler) handleFollowing(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	list, err := h.follows.Following(r.Context(), userID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(list))
	writeJSON(w, http.StatusOK, list)
}

func (h *FollowHandler) handleProfile(w http.ResponseWriter, r *http.Request, idStr string) {
	var userID string
	if idStr == "me" {
		id, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		userID = id
	} else {
		userID = idStr
	}

	var viewerID *string
	if id, err := tryGetUserID(r, h.jwt); err == nil {
		viewerID = &id
	}

	switch r.Method {
	case http.MethodGet:
		p, err := h.profile.Get(r.Context(), userID, viewerID)
		if err != nil {
			// try username fallback
			if pu, err2 := h.profile.GetByUsername(r.Context(), userID, viewerID); err2 == nil {
				writeJSON(w, http.StatusOK, pu)
				return
			}
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, p)
	case http.MethodPatch:
		currentID, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		if userID != "me" && userID != currentID {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}
		var req dto.UpdateProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		p, err := h.profile.Update(r.Context(), currentID, req)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, p)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *FollowHandler) handleUserPosts(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	var viewerID *string
	if id, err := tryGetUserID(r, h.jwt); err == nil {
		viewerID = &id
	}
	items, err := h.posts.ByUser(r.Context(), userID, limit, offset, viewerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}
