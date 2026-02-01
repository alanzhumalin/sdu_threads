package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type RateLimiter struct {
	rpm      int
	limiters map[string]*rate.Limiter
	mu       sync.Mutex
}

func NewRateLimiter(rpm int) *RateLimiter {
	if rpm <= 0 {
		rpm = 120
	}
	return &RateLimiter{
		rpm:      rpm,
		limiters: make(map[string]*rate.Limiter),
	}
}

func (r *RateLimiter) getLimiter(ip string) *rate.Limiter {
	r.mu.Lock()
	defer r.mu.Unlock()
	lim, ok := r.limiters[ip]
	if !ok {
		lim = rate.NewLimiter(rate.Every(time.Minute/time.Duration(r.rpm)), r.rpm/2+1)
		r.limiters[ip] = lim
	}
	return lim
}

func (r *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ip, _, _ := net.SplitHostPort(req.RemoteAddr)
		if ip == "" {
			ip = req.RemoteAddr
		}
		lim := r.getLimiter(ip)
		if !lim.Allow() {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte("rate limit exceeded"))
			return
		}
		next.ServeHTTP(w, req)
	})
}
