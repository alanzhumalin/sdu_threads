package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/service"
)

type StoryHandler struct {
	service *service.StoryService
	jwt     *auth.JWTManager
}

func NewStoryHandler(s *service.StoryService, jwt *auth.JWTManager) *StoryHandler {
	return &StoryHandler{service: s, jwt: jwt}
}

func (h *StoryHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/stories", h.handleStories)
	mux.HandleFunc("/api/stories/", h.handleStoryActions)
}

func (h *StoryHandler) handleStories(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		viewerID, _ := tryGetUserID(r, h.jwt)
		items, err := h.service.ListActive(r.Context(), viewerID)
		if err != nil {
			h.writeStoryError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, items)
	case http.MethodPost:
		userID, err := requireUserID(r, h.jwt)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		var req dto.CreateStoryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		created, err := h.service.Create(r.Context(), userID, req)
		if err != nil {
			h.writeStoryError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, created)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *StoryHandler) handleStoryActions(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/stories/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if len(parts) > 1 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	viewerID, _ := tryGetUserID(r, h.jwt)
	group, err := h.service.ListActiveByUser(r.Context(), strings.TrimSpace(parts[0]), viewerID)
	if err != nil {
		h.writeStoryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, group)
}

func (h *StoryHandler) writeStoryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrStoryNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrStoryUserNotFound),
		errors.Is(err, service.ErrStoryMediaRequired),
		errors.Is(err, service.ErrStoryMediaURLInvalid),
		errors.Is(err, service.ErrStoryMediaTypeInvalid),
		errors.Is(err, service.ErrStoryMediaNotFound),
		errors.Is(err, service.ErrStoryMediaTooLarge),
		errors.Is(err, service.ErrStoryTextTooLong):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}
