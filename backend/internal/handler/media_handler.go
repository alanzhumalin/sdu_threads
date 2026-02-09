package handler

import (
	"bytes"
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

	"github.com/chai2010/webp"
	"github.com/disintegration/imaging"
	"github.com/minio/minio-go/v7"
	_ "golang.org/x/image/webp"

	"sduthreads/internal/auth"
	"sduthreads/internal/storage"
)

type MediaHandler struct {
	uploader *storage.S3Uploader
	jwt      *auth.JWTManager
}

func NewMediaHandler(uploader *storage.S3Uploader, jwt *auth.JWTManager) *MediaHandler {
	return &MediaHandler{uploader: uploader, jwt: jwt}
}

func (h *MediaHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/media/upload", h.handleUpload)
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
		maxOutBytes = 900 * 1024
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

			// If client already sent WEBP: don't decode/re-encode (big win)
			if strings.EqualFold(ct, "image/webp") {
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
