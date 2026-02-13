package cache

import (
	"context"
	"encoding/json"
	"log"
	"math/rand"
	"time"

	"golang.org/x/sync/singleflight"
)

type QueryCache struct {
	enabled bool
	store   Store
	sf      singleflight.Group
}

func NewQueryCache(enabled bool, store Store) *QueryCache {
	if !enabled || store == nil {
		return &QueryCache{enabled: false}
	}
	return &QueryCache{
		enabled: true,
		store:   store,
	}
}

func (c *QueryCache) Enabled() bool {
	return c != nil && c.enabled && c.store != nil
}

func (c *QueryCache) DeleteByPrefix(ctx context.Context, prefix string) error {
	if !c.Enabled() {
		return nil
	}
	return c.store.DeleteByPrefix(ctx, prefix)
}

func (c *QueryCache) Close() error {
	if !c.Enabled() {
		return nil
	}
	return c.store.Close()
}

func GetOrLoadJSON[T any](
	ctx context.Context,
	c *QueryCache,
	key string,
	ttl time.Duration,
	loader func(context.Context) (T, error),
) (T, error) {
	var zero T
	if !c.Enabled() || ttl <= 0 {
		return loader(ctx)
	}

	raw, err := c.getOrLoadRaw(ctx, key, ttl, func(ctx context.Context) ([]byte, error) {
		out, err := loader(ctx)
		if err != nil {
			return nil, err
		}
		return json.Marshal(out)
	})
	if err != nil {
		return zero, err
	}

	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		return zero, err
	}
	return out, nil
}

func (c *QueryCache) getOrLoadRaw(
	ctx context.Context,
	key string,
	ttl time.Duration,
	loader func(context.Context) ([]byte, error),
) ([]byte, error) {
	if raw, err := c.store.Get(ctx, key); err == nil && raw != nil {
		return raw, nil
	} else if err != nil {
		log.Printf("cache get failed key=%s err=%v", key, err)
	}

	v, err, _ := c.sf.Do(key, func() (any, error) {
		// Check again under singleflight to avoid duplicate DB fetches.
		if raw, err := c.store.Get(ctx, key); err == nil && raw != nil {
			return raw, nil
		}
		raw, err := loader(ctx)
		if err != nil {
			return nil, err
		}
		if err := c.store.Set(ctx, key, raw, jitterTTL(ttl)); err != nil {
			log.Printf("cache set failed key=%s err=%v", key, err)
		}
		return raw, nil
	})
	if err != nil {
		return nil, err
	}
	raw, ok := v.([]byte)
	if !ok {
		return nil, nil
	}
	return raw, nil
}

func jitterTTL(ttl time.Duration) time.Duration {
	if ttl <= time.Second {
		return ttl
	}
	window := ttl / 10
	if window <= 0 {
		return ttl
	}
	shift := time.Duration(rand.Int63n(int64(window)*2+1)) - window
	adjusted := ttl + shift
	if adjusted < time.Second {
		return time.Second
	}
	return adjusted
}
