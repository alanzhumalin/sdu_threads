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
	"mime"
	"net/http"
	"strings"

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

	// 20MB should match nginx client_max_body_size by default.
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
	}
	out := make([]outItem, len(files))
	errs := make(chan error, len(files))

	// Upload in parallel; max 5 items.
	for i := range files {
		i := i
		go func() {
			fh := files[i]
			if fh == nil {
				errs <- errors.New("file is required")
				return
			}
			f, err := fh.Open()
			if err != nil {
				errs <- err
				return
			}
			defer f.Close()

			ct := strings.TrimSpace(fh.Header.Get("Content-Type"))
			// Don't rely only on part headers: some browsers/Blob uploads omit it.
			// Sniff a small prefix and pick a better content-type when needed.
			head := make([]byte, 512)
			n, _ := io.ReadFull(f, head)
			head = head[:n]
			sniffed := ""
			if n > 0 {
				sniffed = http.DetectContentType(head)
			}
			cfgReader := io.MultiReader(bytes.NewReader(head), f)
			if ct == "" || strings.EqualFold(ct, "application/octet-stream") {
				if sniffed != "" {
					ct = sniffed
				} else {
					ct = "application/octet-stream"
				}
			}

			if !strings.HasPrefix(strings.ToLower(ct), "image/") || strings.EqualFold(ct, "image/svg+xml") {
				errs <- errors.New("only raster images are allowed")
				return
			}

			cfg, _, err := image.DecodeConfig(cfgReader)
			if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
				errs <- errors.New("unsupported image format")
				return
			}

			// Re-open to upload from the beginning (DecodeConfig consumed the reader).
			_ = f.Close()
			f2, err := fh.Open()
			if err != nil {
				errs <- err
				return
			}
			defer f2.Close()

			ext := ""
			if exts, _ := mime.ExtensionsByType(ct); len(exts) > 0 {
				ext = strings.TrimPrefix(exts[0], ".")
			}
			key := h.uploader.BuildKey(purpose, userID, ext)

			url, err := h.uploader.Put(r.Context(), key, f2, fh.Size, ct)
			if err != nil {
				// Keep the response generic, but make the root cause visible in logs.
				var resp minio.ErrorResponse
				if errors.As(err, &resp) && strings.TrimSpace(resp.Code) != "" {
					log.Printf(
						"media upload failed: purpose=%s user_id=%s filename=%q size=%d ct=%q s3_code=%q s3_msg=%q",
						purpose, userID, fh.Filename, fh.Size, ct, resp.Code, resp.Message,
					)
				} else {
					log.Printf(
						"media upload failed: purpose=%s user_id=%s filename=%q size=%d ct=%q err=%v",
						purpose, userID, fh.Filename, fh.Size, ct, err,
					)
				}
				errs <- err
				return
			}
			out[i] = outItem{URL: url, Width: cfg.Width, Height: cfg.Height}
			errs <- nil
		}()
	}

	for range files {
		if e := <-errs; e != nil {
			// Best-effort: the request failed; keep error generic, but return a useful code.
			// (The full error is logged above.)
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
