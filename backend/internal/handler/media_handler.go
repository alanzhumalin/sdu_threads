package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/minio/minio-go/v7"
	_ "golang.org/x/image/webp"
	"golang.org/x/time/rate"

	"sduthreads/internal/auth"
	"sduthreads/internal/moderation"
	"sduthreads/internal/storage"
)

var errFileTooLarge = errors.New("file_too_large")

const maxMediaBytes = 5 * 1024 * 1024

func normalizeImageContentType(raw string) (string, bool) {
	ct := strings.ToLower(strings.TrimSpace(raw))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	if !strings.HasPrefix(ct, "image/") || ct == "image/svg+xml" {
		return "", false
	}
	return ct, true
}

func imageExtFromContentType(ct string) string {
	switch ct {
	case "image/jpeg", "image/jpg", "image/pjpeg":
		return "jpg"
	case "image/png", "image/apng":
		return "png"
	case "image/webp":
		return "webp"
	case "image/gif":
		return "gif"
	case "image/bmp", "image/x-ms-bmp":
		return "bmp"
	case "image/tiff", "image/x-tiff":
		return "tiff"
	case "image/avif":
		return "avif"
	case "image/heic":
		return "heic"
	case "image/heif":
		return "heif"
	}

	subtype := strings.TrimPrefix(ct, "image/")
	subtype = strings.TrimSpace(subtype)
	subtype = strings.TrimPrefix(subtype, "x-")
	if i := strings.Index(subtype, "+"); i >= 0 {
		subtype = subtype[:i]
	}
	subtype = strings.ReplaceAll(subtype, ".", "")
	if subtype == "" {
		return "img"
	}
	return subtype
}

type MediaHandler struct {
	uploader *storage.S3Uploader
	jwt      *auth.JWTManager
	presign  *userPresignLimiter
	mod      *moderation.Client
}

func NewMediaHandler(uploader *storage.S3Uploader, jwt *auth.JWTManager, mod *moderation.Client) *MediaHandler {
	// Limit presign spam per user: 30 files per minute, burst 30.
	// Each presign request "costs" len(files) tokens.
	return &MediaHandler{
		uploader: uploader,
		jwt:      jwt,
		presign:  newUserPresignLimiter(30, 30),
		mod:      mod,
	}
}

func (h *MediaHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/media/upload", h.handleUpload)
	mux.HandleFunc("/api/media/presign", h.handlePresign)
	mux.HandleFunc("/api/media/delete", h.handleDelete)
}

type userPresignLimiter struct {
	mu    sync.Mutex
	byUID map[string]*rate.Limiter
	rl    rate.Limit
	burst int
}

func newUserPresignLimiter(filesPerMinute int, burst int) *userPresignLimiter {
	if filesPerMinute <= 0 {
		filesPerMinute = 30
	}
	if burst <= 0 {
		burst = filesPerMinute
	}
	// 30 files / minute => 1 token per 2 seconds.
	rl := rate.Every(time.Minute / time.Duration(filesPerMinute))
	return &userPresignLimiter{byUID: map[string]*rate.Limiter{}, rl: rl, burst: burst}
}

func (l *userPresignLimiter) allow(uid string, n int) (ok bool, retryAfter time.Duration) {
	if l == nil || uid == "" || n <= 0 {
		return true, 0
	}
	now := time.Now()
	l.mu.Lock()
	lim := l.byUID[uid]
	if lim == nil {
		lim = rate.NewLimiter(l.rl, l.burst)
		l.byUID[uid] = lim
	}
	l.mu.Unlock()

	if lim.AllowN(now, n) {
		return true, 0
	}
	// Don't consume tokens for rejected requests; just compute delay.
	res := lim.ReserveN(now, n)
	if !res.OK() {
		return false, 30 * time.Second
	}
	d := res.Delay()
	res.CancelAt(now)
	if d < 0 {
		d = 0
	}
	return false, d
}

func (h *MediaHandler) handlePresign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	if h.uploader == nil {
		writeErrorPayload(w, http.StatusNotImplemented, errorPayload{
			Code:    "MEDIA_STORAGE_DISABLED",
			Message: "Хранилище медиа не настроено",
		})
		return
	}

	purpose := strings.TrimSpace(r.URL.Query().Get("purpose"))
	if purpose == "" {
		purpose = "misc"
	}
	switch purpose {
	case "post", "avatar", "background":
	default:
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "INVALID_PURPOSE",
			Message: "Некорректный purpose",
		})
		return
	}

	type inFile struct {
		ContentType string `json:"content_type"`
		SizeBytes   int64  `json:"size_bytes"`
	}
	var req struct {
		Files []inFile `json:"files"`
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}

	if len(req.Files) == 0 {
		writeError(w, http.StatusBadRequest, "files is required")
		return
	}
	if len(req.Files) > 5 {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "TOO_MANY_FILES",
			Message: "Можно загрузить максимум 5 файлов",
		})
		return
	}
	if ok, retry := h.presign.allow(userID, len(req.Files)); !ok {
		secs := int(math.Ceil(retry.Seconds()))
		if secs < 1 {
			secs = 1
		}
		writeErrorPayload(w, http.StatusTooManyRequests, errorPayload{
			Code:              "RATE_LIMIT",
			Message:           "Слишком часто. Попробуйте позже.",
			RetryAfterSeconds: secs,
		})
		return
	}

	items := make([]*storage.PresignedPut, 0, len(req.Files))
	for _, f := range req.Files {
		ct, ok := normalizeImageContentType(f.ContentType)
		if !ok {
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "INVALID_MEDIA_TYPE",
				Message: "Можно загрузить только изображения (без SVG)",
			})
			return
		}
		if f.SizeBytes <= 0 || f.SizeBytes > maxMediaBytes {
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "FILE_TOO_LARGE",
				Message: "Размер файла не должен превышать 5MB",
			})
			return
		}

		ext := imageExtFromContentType(ct)
		key := h.uploader.BuildKey(purpose, userID, ext)
		// Short TTL reduces the window in which a leaked presigned URL can be abused.
		pp, err := h.uploader.PresignPut(r.Context(), key, ct, 2*time.Minute)
		if err != nil {
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "S3_PRESIGN_FAILED",
				Message: "Не удалось подготовить загрузку (presign)",
			})
			return
		}
		items = append(items, pp)
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *MediaHandler) handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	if h.uploader == nil {
		writeErrorPayload(w, http.StatusNotImplemented, errorPayload{
			Code:    "MEDIA_STORAGE_DISABLED",
			Message: "Хранилище медиа не настроено",
		})
		return
	}

	purpose := strings.TrimSpace(r.URL.Query().Get("purpose"))
	if purpose == "" {
		purpose = "misc"
	}
	switch purpose {
	case "post", "avatar", "background":
	default:
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "INVALID_PURPOSE",
			Message: "Некорректный purpose",
		})
		return
	}

	var req struct {
		Keys []string `json:"keys"`
	}
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.Keys) == 0 {
		writeError(w, http.StatusBadRequest, "keys is required")
		return
	}
	if len(req.Keys) > 5 {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "TOO_MANY_FILES",
			Message: "Можно удалить максимум 5 файлов за раз",
		})
		return
	}

	prefix := h.uploader.KeyPrefix(purpose, userID) + "/"
	deleted := 0
	for _, raw := range req.Keys {
		key := strings.TrimLeft(strings.TrimSpace(raw), "/")
		if key == "" {
			continue
		}
		if !strings.HasPrefix(key, prefix) {
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "INVALID_KEY",
				Message: "Некорректный key",
			})
			return
		}

		// Best-effort cleanup; ignore not-found / storage errors.
		_ = h.uploader.Remove(r.Context(), key)
		deleted++
	}

	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted})
}

func (h *MediaHandler) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	if h.uploader == nil {
		writeErrorPayload(w, http.StatusNotImplemented, errorPayload{
			Code:    "MEDIA_STORAGE_DISABLED",
			Message: "Хранилище медиа не настроено",
		})
		return
	}

	purpose := strings.TrimSpace(r.URL.Query().Get("purpose"))
	if purpose == "" {
		purpose = "misc"
	}

	// 30MB request cap to allow up to 5 files x 5MB plus multipart overhead.
	const maxBodyBytes = 30 << 20
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

	files := form.File["files"]
	if len(files) == 0 {
		files = form.File["file"]
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "file is required")
		return
	}
	if len(files) > 5 {
		writeErrorPayload(w, http.StatusBadRequest, errorPayload{
			Code:    "TOO_MANY_FILES",
			Message: "Можно загрузить максимум 5 файлов",
		})
		return
	}

	type outItem struct {
		URL    string `json:"url"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
		SizeKB int    `json:"size_kb,omitempty"`
	}
	out := make([]outItem, len(files))
	errs := make(chan error, len(files))

	for i := range files {
		i := i
		go func() {
			fh := files[i]
			if fh == nil {
				errs <- errors.New("file is required")
				return
			}

			// Read file ONCE (faster than opening twice)
			f, err := fh.Open()
			if err != nil {
				errs <- err
				return
			}
			data, err := io.ReadAll(f)
			_ = f.Close()
			if err != nil {
				errs <- err
				return
			}

			// Sniff content type from first bytes (do not trust headers fully)
			head := data
			if len(head) > 512 {
				head = head[:512]
			}

			ct := strings.TrimSpace(fh.Header.Get("Content-Type"))
			sniffed := ""
			if len(head) > 0 {
				sniffed = http.DetectContentType(head)
			}
			if ct == "" || strings.EqualFold(ct, "application/octet-stream") {
				if sniffed != "" {
					ct = sniffed
				} else {
					ct = "application/octet-stream"
				}
			}

			ct, ok := normalizeImageContentType(ct)
			if !ok {
				errs <- errors.New("only raster images are allowed")
				return
			}
			if len(data) == 0 || len(data) > maxMediaBytes {
				errs <- errFileTooLarge
				return
			}
			if err := h.mod.CheckImageBytes(r.Context(), data, fh.Filename, ct, purpose+"_upload", &moderation.AuditMeta{
				ActorUserID: userID,
				Action:      "upload_media",
				TargetType:  purpose,
				Payload: map[string]any{
					"purpose":      purpose,
					"filename":     fh.Filename,
					"content_type": ct,
					"size_bytes":   len(data),
				},
			}); err != nil {
				errs <- err
				return
			}

			// Get dimensions cheaply (works for jpeg/png/gif/webp)
			cfg, _, cfgErr := image.DecodeConfig(bytes.NewReader(data))
			width, height := 0, 0
			if cfgErr == nil {
				width, height = cfg.Width, cfg.Height
			}

			key := h.uploader.BuildKey(purpose, userID, imageExtFromContentType(ct))
			url, err := h.uploader.Put(r.Context(), key, bytes.NewReader(data), int64(len(data)), ct)
			if err != nil {
				h.logS3Err(purpose, userID, fh.Filename, fh.Size, ct, err)
				errs <- err
				return
			}

			out[i] = outItem{
				URL:    url,
				Width:  width,
				Height: height,
				SizeKB: len(data) / 1024,
			}
			errs <- nil
		}()
	}

	for range files {
		if e := <-errs; e != nil {
			var viol *moderation.ViolationError
			if errors.As(e, &viol) {
				writeErrorPayload(w, http.StatusBadRequest, moderationViolationPayload(viol))
				return
			}
			if moderation.IsUnavailable(e) {
				writeErrorPayload(w, http.StatusServiceUnavailable, errorPayload{
					Code:    "MODERATION_UNAVAILABLE",
					Message: "Сервис модерации временно недоступен",
				})
				return
			}
			if errors.Is(e, errFileTooLarge) {
				writeErrorPayload(w, http.StatusBadRequest, errorPayload{
					Code:    "FILE_TOO_LARGE",
					Message: "Файл не должен превышать 5MB",
				})
				return
			}
			var resp minio.ErrorResponse
			if errors.As(e, &resp) && strings.TrimSpace(resp.Code) != "" {
				switch resp.Code {
				case "AccessDenied":
					writeErrorPayload(w, http.StatusBadRequest, errorPayload{
						Code:    "S3_ACCESS_DENIED",
						Message: "Нет доступа к хранилищу медиа (AccessDenied)",
					})
					return
				case "NoSuchBucket":
					writeErrorPayload(w, http.StatusBadRequest, errorPayload{
						Code:    "S3_BUCKET_NOT_FOUND",
						Message: "Bucket/контейнер не найден (NoSuchBucket)",
					})
					return
				case "InvalidAccessKeyId", "SignatureDoesNotMatch", "AuthorizationHeaderMalformed":
					writeErrorPayload(w, http.StatusBadRequest, errorPayload{
						Code:    "S3_AUTH_FAILED",
						Message: "Не удалось авторизоваться в хранилище медиа (проверьте ключи/endpoint/region)",
					})
					return
				}
			}

			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "UPLOAD_FAILED",
				Message: "Не удалось загрузить файл",
			})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (h *MediaHandler) logS3Err(purpose, userID, filename string, origSize int64, ct string, err error) {
	var resp minio.ErrorResponse
	if errors.As(err, &resp) && strings.TrimSpace(resp.Code) != "" {
		log.Printf(
			"media upload failed: purpose=%s user_id=%s filename=%q orig_size=%d orig_ct=%q s3_code=%q s3_msg=%q",
			purpose, userID, filename, origSize, ct, resp.Code, resp.Message,
		)
		return
	}
	log.Printf(
		"media upload failed: purpose=%s user_id=%s filename=%q orig_size=%d orig_ct=%q err=%v",
		purpose, userID, filename, origSize, ct, err,
	)
}
