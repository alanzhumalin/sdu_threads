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

	// NOTE: This keeps your existing 20MB request cap. If you truly want "any size",
	// remove MaxBytesReader and bump ParseMultipartForm as you see fit.
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

	for i := range files {
		i := i
		go func() {
			fh := files[i]
			if fh == nil {
				errs <- errors.New("file is required")
				return
			}

			// Sniff content type from first bytes (do not trust headers fully)
			f, err := fh.Open()
			if err != nil {
				errs <- err
				return
			}
			head := make([]byte, 512)
			n, _ := io.ReadFull(f, head)
			_ = f.Close()
			head = head[:n]

			ct := strings.TrimSpace(fh.Header.Get("Content-Type"))
			sniffed := ""
			if n > 0 {
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

			// Decode full image (supports jpeg/png/gif + webp decode because of x/image/webp import)
			f2, err := fh.Open()
			if err != nil {
				errs <- err
				return
			}
			img, _, err := image.Decode(f2)
			_ = f2.Close()
			if err != nil {
				errs <- errors.New("unsupported image format")
				return
			}

			// Compress to WebP in [100KB..1MB] (adaptive quality + downscale)
			webpBytes, w2, h2, err := compressWebPToSizeRange(img, 100*1024, 900*1024)
			if err != nil {
				errs <- err
				return
			}

			key := h.uploader.BuildKey(purpose, userID, "webp")
			url, err := h.uploader.Put(r.Context(), key, bytes.NewReader(webpBytes), int64(len(webpBytes)), "image/webp")
			if err != nil {
				// Keep the response generic, but make root cause visible in logs.
				var resp minio.ErrorResponse
				if errors.As(err, &resp) && strings.TrimSpace(resp.Code) != "" {
					log.Printf(
						"media upload failed: purpose=%s user_id=%s filename=%q orig_size=%d orig_ct=%q s3_code=%q s3_msg=%q",
						purpose, userID, fh.Filename, fh.Size, ct, resp.Code, resp.Message,
					)
				} else {
					log.Printf(
						"media upload failed: purpose=%s user_id=%s filename=%q orig_size=%d orig_ct=%q err=%v",
						purpose, userID, fh.Filename, fh.Size, ct, err,
					)
				}
				errs <- err
				return
			}

			out[i] = outItem{
				URL:    url,
				Width:  w2,
				Height: h2,
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

// compressWebPToSizeRange encodes to WebP trying to fit the output size into [minBytes..maxBytes].
// Strategy:
//  1. try to fit <= maxBytes by decreasing quality (binary search)
//  2. if even at low quality still too big => downscale (reduce pixel dimensions) and repeat
func compressWebPToSizeRange(img image.Image, minBytes, maxBytes int) ([]byte, int, int, error) {
	if minBytes <= 0 || maxBytes <= 0 || minBytes >= maxBytes {
		return nil, 0, 0, errors.New("invalid size range")
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

	scaleImage := func(src image.Image, scale float64) image.Image {
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
		return imaging.Resize(src, w, h, imaging.Lanczos)
	}

	qMin := float32(35)
	qMax := float32(90)

	scale := 1.0
	cur := img

	for iter := 0; iter < 12; iter++ {
		// Fit <= maxBytes by quality (binary search)
		lo, hi := qMin, qMax
		var best []byte

		for j := 0; j < 8; j++ {
			mid := (lo + hi) / 2
			b, err := encode(cur, mid)
			if err != nil {
				return nil, 0, 0, err
			}
			if len(b) <= maxBytes {
				best = b
				lo = mid // try higher quality
			} else {
				hi = mid // too big -> lower quality
			}
		}

		if best != nil {
			// If it's below minBytes, we can't safely "grow" it; just return higher quality.
			if len(best) < minBytes {
				b, err := encode(cur, qMax)
				if err != nil {
					return nil, 0, 0, err
				}
				return b, cur.Bounds().Dx(), cur.Bounds().Dy(), nil
			}
			return best, cur.Bounds().Dx(), cur.Bounds().Dy(), nil
		}

		// Even at qMin it's still too large -> downscale
		bMin, err := encode(cur, qMin)
		if err != nil {
			return nil, 0, 0, err
		}
		sz := len(bMin)
		// Downscale based on sqrt of ratio (size ~ area)
		ratio := math.Sqrt(float64(maxBytes)/float64(sz)) * 0.95
		newScale := scale * math.Min(0.90, ratio)

		if newScale < 0.10 {
			// Can't reasonably downscale further; return best-effort
			return bMin, cur.Bounds().Dx(), cur.Bounds().Dy(), nil
		}

		scale = newScale
		cur = scaleImage(img, scale)
	}

	// Fallback
	b, err := encode(cur, qMin)
	if err != nil {
		return nil, 0, 0, err
	}
	return b, cur.Bounds().Dx(), cur.Bounds().Dy(), nil
}
