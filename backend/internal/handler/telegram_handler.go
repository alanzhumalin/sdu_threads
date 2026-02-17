package handler

import (
	"errors"
	"net/http"

	"sduthreads/internal/auth"
	"sduthreads/internal/service"
)

type TelegramHandler struct {
	service *service.TelegramService
	jwt     *auth.JWTManager
}

func NewTelegramHandler(s *service.TelegramService, jwt *auth.JWTManager) *TelegramHandler {
	return &TelegramHandler{
		service: s,
		jwt:     jwt,
	}
}

func (h *TelegramHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/telegram/status", h.handleStatus)
	mux.HandleFunc("/api/telegram/connect", h.handleConnect)
}

func (h *TelegramHandler) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	status, err := h.service.GetStatus(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (h *TelegramHandler) handleConnect(w http.ResponseWriter, r *http.Request) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	switch r.Method {
	case http.MethodPost:
		session, err := h.service.CreateConnectSession(r.Context(), userID)
		if err != nil {
			if errors.Is(err, service.ErrTelegramDisabled) {
				writeError(w, http.StatusServiceUnavailable, "telegram notifications are disabled")
				return
			}
			writeError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, session)
	case http.MethodDelete:
		if err := h.service.Disconnect(r.Context(), userID); err != nil {
			writeError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
