package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
)

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

type errorPayload struct {
	Code              string `json:"code"`
	Message           string `json:"message"`
	RetryAfterSeconds int    `json:"retry_after_seconds,omitempty"`
}

func writeErrorPayload(w http.ResponseWriter, status int, payload errorPayload) {
	writeJSON(w, status, map[string]errorPayload{"error": payload})
}

// setNextOffset writes X-Next-Offset header if more data is likely.
func setNextOffset(w http.ResponseWriter, offset, limit, count int) {
	if count == limit {
		w.Header().Set("X-Next-Offset", strconv.Itoa(offset+count))
	}
}
