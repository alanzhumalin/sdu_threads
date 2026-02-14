package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/service"
)

type UserHandler struct {
	service *service.UserService
}

func NewUserHandler(s *service.UserService) *UserHandler {
	return &UserHandler{service: s}
}

func (h *UserHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/users", h.createUser)
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
		IsVerified:    user.IsVerified,
		Bio:           user.Bio,
		AvatarURL:     user.AvatarURL,
		BackgroundURL: user.BackgroundURL,
	}
	writeJSON(w, http.StatusCreated, resp)
}
