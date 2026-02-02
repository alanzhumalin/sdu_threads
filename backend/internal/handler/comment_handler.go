package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/service"
)

type CommentHandler struct {
	comments *service.CommentService
	jwt      *auth.JWTManager
}

func NewCommentHandler(c *service.CommentService, jwt *auth.JWTManager) *CommentHandler {
	return &CommentHandler{comments: c, jwt: jwt}
}

func (h *CommentHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/comments", h.handleComments)
	mux.HandleFunc("/api/comments/", h.handleDynamic)
}

func (h *CommentHandler) handleComments(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.create(w, r)
	case http.MethodGet:
		h.list(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *CommentHandler) create(w http.ResponseWriter, r *http.Request) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req dto.CreateCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := h.comments.Create(r.Context(), req.PostID, userID, req.Content); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}

func (h *CommentHandler) list(w http.ResponseWriter, r *http.Request) {
	postID := r.URL.Query().Get("post_id")
	if postID == "" {
		writeError(w, http.StatusBadRequest, "post_id is required")
		return
	}
	ctx := r.Context()
	viewerID, _ := tryGetUserID(r, h.jwt)
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	items, err := h.comments.List(ctx, postID, limit, offset, viewerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := make([]dto.CommentResponse, 0, len(items))
	for _, c := range items {
		resp = append(resp, dto.CommentResponse{
			ID:               c.ID,
			PostID:           c.PostID,
			UserID:           c.UserID,
			Username:         c.Username,
			Body:             c.Body,
			CreatedAt:        c.CreatedAt,
			LikedByMe:        c.LikedByMe,
			LikeCount:        c.LikeCount,
			RepliesCount:     c.RepliesCount,
			ReplyToCommentID: c.ReplyToCommentID,
		})
	}
	setNextOffset(w, offset, limit, len(resp))
	writeJSON(w, http.StatusOK, resp)
}

func (h *CommentHandler) handleDynamic(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/comments/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return
	}
	commentID := parts[0]

	if len(parts) == 1 && r.Method == http.MethodDelete {
		userID, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		if err := h.comments.Delete(r.Context(), commentID, userID); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}

	if len(parts) == 2 && parts[1] == "like" {
		userID, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		switch r.Method {
		case http.MethodPost:
			if err := h.comments.Like(r.Context(), commentID, userID); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "liked"})
		case http.MethodDelete:
			if err := h.comments.Unlike(r.Context(), commentID, userID); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "unliked"})
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	if len(parts) == 2 && parts[1] == "replies" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		ctx := r.Context()
		viewerID, _ := tryGetUserID(r, h.jwt)
		limit := parseIntQuery(r, "limit", 20)
		offset := parseIntQuery(r, "offset", 0)
		items, err := h.comments.ListReplies(ctx, commentID, limit, offset, viewerID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		resp := make([]dto.CommentResponse, 0, len(items))
		for _, c := range items {
			resp = append(resp, dto.CommentResponse{
				ID:               c.ID,
				PostID:           c.PostID,
				UserID:           c.UserID,
				Username:         c.Username,
				Body:             c.Body,
				CreatedAt:        c.CreatedAt,
				LikedByMe:        c.LikedByMe,
				LikeCount:        c.LikeCount,
				RepliesCount:     c.RepliesCount,
				ReplyToCommentID: c.ReplyToCommentID,
			})
		}
		setNextOffset(w, offset, limit, len(resp))
		writeJSON(w, http.StatusOK, resp)
		return
	}
}
