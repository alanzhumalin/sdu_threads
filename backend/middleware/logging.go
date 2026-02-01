package middleware

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

type statusWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.size += n
	return n, err
}

func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)

		duration := time.Since(start)
		ip := r.RemoteAddr
		userID := "-"
		if v := r.Context().Value("viewer_id"); v != nil {
			userID = formatAny(v)
		}
		log.Printf("http method=%s path=%s status=%d size=%d dur_ms=%d ip=%s ua=%q user_id=%s",
			r.Method, r.URL.Path, sw.status, sw.size, duration.Milliseconds(), ip, r.UserAgent(), userID)
	})
}

func formatAny(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case int:
		return fmt.Sprintf("%d", t)
	case int64:
		return fmt.Sprintf("%d", t)
	case uint64:
		return fmt.Sprintf("%d", t)
	default:
		return "-"
	}
}
