package apperror

// RateLimitError represents a throttling response for API consumers.
// It is safe to expose to clients (no internal details).
type RateLimitError struct {
	Code              string
	Message           string
	RetryAfterSeconds int
}

func (e *RateLimitError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	return "rate limited"
}

func NewRateLimit(message string, retryAfterSeconds int) *RateLimitError {
	if message == "" {
		message = "Too many requests"
	}
	if retryAfterSeconds < 1 {
		retryAfterSeconds = 1
	}
	return &RateLimitError{
		Code:              "RATE_LIMIT",
		Message:           message,
		RetryAfterSeconds: retryAfterSeconds,
	}
}
