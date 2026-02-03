package middleware

import (
	"net/http"
	"strings"
)

// PathRateLimiter applies per-path rate limits (per IP), with a default limiter for all other paths.
type PathRateLimiter struct {
	defaultLimiter *RateLimiter
	overrides      map[string]*RateLimiter
}

// NewPathRateLimiter creates a path-aware limiter.
// overrides map keys are exact path prefixes (e.g., "/api/auth/register") with their own RPM.
func NewPathRateLimiter(defaultRPM int, overrides map[string]int) *PathRateLimiter {
	ov := make(map[string]*RateLimiter)
	for k, rpm := range overrides {
		ov[k] = NewRateLimiter(rpm)
	}
	return &PathRateLimiter{
		defaultLimiter: NewRateLimiter(defaultRPM),
		overrides:      ov,
	}
}

func (p *PathRateLimiter) pickLimiter(path string) *RateLimiter {
	for prefix, lim := range p.overrides {
		if strings.HasPrefix(path, prefix) {
			return lim
		}
	}
	return p.defaultLimiter
}

func (p *PathRateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := strings.Split(r.RemoteAddr, ":")[0]
		lim := p.pickLimiter(r.URL.Path)
		if !lim.Allow(ip) {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte("rate limit exceeded"))
			return
		}
		next.ServeHTTP(w, r)
	})
}
