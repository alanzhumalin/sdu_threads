package cache

import (
	"context"
	"strings"
	"sync"
	"time"
)

type memoryEntry struct {
	value   []byte
	expires time.Time
}

// MemoryStore is an in-process TTL cache with bounded size.
type MemoryStore struct {
	mu          sync.RWMutex
	items       map[string]memoryEntry
	maxEntries  int
	cleanupTick time.Duration
	stopCh      chan struct{}
	doneCh      chan struct{}
}

func NewMemoryStore(maxEntries int, cleanupInterval time.Duration) *MemoryStore {
	if maxEntries <= 0 {
		maxEntries = 5000
	}
	if cleanupInterval <= 0 {
		cleanupInterval = 60 * time.Second
	}
	s := &MemoryStore{
		items:       make(map[string]memoryEntry, maxEntries),
		maxEntries:  maxEntries,
		cleanupTick: cleanupInterval,
		stopCh:      make(chan struct{}),
		doneCh:      make(chan struct{}),
	}
	go s.cleanupLoop()
	return s
}

func (s *MemoryStore) Get(_ context.Context, key string) ([]byte, error) {
	now := time.Now()
	s.mu.RLock()
	it, ok := s.items[key]
	s.mu.RUnlock()
	if !ok {
		return nil, nil
	}
	if !it.expires.IsZero() && now.After(it.expires) {
		s.mu.Lock()
		// Re-check under write lock to avoid deleting a refreshed item.
		if cur, ok := s.items[key]; ok && !cur.expires.IsZero() && now.After(cur.expires) {
			delete(s.items, key)
		}
		s.mu.Unlock()
		return nil, nil
	}
	out := make([]byte, len(it.value))
	copy(out, it.value)
	return out, nil
}

func (s *MemoryStore) Set(_ context.Context, key string, value []byte, ttl time.Duration) error {
	if ttl <= 0 {
		return nil
	}
	exp := time.Now().Add(ttl)
	buf := make([]byte, len(value))
	copy(buf, value)

	s.mu.Lock()
	if _, exists := s.items[key]; !exists && len(s.items) >= s.maxEntries {
		s.evictOneLocked()
	}
	s.items[key] = memoryEntry{value: buf, expires: exp}
	s.mu.Unlock()
	return nil
}

func (s *MemoryStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	delete(s.items, key)
	s.mu.Unlock()
	return nil
}

func (s *MemoryStore) DeleteByPrefix(_ context.Context, prefix string) error {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return nil
	}
	s.mu.Lock()
	for k := range s.items {
		if strings.HasPrefix(k, prefix) {
			delete(s.items, k)
		}
	}
	s.mu.Unlock()
	return nil
}

func (s *MemoryStore) Close() error {
	close(s.stopCh)
	<-s.doneCh
	return nil
}

func (s *MemoryStore) cleanupLoop() {
	ticker := time.NewTicker(s.cleanupTick)
	defer ticker.Stop()
	defer close(s.doneCh)

	for {
		select {
		case <-ticker.C:
			s.cleanupExpired()
		case <-s.stopCh:
			return
		}
	}
}

func (s *MemoryStore) cleanupExpired() {
	now := time.Now()
	s.mu.Lock()
	for k, v := range s.items {
		if !v.expires.IsZero() && now.After(v.expires) {
			delete(s.items, k)
		}
	}
	s.mu.Unlock()
}

func (s *MemoryStore) evictOneLocked() {
	var oldestKey string
	var oldest time.Time
	first := true
	for k, v := range s.items {
		if first || v.expires.Before(oldest) {
			oldestKey = k
			oldest = v.expires
			first = false
		}
	}
	if oldestKey != "" {
		delete(s.items, oldestKey)
	}
}
