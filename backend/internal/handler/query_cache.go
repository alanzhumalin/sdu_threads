package handler

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"strings"

	"sduthreads/internal/cache"
)

const (
	cachePrefixUsersSearch     = "users:search:v1:"
	cachePrefixHashtagsSearch  = "hashtags:search:v1:"
	cachePrefixHashtagsPopular = "hashtags:popular:v1:"
	cachePrefixTopUsers        = "top-users:v1:"
	cachePrefixFeedPublic      = "feed:public:v1:"
)

func cacheKeyUsersSearch(q string, limit, offset int) string {
	q = normalizeCacheQ(q)
	return fmt.Sprintf("%sq=%s:limit=%d:offset=%d", cachePrefixUsersSearch, url.QueryEscape(q), limit, offset)
}

func cacheKeyHashtagsSearch(q string, limit int) string {
	q = normalizeCacheQ(strings.TrimPrefix(q, "#"))
	return fmt.Sprintf("%sq=%s:limit=%d", cachePrefixHashtagsSearch, url.QueryEscape(q), limit)
}

func cacheKeyHashtagsPopular(limit int) string {
	return fmt.Sprintf("%slimit=%d", cachePrefixHashtagsPopular, limit)
}

func cacheKeyTopUsers(limit int) string {
	return fmt.Sprintf("%slimit=%d", cachePrefixTopUsers, limit)
}

func cacheKeyFeedPublic(limit, offset int) string {
	return fmt.Sprintf("%slimit=%d:offset=%d", cachePrefixFeedPublic, limit, offset)
}

func normalizeCacheQ(q string) string {
	return strings.ToLower(strings.TrimSpace(q))
}

func invalidateCachePrefixes(ctx context.Context, c *cache.QueryCache, prefixes ...string) {
	if c == nil || !c.Enabled() {
		return
	}
	for _, p := range prefixes {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if err := c.DeleteByPrefix(ctx, p); err != nil {
			log.Printf("cache invalidate failed prefix=%s err=%v", p, err)
		}
	}
}
