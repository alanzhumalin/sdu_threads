package handler

import (
	"net/http"
	"strings"

	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/service"
)

type HashtagHandler struct {
	tags *service.HashtagService
	jwt  *auth.JWTManager
}

func NewHashtagHandler(tags *service.HashtagService, jwt *auth.JWTManager) *HashtagHandler {
	return &HashtagHandler{tags: tags, jwt: jwt}
}

func (h *HashtagHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/hashtags/search", h.search)
	mux.HandleFunc("/api/hashtags/", h.postsByTag)
}

func (h *HashtagHandler) search(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query().Get("q")
	limit := parseIntQuery(r, "limit", 20)
	tags, err := h.tags.Search(r.Context(), q, limit)
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
	resp := make([]dto.FeedResponseItem, 0, len(items))
	for _, it := range items {
		resp = append(resp, dto.FeedResponseItem{
			ID:        it.ID,
			UserID:    it.UserID,
			Username:  it.Username,
			FullName:  it.FullName,
			Content:   it.Content,
			MediaURL:  it.MediaURL,
			CreatedAt: it.CreatedAt,
			UpdatedAt: it.UpdatedAt,
			LikeCount: it.LikeCount,
			LikedByMe: it.LikedByMe,
		})
	}
	setNextOffset(w, offset, limit, len(resp))
	writeJSON(w, http.StatusOK, resp)
}
