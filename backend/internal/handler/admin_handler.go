package handler

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"sduthreads/internal/auth"
	"sduthreads/internal/models"
	"sduthreads/internal/repository"
	"sduthreads/internal/service"
)

type AdminHandler struct {
	db      *gorm.DB
	users   *repository.UserRepository
	posts   *repository.PostRepository
	profile *service.ProfileService
	postSvc *service.PostService
	jwt     *auth.JWTManager
}

func NewAdminHandler(db *gorm.DB, users *repository.UserRepository, posts *repository.PostRepository, profile *service.ProfileService, postSvc *service.PostService, jwt *auth.JWTManager) *AdminHandler {
	return &AdminHandler{
		db:      db,
		users:   users,
		posts:   posts,
		profile: profile,
		postSvc: postSvc,
		jwt:     jwt,
	}
}

func (h *AdminHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/admin/stats", h.stats)
	mux.HandleFunc("/api/admin/me", h.me)
	mux.HandleFunc("/api/admin/users", h.usersList)
	mux.HandleFunc("/api/admin/users/", h.usersDynamic)
	mux.HandleFunc("/api/admin/posts/", h.postsDynamic)
}

func (h *AdminHandler) requireModeratorOrAdminUser(r *http.Request) (*models.User, error) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		return nil, err
	}
	u, err := h.users.GetByID(r.Context(), userID)
	if err != nil {
		return nil, err
	}
	role := strings.ToLower(strings.TrimSpace(u.Role))
	if role != "admin" && role != "moderator" {
		return nil, errors.New("forbidden")
	}
	return u, nil
}

func (h *AdminHandler) requireAdminUser(r *http.Request) (*models.User, error) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		return nil, err
	}
	u, err := h.users.GetByID(r.Context(), userID)
	if err != nil {
		return nil, err
	}
	role := strings.ToLower(strings.TrimSpace(u.Role))
	if role != "admin" {
		return nil, errors.New("forbidden")
	}
	return u, nil
}

func (h *AdminHandler) stats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if _, err := h.requireAdminUser(r); err != nil {
		if err.Error() == "forbidden" {
			writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
			return
		}
		writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
		return
	}

	ctx := r.Context()
	var usersCount int64
	if err := h.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM users`).Scan(&usersCount).Error; err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var postsCount int64
	if err := h.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM posts WHERE removed_at IS NULL`).Scan(&postsCount).Error; err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var active15m int64
	if err := h.db.WithContext(ctx).Raw(`
SELECT COUNT(DISTINCT user_id) FROM (
    SELECT user_id FROM posts WHERE created_at > now() - interval '15 minutes'
    UNION
    SELECT user_id FROM comments WHERE created_at > now() - interval '15 minutes'
    UNION
    SELECT user_id FROM likes WHERE created_at > now() - interval '15 minutes'
    UNION
    SELECT follower_id AS user_id FROM follows WHERE created_at > now() - interval '15 minutes'
) t
`).Scan(&active15m).Error; err != nil {
		// Not fatal: return 0 for active count if query fails (e.g., missing tables in dev).
		active15m = 0
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"users_count":      usersCount,
		"posts_count":      postsCount,
		"active_users_15m": active15m,
		"generated_at":     time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *AdminHandler) me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	u, err := h.requireAdminUser(r)
	if err != nil {
		if err.Error() == "forbidden" {
			writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
			return
		}
		writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"role":          strings.ToLower(strings.TrimSpace(u.Role)),
		"is_root_admin": u.IsRootAdmin,
	})
}

func (h *AdminHandler) usersList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	reqUser, err := h.requireAdminUser(r)
	if err != nil {
		if err.Error() == "forbidden" {
			writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
			return
		}
		writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("query"))
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)

	items, err := h.users.SearchAdmin(r.Context(), q, limit, offset, !reqUser.IsRootAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))

	out := make([]map[string]any, 0, len(items))
	for _, u := range items {
		out = append(out, map[string]any{
			"id":            u.ID,
			"email":         u.Email,
			"username":      u.Username,
			"full_name":     u.FullName,
			"is_verified":   u.IsVerified,
			"is_root_admin": u.IsRootAdmin,
			"avatar_url":    u.AvatarURL,
			"role":          u.Role,
			"created_at":    u.CreatedAt.Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *AdminHandler) resolveUser(ctx context.Context, idOrUsername string) (*models.User, error) {
	if strings.TrimSpace(idOrUsername) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if u, err := h.users.GetByID(ctx, idOrUsername); err == nil {
		return u, nil
	}
	if u, err := h.users.GetByUsername(ctx, idOrUsername); err == nil {
		return u, nil
	}
	return nil, gorm.ErrRecordNotFound
}

func (h *AdminHandler) deleteUserAndRelatedDataTx(ctx context.Context, tx *gorm.DB, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return gorm.ErrRecordNotFound
	}

	// Explicitly remove direct chats where the target user participated.
	// This also cascades messages/message_attachments/chat_user_settings for those chats.
	if err := tx.WithContext(ctx).Exec(
		`DELETE FROM chats WHERE id IN (SELECT chat_id FROM chat_participants WHERE user_id = ?)`,
		userID,
	).Error; err != nil {
		return err
	}

	// Then remove the user; the rest of related records are cleaned by FK cascades.
	res := tx.WithContext(ctx).Delete(&models.User{}, "id = ?", userID)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (h *AdminHandler) usersDynamic(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	idOrUsername := parts[0]
	if len(parts) == 1 {
		// GET /api/admin/users/:id
		// DELETE /api/admin/users/:id
		if r.Method != http.MethodGet && r.Method != http.MethodDelete {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		reqUser, err := h.requireAdminUser(r)
		if err != nil {
			if err.Error() == "forbidden" {
				writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
				return
			}
			writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
			return
		}

		target, err := h.resolveUser(r.Context(), idOrUsername)
		if err != nil {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		if target.IsRootAdmin && !reqUser.IsRootAdmin {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		if r.Method == http.MethodDelete {
			var req struct {
				TransferRootTo string `json:"transfer_root_to"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
				writeError(w, http.StatusBadRequest, "invalid json")
				return
			}
			transferRootTo := strings.TrimSpace(req.TransferRootTo)

			// Root admin deletion is allowed only with explicit transfer to another account.
			if target.IsRootAdmin {
				if transferRootTo == "" {
					writeErrorPayload(w, http.StatusBadRequest, errorPayload{
						Code:    "ROOT_TRANSFER_REQUIRED",
						Message: "root admin deletion requires transfer_root_to",
					})
					return
				}
				successor, err := h.resolveUser(r.Context(), transferRootTo)
				if err != nil {
					writeErrorPayload(w, http.StatusBadRequest, errorPayload{
						Code:    "INVALID_ROOT_TRANSFER_TARGET",
						Message: "transfer_root_to user not found",
					})
					return
				}
				if successor.ID == target.ID {
					writeErrorPayload(w, http.StatusBadRequest, errorPayload{
						Code:    "INVALID_ROOT_TRANSFER_TARGET",
						Message: "transfer_root_to must point to another user",
					})
					return
				}

				err = h.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
					updates := map[string]any{"is_root_admin": true}
					if strings.ToLower(strings.TrimSpace(successor.Role)) != "admin" {
						updates["role"] = "admin"
					}
					if err := tx.Model(&models.User{}).Where("id = ?", successor.ID).Updates(updates).Error; err != nil {
						return err
					}
					return h.deleteUserAndRelatedDataTx(r.Context(), tx, target.ID)
				})
				if err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						writeError(w, http.StatusNotFound, "not found")
						return
					}
					writeError(w, http.StatusInternalServerError, err.Error())
					return
				}
				writeJSON(w, http.StatusOK, map[string]any{
					"status":                 "deleted",
					"root_transferred_to":    successor.Username,
					"root_transferred_to_id": successor.ID,
				})
				return
			}

			// Avoid deleting yourself by accident for non-root users.
			if target.ID == reqUser.ID {
				writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "PROTECTED_USER", Message: "cannot delete yourself"})
				return
			}

			err = h.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
				return h.deleteUserAndRelatedDataTx(r.Context(), tx, target.ID)
			})
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					writeError(w, http.StatusNotFound, "not found")
					return
				}
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
			return
		}
		p, pErr := h.profile.Get(r.Context(), target.ID, nil)
		if pErr != nil {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"profile": p,
			"role":    target.Role,
			"email":   target.Email,
		})
		return
	}

	if len(parts) != 2 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	switch parts[1] {
	case "posts":
		// GET /api/admin/users/:id/posts
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		reqUser, err := h.requireAdminUser(r)
		if err != nil {
			if err.Error() == "forbidden" {
				writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
				return
			}
			writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
			return
		}

		limit := parseIntQuery(r, "limit", 20)
		offset := parseIntQuery(r, "offset", 0)
		postQuery := strings.TrimSpace(r.URL.Query().Get("query"))

		target, err := h.resolveUser(r.Context(), idOrUsername)
		if err != nil {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		if target.IsRootAdmin && !reqUser.IsRootAdmin {
			writeError(w, http.StatusNotFound, "not found")
			return
		}

		items, err := h.postSvc.ByUserQuery(r.Context(), target.ID, postQuery, limit, offset, nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		setNextOffset(w, offset, limit, len(items))
		writeJSON(w, http.StatusOK, items)
		return

	case "role":
		// PATCH /api/admin/users/:id/role
		if r.Method != http.MethodPatch {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		reqUser, err := h.requireAdminUser(r)
		if err != nil {
			if err.Error() == "forbidden" {
				writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
				return
			}
			writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
			return
		}

		target, err := h.resolveUser(r.Context(), idOrUsername)
		if err != nil {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		// Hide root admin from other admins entirely.
		if target.IsRootAdmin && !reqUser.IsRootAdmin {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		// Root admin role is protected from changes (including self-changes).
		if target.IsRootAdmin {
			writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "PROTECTED_USER", Message: "cannot change root admin role"})
			return
		}

		var req struct {
			Role string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		role := strings.ToLower(strings.TrimSpace(req.Role))
		if role != "user" && role != "moderator" && role != "admin" {
			writeError(w, http.StatusBadRequest, "invalid role")
			return
		}

		if err := h.users.UpdateRole(r.Context(), target.ID, role); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
		return
	case "verified":
		// PATCH /api/admin/users/:id/verified
		if r.Method != http.MethodPatch {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		reqUser, err := h.requireAdminUser(r)
		if err != nil {
			if err.Error() == "forbidden" {
				writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
				return
			}
			writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
			return
		}

		target, err := h.resolveUser(r.Context(), idOrUsername)
		if err != nil {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		// Hide root admin from other admins entirely.
		if target.IsRootAdmin && !reqUser.IsRootAdmin {
			writeError(w, http.StatusNotFound, "not found")
			return
		}

		var req struct {
			IsVerified *bool `json:"is_verified"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if req.IsVerified == nil {
			writeError(w, http.StatusBadRequest, "is_verified is required")
			return
		}

		if err := h.users.UpdateVerified(r.Context(), target.ID, *req.IsVerified); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
		return
	case "temp-password":
		// POST /api/admin/users/:id/temp-password
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		reqUser, err := h.requireAdminUser(r)
		if err != nil {
			if err.Error() == "forbidden" {
				writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
				return
			}
			writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
			return
		}

		target, err := h.resolveUser(r.Context(), idOrUsername)
		if err != nil {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		// Hide root admin from other admins entirely.
		if target.IsRootAdmin && !reqUser.IsRootAdmin {
			writeError(w, http.StatusNotFound, "not found")
			return
		}

		var req struct {
			TTLMinutes int `json:"ttl_minutes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		ttlMinutes := req.TTLMinutes
		if ttlMinutes == 0 {
			ttlMinutes = 60
		}
		if ttlMinutes < 5 || ttlMinutes > 1440 {
			writeError(w, http.StatusBadRequest, "ttl_minutes must be in range 5..1440")
			return
		}

		plain, err := generateTempPassword(12)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to generate temp password")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to hash temp password")
			return
		}

		expiresAt := time.Now().UTC().Add(time.Duration(ttlMinutes) * time.Minute)
		if err := h.users.SetTempPassword(r.Context(), target.ID, string(hash), expiresAt); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "ok",
			"temp_password": plain,
			"expires_at":    expiresAt.Format(time.RFC3339),
			"ttl_minutes":   ttlMinutes,
		})
		return
	default:
		writeError(w, http.StatusNotFound, "not found")
		return
	}
}

const tempPasswordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

func generateTempPassword(length int) (string, error) {
	if length <= 0 {
		return "", errors.New("invalid password length")
	}
	out := make([]byte, length)
	max := big.NewInt(int64(len(tempPasswordAlphabet)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = tempPasswordAlphabet[n.Int64()]
	}
	return string(out), nil
}

func (h *AdminHandler) postsDynamic(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/posts/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "remove" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	actor, err := h.requireModeratorOrAdminUser(r)
	if err != nil {
		if err.Error() == "forbidden" {
			writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
			return
		}
		writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
		return
	}

	postID := parts[0]
	var req struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if err := h.posts.Remove(r.Context(), postID, actor.ID, req.Reason); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(w, http.StatusNotFound, "post not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "removed"})
}
