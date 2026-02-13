package cache

import (
	"context"
	"time"
)

// Store is a low-level cache backend for binary payloads.
// Miss is represented by (nil, nil).
type Store interface {
	Get(ctx context.Context, key string) ([]byte, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Delete(ctx context.Context, key string) error
	DeleteByPrefix(ctx context.Context, prefix string) error
	Close() error
}
