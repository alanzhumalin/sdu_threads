package handler

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"io"
	"net/http"
	"strings"
	"time"

	"sduthreads/internal/dto"
	"sduthreads/internal/moderation"
	"sduthreads/internal/service"
	"sduthreads/internal/storage"
)

const (
	giftMaxImageBytes = 10 * 1024 * 1024
	giftMaxVideoBytes = 40 * 1024 * 1024
)

type GiftHandler struct {
	service  *service.GiftService
	uploader *storage.S3Uploader
	mod      *moderation.Client
}

func NewGiftHandler(s *service.GiftService, uploader *storage.S3Uploader, mod *moderation.Client) *GiftHandler {
	return &GiftHandler{service: s, uploader: uploader, mod: mod}
}

func (h *GiftHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/gifts", h.handleGifts)
	mux.HandleFunc("/api/gifts/", h.handleGiftByCode)
	mux.HandleFunc("/api/gifts/upload", h.handleUpload)
}

func (h *GiftHandler) handleGifts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req dto.CreateGiftRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		created, err := h.service.Create(r.Context(), req)
		if err != nil {
			h.writeGiftError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, created)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *GiftHandler) handleGiftByCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	code := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/gifts/"))
	if code == "" || strings.Contains(code, "/") {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	item, err := h.service.GetByCode(r.Context(), code)
	if err != nil {
		h.writeGiftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func mediaTypeFromUploadContentType(raw string) string {
	ct := strings.ToLower(strings.TrimSpace(raw))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	switch {
	case strings.HasPrefix(ct, "image/") && ct != "image/svg+xml":
		return "image"
	case strings.HasPrefix(ct, "video/"):
		return "video"
	default:
		return ""
	}
}

func mediaExtFromUploadContentType(raw string) string {
	ct := strings.ToLower(strings.TrimSpace(raw))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	switch ct {
	case "image/jpeg":
		return "jpg"
	case "image/png":
		return "png"
	case "image/webp":
		return "webp"
	case "image/gif":
		return "gif"
	case "image/bmp":
		return "bmp"
	case "image/avif":
		return "avif"
	case "image/heic":
		return "heic"
	case "image/heif":
		return "heif"
	case "video/mp4":
		return "mp4"
	case "video/webm":
		return "webm"
	case "video/quicktime":
		return "mov"
	case "video/x-msvideo":
		return "avi"
	case "video/x-matroska":
		return "mkv"
	case "video/ogg":
		return "ogv"
	case "video/3gpp":
		return "3gp"
	default:
		return "bin"
	}
}

func randomGuestMediaOwner() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return "guest-" + hex.EncodeToString(buf)
}

func (h *GiftHandler) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if h.uploader == nil {
		writeErrorPayload(w, http.StatusNotImplemented, errorPayload{
			Code:    "MEDIA_STORAGE_DISABLED",
			Message: "Хранилище медиа не настроено",
		})
		return
	}

	maxBodyBytes := int64(giftMaxVideoBytes + 5<<20)
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := r.ParseMultipartForm(maxBodyBytes); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	form := r.MultipartForm
	if form == nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form")
		return
	}
	files := form.File["file"]
	if len(files) == 0 {
		files = form.File["files"]
	}
	if len(files) == 0 || files[0] == nil {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}

	fh := files[0]
	f, err := fh.Open()
	if err != nil {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "UPLOAD_FAILED",
			Message: "Не удалось загрузить файл",
		})
		return
	}
	data, err := io.ReadAll(f)
	_ = f.Close()
	if err != nil || len(data) == 0 {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "UPLOAD_FAILED",
			Message: "Не удалось загрузить файл",
		})
		return
	}

	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	ct := strings.TrimSpace(fh.Header.Get("Content-Type"))
	sniffed := http.DetectContentType(head)
	if ct == "" || strings.EqualFold(ct, "application/octet-stream") {
		ct = sniffed
	}
	mediaType := mediaTypeFromUploadContentType(ct)
	if mediaType == "" {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "INVALID_MEDIA_TYPE",
			Message: "Поддерживаются только фото и видео",
		})
		return
	}
	if mediaType == "image" && len(data) > giftMaxImageBytes {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "FILE_TOO_LARGE",
			Message: "Изображение не должно превышать 10MB",
		})
		return
	}
	if mediaType == "video" && len(data) > giftMaxVideoBytes {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "FILE_TOO_LARGE",
			Message: "Видео не должно превышать 40MB",
		})
		return
	}
	width, height := 0, 0
	if mediaType == "image" {
		cfg, _, cfgErr := image.DecodeConfig(bytes.NewReader(data))
		if cfgErr == nil {
			width, height = cfg.Width, cfg.Height
		}
	}

	key := h.uploader.BuildKey("gift", randomGuestMediaOwner(), mediaExtFromUploadContentType(ct))
	url, putErr := h.uploader.Put(r.Context(), key, bytes.NewReader(data), int64(len(data)), ct)
	if putErr != nil {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "UPLOAD_FAILED",
			Message: "Не удалось загрузить файл",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": []map[string]any{
			{
				"url":     url,
				"type":    mediaType,
				"width":   width,
				"height":  height,
				"size_kb": len(data) / 1024,
			},
		},
	})
}

func (h *GiftHandler) writeGiftError(w http.ResponseWriter, err error) {
	var takenErr *service.GiftCodeTakenError
	switch {
	case errors.Is(err, service.ErrGiftNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.As(err, &takenErr):
		retry := 0
		if takenErr != nil {
			retry = takenErr.RetryAfterSeconds()
		}
		expiresMsg := ""
		if takenErr != nil && !takenErr.ExpiresAt.IsZero() {
			expiresMsg = " до " + takenErr.ExpiresAt.UTC().Format(time.RFC3339)
		}
		writeErrorPayload(w, http.StatusConflict, errorPayload{
			Code:              "GIFT_SLUG_TAKEN",
			Message:           "Эта ссылка уже занята" + expiresMsg,
			RetryAfterSeconds: retry,
		})
	case errors.Is(err, service.ErrGiftCodeInvalid):
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "GIFT_CODE_INVALID",
			Message: "Допустимы только строчные латинские буквы, цифры и дефис (4-40 символов)",
		})
	case errors.Is(err, service.ErrGiftCodeReserved):
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "GIFT_CODE_RESERVED",
			Message: "Эта ссылка зарезервирована",
		})
	case errors.Is(err, service.ErrGiftUILanguageInvalid):
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "GIFT_UI_LANGUAGE_INVALID",
			Message: "Недопустимый язык интерфейса открытки",
		})
	case errors.Is(err, service.ErrGiftToNameRequired),
		errors.Is(err, service.ErrGiftToNameTooLong),
		errors.Is(err, service.ErrGiftFromNameTooLong),
		errors.Is(err, service.ErrGiftMessageRequired),
		errors.Is(err, service.ErrGiftMessageTooLong),
		errors.Is(err, service.ErrGiftOpenLineTooLong),
		errors.Is(err, service.ErrGiftAnimationInvalid),
		errors.Is(err, service.ErrGiftMediaTypeInvalid),
		errors.Is(err, service.ErrGiftMediaURLInvalid),
		errors.Is(err, service.ErrGiftWishesTooMany),
		errors.Is(err, service.ErrGiftWishInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}
