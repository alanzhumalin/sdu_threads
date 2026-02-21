package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"sduthreads/internal/auth"
	"sduthreads/internal/cache"
	"sduthreads/internal/dto"
	"sduthreads/internal/moderation"
	"sduthreads/internal/service"

	"github.com/google/uuid"
)

type FollowHandler struct {
	follows  *service.FollowService
	profile  *service.ProfileService
	posts    *service.PostService
	telegram *service.TelegramService
	jwt      *auth.JWTManager
	cache    *cache.QueryCache
}

func NewFollowHandler(f *service.FollowService, p *service.ProfileService, posts *service.PostService, tg *service.TelegramService, jwt *auth.JWTManager, c *cache.QueryCache) *FollowHandler {
	return &FollowHandler{follows: f, profile: p, posts: posts, telegram: tg, jwt: jwt, cache: c}
}

func (h *FollowHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/users/me/password", h.handleChangePassword)
	mux.HandleFunc("/api/users/", h.handleFollowRoutes)
}

func (h *FollowHandler) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	currentID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	var req dto.ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	if err := h.profile.ChangePassword(r.Context(), currentID, req.CurrentPassword, req.NewPassword); err != nil {
		switch {
		case errors.Is(err, service.ErrCurrentPasswordInvalid):
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "INVALID_CURRENT_PASSWORD",
				Message: "Текущий пароль неверный",
			})
			return
		case errors.Is(err, service.ErrNewPasswordTooShort):
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "WEAK_PASSWORD",
				Message: "Новый пароль должен быть минимум 8 символов",
			})
			return
		case errors.Is(err, service.ErrNewPasswordSameAsOld):
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "PASSWORD_UNCHANGED",
				Message: "Новый пароль должен отличаться от текущего",
			})
			return
		default:
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "password_changed"})
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
		inserted, err := h.follows.Follow(r.Context(), userID, targetID)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if inserted {
			go h.notifyTelegramFollow(userID, targetID)
		}
		invalidateCachePrefixes(r.Context(), h.cache, cachePrefixTopUsers)
		writeJSON(w, http.StatusOK, map[string]string{"status": "followed"})
	case http.MethodDelete:
		if err := h.follows.Unfollow(r.Context(), userID, targetID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		invalidateCachePrefixes(r.Context(), h.cache, cachePrefixTopUsers)
		writeJSON(w, http.StatusOK, map[string]string{"status": "unfollowed"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *FollowHandler) notifyTelegramFollow(actorID, targetID string) {
	if h.telegram == nil || !h.telegram.Enabled() {
		return
	}
	actorID = strings.TrimSpace(actorID)
	targetID = strings.TrimSpace(targetID)
	if actorID == "" || targetID == "" || actorID == targetID {
		return
	}
	actorFullName, actorUsername := h.posts.UserIdentity(context.Background(), actorID)
	if err := h.telegram.NotifySiteNotification(context.Background(), service.TelegramSiteNotification{
		RecipientUserID: targetID,
		Type:            "follow",
		ActorFullName:   actorFullName,
		ActorUsername:   actorUsername,
	}); err != nil {
		log.Printf("follow telegram notify failed: actor_id=%s recipient_id=%s err=%v", actorID, targetID, err)
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
	var userKey string
	if idStr == "me" {
		id, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		userKey = id
	} else {
		userKey = idStr
	}

	var viewerID *string
	if id, err := tryGetUserID(r, h.jwt); err == nil {
		viewerID = &id
	}

	switch r.Method {
	case http.MethodGet:
		// ✅ decide route BEFORE hitting DB
		if _, err := uuid.Parse(userKey); err == nil {
			p, err := h.profile.Get(r.Context(), userKey, viewerID)
			if err != nil {
				writeError(w, http.StatusNotFound, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, p)
			return
		}

		// not a UUID => treat as username
		p, err := h.profile.GetByUsername(r.Context(), userKey, viewerID)
		if err != nil {
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
		// IMPORTANT: PATCH should only allow "me" or UUID of current user; username PATCH is ambiguous
		if idStr != "me" && userKey != currentID {
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
		invalidateCachePrefixes(r.Context(), h.cache, cachePrefixUsersSearch, cachePrefixTopUsers)
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
