package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"gorm.io/gorm"
	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/repository"
	"sduthreads/internal/service"
)

// ModerationHandler exposes a limited set of moderation endpoints (for moderators/admins).
// It intentionally does NOT include user/role management.
type ModerationHandler struct {
	users     *repository.UserRepository
	posts     *repository.PostRepository
	postSvc   *service.PostService
	reportSvc *service.ReportService
	logs      *repository.ModerationEventRepository
	jwt       *auth.JWTManager
}

func NewModerationHandler(
	users *repository.UserRepository,
	posts *repository.PostRepository,
	postSvc *service.PostService,
	reportSvc *service.ReportService,
	logs *repository.ModerationEventRepository,
	jwt *auth.JWTManager,
) *ModerationHandler {
	return &ModerationHandler{
		users:     users,
		posts:     posts,
		postSvc:   postSvc,
		reportSvc: reportSvc,
		logs:      logs,
		jwt:       jwt,
	}
}

func (h *ModerationHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/moderation/posts", h.postsList)
	mux.HandleFunc("/api/moderation/posts/", h.postsDynamic)
	mux.HandleFunc("/api/moderation/reports", h.reportsList)
	mux.HandleFunc("/api/moderation/reports/", h.reportsDynamic)
	mux.HandleFunc("/api/moderation/logs", h.logsList)
}

func (h *ModerationHandler) requireModeratorOrAdmin(r *http.Request) (string, error) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		return "", err
	}
	u, err := h.users.GetByID(r.Context(), userID)
	if err != nil {
		return "", err
	}
	role := strings.ToLower(strings.TrimSpace(u.Role))
	if role != "admin" && role != "moderator" {
		return "", errors.New("forbidden")
	}
	return userID, nil
}

func (h *ModerationHandler) postsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if _, err := h.requireModeratorOrAdmin(r); err != nil {
		if err.Error() == "forbidden" {
			writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
			return
		}
		writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
		return
	}

	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	q := strings.TrimSpace(r.URL.Query().Get("query"))

	items, err := h.postSvc.ModerationFeed(r.Context(), q, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}

func (h *ModerationHandler) postsDynamic(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/moderation/posts/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "remove" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	actorID, err := h.requireModeratorOrAdmin(r)
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

	if err := h.posts.Remove(r.Context(), postID, actorID, req.Reason); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(w, http.StatusNotFound, "post not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "removed"})
}

func (h *ModerationHandler) reportsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if _, err := h.requireModeratorOrAdmin(r); err != nil {
		if err.Error() == "forbidden" {
			writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
			return
		}
		writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
		return
	}

	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	status := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
	if status != "" && status != "open" && status != "resolved" && status != "rejected" {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{Code: "INVALID_STATUS", Message: "invalid status"})
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("query"))

	items, err := h.reportSvc.ListModeration(r.Context(), status, q, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
}

func (h *ModerationHandler) reportsDynamic(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/moderation/reports/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	reportID := parts[0]
	if len(parts) == 1 {
		// GET /api/moderation/reports/:id
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if _, err := h.requireModeratorOrAdmin(r); err != nil {
			if err.Error() == "forbidden" {
				writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
				return
			}
			writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
			return
		}

		item, err := h.reportSvc.GetModeration(r.Context(), reportID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				writeError(w, http.StatusNotFound, "report not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}

	if len(parts) == 2 && parts[1] == "resolve" {
		// POST /api/moderation/reports/:id/resolve
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		actorID, err := h.requireModeratorOrAdmin(r)
		if err != nil {
			if err.Error() == "forbidden" {
				writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
				return
			}
			writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
			return
		}

		var req struct {
			Status string `json:"status"`
			Note   string `json:"note"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if err := h.reportSvc.ResolveModeration(r.Context(), reportID, actorID, req.Status, req.Note); err != nil {
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				writeError(w, http.StatusNotFound, "report not found")
			case errors.Is(err, gorm.ErrInvalidData):
				writeErrorPayload(w, http.StatusBadRequest, errorPayload{Code: "INVALID_STATUS", Message: "invalid status"})
			default:
				writeError(w, http.StatusInternalServerError, err.Error())
			}
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
		return
	}

	writeError(w, http.StatusNotFound, "not found")
}

func (h *ModerationHandler) logsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if _, err := h.requireModeratorOrAdmin(r); err != nil {
		if err.Error() == "forbidden" {
			writeErrorPayload(w, http.StatusForbidden, errorPayload{Code: "FORBIDDEN", Message: "forbidden"})
			return
		}
		writeErrorPayload(w, http.StatusUnauthorized, errorPayload{Code: "UNAUTHORIZED", Message: "unauthorized"})
		return
	}
	if h.logs == nil {
		writeJSON(w, http.StatusOK, []dto.ModerationLogItem{})
		return
	}

	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	query := strings.TrimSpace(r.URL.Query().Get("query"))

	rows, err := h.logs.List(r.Context(), scope, query, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]dto.ModerationLogItem, 0, len(rows))
	for _, row := range rows {
		var matched []string
		_ = json.Unmarshal([]byte(row.MatchedTermsJSON), &matched)
		var labels map[string]float64
		_ = json.Unmarshal([]byte(row.LabelsJSON), &labels)
		var payload map[string]any
		_ = json.Unmarshal([]byte(row.PayloadJSON), &payload)

		out = append(out, dto.ModerationLogItem{
			ID:             row.ID,
			ActorUserID:    row.ActorUserID,
			ActorUsername:  row.ActorUsername,
			ActorFullName:  row.ActorFullName,
			ActorAvatarURL: row.ActorAvatarURL,
			Scope:          row.Scope,
			Action:         row.Action,
			TargetType:     row.TargetType,
			TargetID:       row.TargetID,
			Blocked:        row.Blocked,
			Reason:         row.Reason,
			Score:          row.Score,
			Source:         row.Source,
			MatchedTerms:   matched,
			Labels:         labels,
			Payload:        payload,
			CreatedAt:      row.CreatedAt,
		})
	}

	setNextOffset(w, offset, limit, len(out))
	writeJSON(w, http.StatusOK, out)
}
