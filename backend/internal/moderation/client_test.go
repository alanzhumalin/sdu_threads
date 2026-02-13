package moderation

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestHandleServiceErr_Client4xxIsNotUnavailable(t *testing.T) {
	t.Parallel()

	c := NewClient(Config{Enabled: true, BaseURL: "http://moderation:8001", FailClosed: true})
	err := c.handleServiceErr(&APIError{StatusCode: http.StatusBadRequest, Message: "image url is not reachable"})
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if IsUnavailable(err) {
		t.Fatalf("expected non-unavailable error, got unavailable: %v", err)
	}
	if !strings.Contains(err.Error(), "image url is not reachable") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestHandleServiceErr_Server5xxIsUnavailableWhenFailClosed(t *testing.T) {
	t.Parallel()

	c := NewClient(Config{Enabled: true, BaseURL: "http://moderation:8001", FailClosed: true})
	err := c.handleServiceErr(&APIError{StatusCode: http.StatusServiceUnavailable, Message: "model unavailable"})
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if !IsUnavailable(err) {
		t.Fatalf("expected unavailable error, got: %T %v", err, err)
	}
}

func TestHandleServiceErr_Server5xxIsIgnoredWhenFailOpen(t *testing.T) {
	t.Parallel()

	c := NewClient(Config{Enabled: true, BaseURL: "http://moderation:8001", FailClosed: false})
	err := c.handleServiceErr(&APIError{StatusCode: http.StatusServiceUnavailable, Message: "model unavailable"})
	if err != nil {
		t.Fatalf("expected nil error with fail-open mode, got: %v", err)
	}
}

func TestDecodeResponse_Non2xxReturnsAPIError(t *testing.T) {
	t.Parallel()

	resp := &http.Response{
		StatusCode: http.StatusBadRequest,
		Body:       io.NopCloser(strings.NewReader(`{"detail":"image url is not reachable"}`)),
	}
	err := decodeResponse(resp, nil)
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	var apiErr *APIError
	if !strings.Contains(err.Error(), "image url is not reachable") {
		t.Fatalf("unexpected message: %v", err)
	}
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got: %T", err)
	}
	if apiErr.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status code: %d", apiErr.StatusCode)
	}
}
