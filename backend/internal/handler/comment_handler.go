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
	"sduthreads/internal/models"
	"sduthreads/internal/moderation"
	"sduthreads/internal/service"
)

type CommentHandler struct {
	comments *service.CommentService
	telegram *service.TelegramService
	jwt      *auth.JWTManager
	cache    *cache.QueryCache
}

func NewCommentHandler(c *service.CommentService, tg *service.TelegramService, jwt *auth.JWTManager, qc *cache.QueryCache) *CommentHandler {
	return &CommentHandler{comments: c, telegram: tg, jwt: jwt, cache: qc}
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
	createdComment, err := h.comments.Create(r.Context(), req.PostID, userID, req.Content, req.ReplyTo, req.Hashtags)
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
	if createdComment != nil {
		go h.notifyTelegramCommentCreate(userID, createdComment)
	}
	invalidateCachePrefixes(r.Context(), h.cache, cachePrefixHashtagsSearch, cachePrefixHashtagsPopular, cachePrefixFeedPublic)
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
	// Attach a single reply preview with mentions preserved
	for i := range items {
		replies, _ := h.comments.ListReplies(ctx, items[i].ID, 1, 0, viewerID)
		items[i].Replies = replies
	}
	setNextOffset(w, offset, limit, len(items))
	writeJSON(w, http.StatusOK, items)
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

	if len(parts) == 1 && r.Method == http.MethodPatch {
		userID, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		var req dto.UpdateCommentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if err := h.comments.Update(r.Context(), commentID, userID, req.Content, req.Hashtags); err != nil {
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
		writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
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
			inserted, err := h.comments.Like(r.Context(), commentID, userID)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if inserted {
				go h.notifyTelegramCommentLike(userID, commentID)
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
		setNextOffset(w, offset, limit, len(items))
		writeJSON(w, http.StatusOK, items)
		return
	}
}

func (h *CommentHandler) notifyTelegramCommentCreate(actorID string, comment *models.Comment) {
	if h.telegram == nil || !h.telegram.Enabled() || comment == nil {
		return
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return
	}
	postID := strings.TrimSpace(comment.PostID)
	if postID == "" {
		return
	}
	ctx := context.Background()
	postMeta, err := h.comments.PostMetaByID(ctx, postID)
	if err != nil || postMeta == nil {
		return
	}
	actorFullName, actorUsername := h.comments.UserIdentity(ctx, actorID)
	commentPreview := strings.TrimSpace(comment.Body)

	// comment notification (for post owner)
	postOwnerID := strings.TrimSpace(postMeta.UserID)
	if postOwnerID != "" && postOwnerID != actorID {
		if err := h.telegram.NotifySiteNotification(ctx, service.TelegramSiteNotification{
			RecipientUserID: postOwnerID,
			Type:            "comment",
			PostID:          postID,
			ActorFullName:   actorFullName,
			ActorUsername:   actorUsername,
			PostPreview:     postMeta.Content,
			CommentPreview:  commentPreview,
		}); err != nil {
			log.Printf("comment telegram notify failed: actor_id=%s recipient_id=%s post_id=%s err=%v", actorID, postOwnerID, postID, err)
		}
	}

	// reply notification (for parent comment owner)
	parentOwnerID := ""
	if comment.ReplyToCommentID != nil && strings.TrimSpace(*comment.ReplyToCommentID) != "" {
		parentMeta, err := h.comments.MetaByID(ctx, strings.TrimSpace(*comment.ReplyToCommentID))
		if err == nil && parentMeta != nil {
			parentOwnerID = strings.TrimSpace(parentMeta.AuthorID)
			if parentOwnerID != "" && parentOwnerID != actorID {
				if err := h.telegram.NotifySiteNotification(ctx, service.TelegramSiteNotification{
					RecipientUserID: parentOwnerID,
					Type:            "reply_comment",
					PostID:          postID,
					ActorFullName:   actorFullName,
					ActorUsername:   actorUsername,
					PostPreview:     postMeta.Content,
					CommentPreview:  commentPreview,
				}); err != nil {
					log.Printf("reply telegram notify failed: actor_id=%s recipient_id=%s post_id=%s err=%v", actorID, parentOwnerID, postID, err)
				}
			}
		}
	}

	// mention notification (exclude actor and direct-reply owner to mirror notification feed logic)
	recipients, err := h.comments.ResolveMentionRecipients(ctx, comment.Body, actorID)
	if err != nil {
		log.Printf("mention comment telegram resolve failed: actor_id=%s post_id=%s err=%v", actorID, postID, err)
		return
	}
	for _, recipient := range recipients {
		recipientID := strings.TrimSpace(recipient.UserID)
		if recipientID == "" {
			continue
		}
		if parentOwnerID != "" && recipientID == parentOwnerID {
			continue
		}
		if err := h.telegram.NotifySiteNotification(ctx, service.TelegramSiteNotification{
			RecipientUserID: recipientID,
			Type:            "mention_comment",
			PostID:          postID,
			ActorFullName:   actorFullName,
			ActorUsername:   actorUsername,
			PostPreview:     postMeta.Content,
			CommentPreview:  commentPreview,
		}); err != nil {
			log.Printf("mention comment telegram notify failed: actor_id=%s recipient_id=%s post_id=%s err=%v", actorID, recipientID, postID, err)
		}
	}
}

func (h *CommentHandler) notifyTelegramCommentLike(actorID, commentID string) {
	if h.telegram == nil || !h.telegram.Enabled() {
		return
	}
	actorID = strings.TrimSpace(actorID)
	commentID = strings.TrimSpace(commentID)
	if actorID == "" || commentID == "" {
		return
	}
	ctx := context.Background()
	meta, err := h.comments.MetaByID(ctx, commentID)
	if err != nil || meta == nil {
		return
	}
	recipientID := strings.TrimSpace(meta.AuthorID)
	if recipientID == "" || recipientID == actorID {
		return
	}
	actorFullName, actorUsername := h.comments.UserIdentity(ctx, actorID)
	if err := h.telegram.NotifySiteNotification(ctx, service.TelegramSiteNotification{
		RecipientUserID: recipientID,
		Type:            "like_comment",
		PostID:          meta.PostID,
		ActorFullName:   actorFullName,
		ActorUsername:   actorUsername,
		CommentPreview:  meta.Body,
	}); err != nil {
		log.Printf("comment like telegram notify failed: actor_id=%s recipient_id=%s comment_id=%s err=%v", actorID, recipientID, commentID, err)
	}
}
