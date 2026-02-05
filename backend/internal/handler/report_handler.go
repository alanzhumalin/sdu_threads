package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"gorm.io/gorm"
	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/service"
)

type ReportHandler struct {
	svc *service.ReportService
	jwt *auth.JWTManager
}

func NewReportHandler(svc *service.ReportService, jwt *auth.JWTManager) *ReportHandler {
	return &ReportHandler{svc: svc, jwt: jwt}
}

func (h *ReportHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/reports", h.handleReports)
}

func (h *ReportHandler) handleReports(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	var req dto.CreateReportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	id, err := h.svc.Create(r.Context(), userID, req.TargetType, req.TargetID, req.Reason, req.Details)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			writeError(w, http.StatusNotFound, "target not found")
		default:
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusCreated, dto.CreateReportResponse{Status: "created", ID: id})
}
