package cache

import (
	"context"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisConfig struct {
	Addr         string
	Password     string
	DB           int
	KeyPrefix    string
	DialTimeout  time.Duration
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

type RedisStore struct {
	client    *redis.Client
	keyPrefix string
}

func NewRedisStore(cfg RedisConfig) (*RedisStore, error) {
	opts := &redis.Options{
		Addr:         strings.TrimSpace(cfg.Addr),
		Password:     cfg.Password,
		DB:           cfg.DB,
		DialTimeout:  cfg.DialTimeout,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
	}
	if opts.DialTimeout <= 0 {
		opts.DialTimeout = 500 * time.Millisecond
	}
	if opts.ReadTimeout <= 0 {
		opts.ReadTimeout = 500 * time.Millisecond
	}
	if opts.WriteTimeout <= 0 {
		opts.WriteTimeout = 500 * time.Millisecond
	}

	c := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), opts.DialTimeout+250*time.Millisecond)
	defer cancel()
	if err := c.Ping(ctx).Err(); err != nil {
		_ = c.Close()
		return nil, err
	}
	return &RedisStore{
		client:    c,
		keyPrefix: strings.TrimSpace(cfg.KeyPrefix),
	}, nil
}

func (s *RedisStore) Get(ctx context.Context, key string) ([]byte, error) {
	raw, err := s.client.Get(ctx, s.withPrefix(key)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func (s *RedisStore) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if ttl <= 0 {
		return nil
	}
	return s.client.Set(ctx, s.withPrefix(key), value, ttl).Err()
}

func (s *RedisStore) Delete(ctx context.Context, key string) error {
	return s.client.Del(ctx, s.withPrefix(key)).Err()
}

func (s *RedisStore) DeleteByPrefix(ctx context.Context, prefix string) error {
	pattern := s.withPrefix(prefix) + "*"
	var cursor uint64
	for {
		keys, next, err := s.client.Scan(ctx, cursor, pattern, 200).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := s.client.Del(ctx, keys...).Err(); err != nil {
				return err
			}
		}
		cursor = next
		if cursor == 0 {
			return nil
		}
	}
}

func (s *RedisStore) Close() error {
	return s.client.Close()
}

func (s *RedisStore) withPrefix(key string) string {
	if s.keyPrefix == "" {
		return key
	}
	return s.keyPrefix + key
}
