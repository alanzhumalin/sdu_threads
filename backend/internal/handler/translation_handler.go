package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"sduthreads/internal/service"
)

type TranslationHandler struct {
	service *service.TranslationService
}

func NewTranslationHandler(s *service.TranslationService) *TranslationHandler {
	return &TranslationHandler{service: s}
}

func (h *TranslationHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/translate", h.handleTranslate)
}

type translateRequest struct {
	Text       string `json:"text"`
	TargetLang string `json:"target_lang"`
	SourceLang string `json:"source_lang,omitempty"`
}

func (h *TranslationHandler) handleTranslate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if h.service == nil {
		writeError(w, http.StatusServiceUnavailable, "translation service unavailable")
		return
	}
	var req translateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	result, err := h.service.Translate(r.Context(), req.Text, req.TargetLang, req.SourceLang)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrTranslationDisabled):
			writeError(w, http.StatusServiceUnavailable, "translation service is disabled")
		case errors.Is(err, service.ErrTranslationRateLimited):
			writeError(w, http.StatusServiceUnavailable, "translation provider rate limited, try later")
		case errors.Is(err, service.ErrTranslationUnauthorized):
			writeError(w, http.StatusServiceUnavailable, "translation provider auth failed")
		case errors.Is(err, service.ErrTranslationUnavailable):
			writeError(w, http.StatusServiceUnavailable, "translation provider unavailable")
		case errors.Is(err, service.ErrTranslationTextRequired),
			errors.Is(err, service.ErrTranslationTextTooLong),
			errors.Is(err, service.ErrTranslationTargetInvalid),
			errors.Is(err, service.ErrTranslationRejected):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusBadGateway, "translation failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"translated_text": result.TranslatedText,
		"source_lang":     result.SourceLang,
		"target_lang":     result.TargetLang,
		"model":           result.Model,
	})
}
