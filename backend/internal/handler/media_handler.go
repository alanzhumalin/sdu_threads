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

	"github.com/chai2010/webp"
	"github.com/disintegration/imaging"
	"github.com/minio/minio-go/v7"
	_ "golang.org/x/image/webp"
	"golang.org/x/time/rate"

	"sduthreads/internal/auth"
	"sduthreads/internal/storage"
)

var errGifTooLarge = errors.New("gif_too_large")

type MediaHandler struct {
	uploader *storage.S3Uploader
	jwt      *auth.JWTManager
	presign  *userPresignLimiter
}

func NewMediaHandler(uploader *storage.S3Uploader, jwt *auth.JWTManager) *MediaHandler {
	// Limit presign spam per user: 30 files per minute, burst 30.
	// Each presign request "costs" len(files) tokens.
	return &MediaHandler{
		uploader: uploader,
		jwt:      jwt,
		presign:  newUserPresignLimiter(30, 30),
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

	const maxBytes = 1 * 1024 * 1024
	items := make([]*storage.PresignedPut, 0, len(req.Files))
	for _, f := range req.Files {
		ct := strings.ToLower(strings.TrimSpace(f.ContentType))
		if ct != "image/webp" && ct != "image/gif" {
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "INVALID_MEDIA_TYPE",
				Message: "Можно загрузить только webp или gif",
			})
			return
		}
		if f.SizeBytes <= 0 || f.SizeBytes > maxBytes {
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "FILE_TOO_LARGE",
				Message: "Размер файла не должен превышать 1MB",
			})
			return
		}

		ext := "webp"
		if ct == "image/gif" {
			ext = "gif"
		}
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
		if !strings.HasSuffix(key, ".webp") && !strings.HasSuffix(key, ".gif") {
			writeErrorPayload(w, http.StatusBadRequest, errorPayload{
				Code:    "INVALID_MEDIA_TYPE",
				Message: "Можно удалить только webp или gif",
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

	// 20MB cap
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	if err := r.ParseMultipartForm(20 << 20); err != nil {
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

	const (
		maxOutBytes = 1 * 1024 * 1024
	)

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

			// Only raster images (no SVG)
			if !strings.HasPrefix(strings.ToLower(ct), "image/") || strings.EqualFold(ct, "image/svg+xml") {
				errs <- errors.New("only raster images are allowed")
				return
			}

			// Get dimensions cheaply (works for jpeg/png/gif/webp)
			cfg, _, cfgErr := image.DecodeConfig(bytes.NewReader(data))
			width, height := 0, 0
			if cfgErr == nil {
				width, height = cfg.Width, cfg.Height
			}

			// GIF: keep as-is (animation), but enforce <= 1MB.
			if strings.EqualFold(ct, "image/gif") {
				if len(data) > maxOutBytes {
					errs <- errGifTooLarge
					return
				}
				key := h.uploader.BuildKey(purpose, userID, "gif")
				url, err := h.uploader.Put(r.Context(), key, bytes.NewReader(data), int64(len(data)), "image/gif")
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
				return
			}

			// If client already sent WEBP and it's within limit: don't decode/re-encode (big win)
			if strings.EqualFold(ct, "image/webp") && len(data) <= maxOutBytes {
				key := h.uploader.BuildKey(purpose, userID, "webp")
				url, err := h.uploader.Put(r.Context(), key, bytes.NewReader(data), int64(len(data)), "image/webp")
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
				return
			}

			// Decode full image (needed for conversion)
			img, _, err := image.Decode(bytes.NewReader(data))
			if err != nil {
				errs <- errors.New("unsupported image format")
				return
			}

			// Fast compress to WebP <= 900KB (few encodes)
			webpBytes, w2, h2, err := compressWebPFast(img, maxOutBytes)
			if err != nil {
				errs <- err
				return
			}

			key := h.uploader.BuildKey(purpose, userID, "webp")
			url, err := h.uploader.Put(r.Context(), key, bytes.NewReader(webpBytes), int64(len(webpBytes)), "image/webp")
			if err != nil {
				h.logS3Err(purpose, userID, fh.Filename, fh.Size, ct, err)
				errs <- err
				return
			}

			// If decodeconfig failed earlier, use resulting dims from processed img
			if w2 > 0 && h2 > 0 {
				width, height = w2, h2
			}

			out[i] = outItem{
				URL:    url,
				Width:  width,
				Height: height,
				SizeKB: len(webpBytes) / 1024,
			}
			errs <- nil
		}()
	}

	for range files {
		if e := <-errs; e != nil {
			if errors.Is(e, errGifTooLarge) {
				writeErrorPayload(w, http.StatusBadRequest, errorPayload{
					Code:    "FILE_TOO_LARGE",
					Message: "GIF не должен превышать 1MB",
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

// compressWebPFast tries to fit into maxBytes with few encodes (usually 1–3).
// Key speedups vs your old version:
//   - no binary search loop
//   - no many iterations
//   - imaging.Linear instead of Lanczos (much faster)
func compressWebPFast(img image.Image, maxBytes int) ([]byte, int, int, error) {
	if maxBytes <= 0 {
		return nil, 0, 0, errors.New("invalid maxBytes")
	}

	encode := func(im image.Image, q float32) ([]byte, error) {
		var buf bytes.Buffer
		if err := webp.Encode(&buf, im, &webp.Options{
			Lossless: false,
			Quality:  q,
		}); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}

	resizeByScale := func(src image.Image, scale float64) image.Image {
		if scale >= 0.999 {
			return src
		}
		w := int(math.Round(float64(src.Bounds().Dx()) * scale))
		h := int(math.Round(float64(src.Bounds().Dy()) * scale))
		if w < 1 {
			w = 1
		}
		if h < 1 {
			h = 1
		}
		// Lanczos is expensive; Linear is much faster and good enough for uploads.
		return imaging.Resize(src, w, h, imaging.Linear)
	}

	// 1) first try: good quality
	b, err := encode(img, 82)
	if err != nil {
		return nil, 0, 0, err
	}
	if len(b) <= maxBytes {
		return b, img.Bounds().Dx(), img.Bounds().Dy(), nil
	}

	// 2) downscale by sqrt ratio (size ~ area)
	scale1 := math.Sqrt(float64(maxBytes)/float64(len(b))) * 0.95
	if scale1 > 0.98 {
		scale1 = 0.98
	}
	if scale1 < 0.10 {
		scale1 = 0.10
	}
	img1 := resizeByScale(img, scale1)

	b1, err := encode(img1, 78)
	if err != nil {
		return nil, 0, 0, err
	}
	if len(b1) <= maxBytes {
		return b1, img1.Bounds().Dx(), img1.Bounds().Dy(), nil
	}

	// 3) last attempt: a bit more downscale + lower quality
	scale2 := math.Sqrt(float64(maxBytes)/float64(len(b1))) * 0.95
	if scale2 > 0.98 {
		scale2 = 0.98
	}
	if scale2 < 0.10 {
		scale2 = 0.10
	}
	img2 := resizeByScale(img1, scale2)

	b2, err := encode(img2, 70)
	if err != nil {
		return nil, 0, 0, err
	}
	return b2, img2.Bounds().Dx(), img2.Bounds().Dy(), nil
}
