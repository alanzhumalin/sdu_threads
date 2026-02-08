package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/service"
)

type AuthHandler struct {
	auth *service.AuthService
}

func NewAuthHandler(auth *service.AuthService) *AuthHandler {
	return &AuthHandler{auth: auth}
}

func (h *AuthHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/auth/register", h.register)
	mux.HandleFunc("/api/auth/login", h.login)
}

func (h *AuthHandler) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req dto.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	if !req.AcceptedRules {
		writeError(w, http.StatusBadRequest, "rules must be accepted")
		return
	}

	token, err := h.auth.Register(r.Context(), models.User{
		Email:    req.Email,
		Username: req.Username,
		FullName: req.FullName,
		AcceptedRulesAt: func() *time.Time {
			t := time.Now().UTC()
			return &t
		}(),
		Bio:           req.Bio,
		AvatarURL:     req.AvatarURL,
		BackgroundURL: req.BackgroundURL,
	}, req.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, dto.AuthResponse{Token: token})
}

func (h *AuthHandler) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req dto.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	identifier := strings.TrimSpace(req.Login)
	if identifier == "" {
		identifier = strings.TrimSpace(req.Username)
	}
	if identifier == "" {
		identifier = strings.TrimSpace(req.Email)
	}

	if identifier == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "login and password are required")
		return
	}

	token, err := h.auth.Login(r.Context(), identifier, req.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	writeJSON(w, http.StatusOK, dto.AuthResponse{Token: token})
}
