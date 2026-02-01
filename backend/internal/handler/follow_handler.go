package handler

import (
	"net/http"
	"strconv"
	"strings"

	"sduthreads/internal/auth"
	"sduthreads/internal/service"
)

type FollowHandler struct {
	follows *service.FollowService
	profile *service.ProfileService
	jwt     *auth.JWTManager
}

func NewFollowHandler(f *service.FollowService, p *service.ProfileService, jwt *auth.JWTManager) *FollowHandler {
	return &FollowHandler{follows: f, profile: p, jwt: jwt}
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
	userID, err := strconv.ParseUint(parts[0], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	switch parts[1] {
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

func (h *FollowHandler) handleFollow(w http.ResponseWriter, r *http.Request, targetID uint64) {
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

func (h *FollowHandler) handleFollowers(w http.ResponseWriter, r *http.Request, userID uint64) {
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

func (h *FollowHandler) handleFollowing(w http.ResponseWriter, r *http.Request, userID uint64) {
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
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var userID uint64
	if idStr == "me" {
		id, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		userID = id
	} else {
		id, err := strconv.ParseUint(idStr, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid user id")
			return
		}
		userID = id
	}

	p, err := h.profile.Get(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, p)
}
