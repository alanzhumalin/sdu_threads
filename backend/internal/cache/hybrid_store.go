package cache

import (
	"context"
	"errors"
	"time"
)

// HybridStore reads from L1 first and falls back to L2.
// Writes/deletes are applied to both levels.
type HybridStore struct {
	l1 Store
	l2 Store
}

func NewHybridStore(l1 Store, l2 Store) *HybridStore {
	return &HybridStore{l1: l1, l2: l2}
}

func (s *HybridStore) Get(ctx context.Context, key string) ([]byte, error) {
	if s.l1 != nil {
		raw, err := s.l1.Get(ctx, key)
		if err == nil && raw != nil {
			return raw, nil
		}
		if err != nil {
			// fall back to L2
		}
	}
	if s.l2 == nil {
		return nil, nil
	}
	raw, err := s.l2.Get(ctx, key)
	if err != nil || raw == nil {
		return raw, err
	}
	if s.l1 != nil {
		// Best-effort write-through to L1. TTL is intentionally short.
		_ = s.l1.Set(ctx, key, raw, 15*time.Second)
	}
	return raw, nil
}

func (s *HybridStore) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	var errs []error
	if s.l1 != nil {
		if err := s.l1.Set(ctx, key, value, ttl); err != nil {
			errs = append(errs, err)
		}
	}
	if s.l2 != nil {
		if err := s.l2.Set(ctx, key, value, ttl); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (s *HybridStore) Delete(ctx context.Context, key string) error {
	var errs []error
	if s.l1 != nil {
		if err := s.l1.Delete(ctx, key); err != nil {
			errs = append(errs, err)
		}
	}
	if s.l2 != nil {
		if err := s.l2.Delete(ctx, key); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (s *HybridStore) DeleteByPrefix(ctx context.Context, prefix string) error {
	var errs []error
	if s.l1 != nil {
		if err := s.l1.DeleteByPrefix(ctx, prefix); err != nil {
			errs = append(errs, err)
		}
	}
	if s.l2 != nil {
		if err := s.l2.DeleteByPrefix(ctx, prefix); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (s *HybridStore) Close() error {
	var errs []error
	if s.l1 != nil {
		if err := s.l1.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if s.l2 != nil {
		if err := s.l2.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
