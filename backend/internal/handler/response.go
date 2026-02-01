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

// setNextOffset writes X-Next-Offset header if more data is likely.
func setNextOffset(w http.ResponseWriter, offset, limit, count int) {
	if count == limit {
		w.Header().Set("X-Next-Offset", strconv.Itoa(offset+count))
	}
}
