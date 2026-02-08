package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/service"

	"gorm.io/gorm"
)

type UserHandler struct {
	service *service.UserService
}

func NewUserHandler(s *service.UserService) *UserHandler {
	return &UserHandler{service: s}
}

func (h *UserHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/users", h.createUser) // POST
	mux.HandleFunc("/api/users/", h.getUser)   // GET /api/users/{uuid|username}
}

func (h *UserHandler) getUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	param := strings.TrimPrefix(r.URL.Path, "/api/users/")
	param = strings.TrimSpace(param)
	if param == "" || strings.Contains(param, "/") {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	// 💡 Пытаемся сначала как username (потому что /api/users/alex — это явно username),
	// но если у тебя есть кейс когда username может выглядеть как UUID — можно поменять порядок.
	user, err := h.service.GetByUsername(r.Context(), param)
	if err != nil {
		// если не нашли по username — пробуем как ID
		user, err = h.service.GetByID(r.Context(), param)
	}

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	resp := dto.UserResponse{
		ID:            user.ID,
		Username:      user.Username,
		FullName:      user.FullName,
		Bio:           user.Bio,
		AvatarURL:     user.AvatarURL,
		BackgroundURL: user.BackgroundURL,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) createUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req dto.CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	user, err := h.service.Create(r.Context(), models.User{
		Email:         req.Email,
		Username:      req.Username,
		FullName:      req.FullName,
		Bio:           req.Bio,
		AvatarURL:     req.AvatarURL,
		BackgroundURL: req.BackgroundURL,
	})
	if err != nil {
		switch {
		case errors.Is(err, service.ErrEmailTaken) || errors.Is(err, service.ErrUsernameTaken):
			writeError(w, http.StatusConflict, err.Error())
		default:
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}

	resp := dto.UserResponse{
		ID:            user.ID,
		Username:      user.Username,
		FullName:      user.FullName,
		Bio:           user.Bio,
		AvatarURL:     user.AvatarURL,
		BackgroundURL: user.BackgroundURL,
	}
	writeJSON(w, http.StatusCreated, resp)
}
