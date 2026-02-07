package repository

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"sduthreads/internal/apperror"
	"sduthreads/internal/models"

	"gorm.io/gorm"
)

type PostCreateLimits struct {
	Cooldown      time.Duration
	HourWindow    time.Duration
	HourMaxPosts  int
	MediaCooldown time.Duration
}

// CreateWithRateLimit enforces per-user limits for post creation in Postgres (no Redis):
// - Cooldown between any posts (Cooldown)
// - Max posts per hour window (HourMaxPosts in HourWindow)
// - Cooldown between media posts (MediaCooldown), applied only when current post has media
//
// It uses a per-user transactional advisory lock to avoid race conditions
// when multiple create requests are sent concurrently.
func (r *PostRepository) CreateWithRateLimit(ctx context.Context, post *models.Post, media []models.PostMedia, limits PostCreateLimits) error {
	if post == nil {
		return nil
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Use DB clock to make retry_after_seconds consistent with SQL timestamps.
		var now time.Time
		if err := tx.Raw("SELECT NOW()").Scan(&now).Error; err != nil {
			return err
		}

		// Serialize create attempts per user_id.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", post.UserID).Error; err != nil {
			return err
		}

		var lastPost sql.NullTime
		if err := tx.Raw(
			`SELECT created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
			post.UserID,
		).Scan(&lastPost).Error; err != nil {
			return err
		}

		windowStart := now.Add(-limits.HourWindow)
		var tenthInWindow sql.NullTime
		if limits.HourMaxPosts > 0 {
			if err := tx.Raw(
				`SELECT created_at
				 FROM posts
				 WHERE user_id = ? AND created_at > ?
				 ORDER BY created_at DESC
				 OFFSET ? LIMIT 1`,
				post.UserID,
				windowStart,
				limits.HourMaxPosts-1, // 10th post => OFFSET 9
			).Scan(&tenthInWindow).Error; err != nil {
				return err
			}
		}

		// media is already trimmed/cleaned in service, but be defensive.
		hasMedia := strings.TrimSpace(post.MediaURL) != "" || len(media) > 0
		var lastMedia sql.NullTime
		if hasMedia {
			if err := tx.Raw(
				`SELECT created_at
				 FROM posts
				 WHERE user_id = ? AND media_url IS NOT NULL AND media_url <> ''
				 ORDER BY created_at DESC
				 LIMIT 1`,
				post.UserID,
			).Scan(&lastMedia).Error; err != nil {
				return err
			}
		}

		if retry, limited := computePostCreateRetry(now, lastPost, tenthInWindow, lastMedia, hasMedia, limits); limited {
			return apperror.NewRateLimit("Too many posts", retry)
		}

		if err := tx.Create(post).Error; err != nil {
			return err
		}

		// Persist media ordering separately (multi-media posts).
		if len(media) > 0 {
			if len(media) > 5 {
				media = media[:5]
			}
			rows := make([]models.PostMedia, 0, len(media))
			for i, m := range media {
				u := strings.TrimSpace(m.URL)
				if u == "" {
					continue
				}
				w := m.Width
				h := m.Height
				if w < 0 {
					w = 0
				}
				if h < 0 {
					h = 0
				}
				rows = append(rows, models.PostMedia{
					PostID:    post.ID,
					URL:       u,
					Width:     w,
					Height:    h,
					SortOrder: i,
				})
			}
			if len(rows) > 0 {
				if err := tx.Create(&rows).Error; err != nil {
					return err
				}
			}
		}

		return nil
	})
}

func computePostCreateRetry(
	now time.Time,
	lastPost sql.NullTime,
	tenthInWindow sql.NullTime,
	lastMedia sql.NullTime,
	isMedia bool,
	limits PostCreateLimits,
) (retryAfterSeconds int, limited bool) {
	nextAllowed := now

	if limits.Cooldown > 0 && lastPost.Valid {
		t := lastPost.Time.Add(limits.Cooldown)
		if t.After(now) {
			limited = true
			if t.After(nextAllowed) {
				nextAllowed = t
			}
		}
	}

	if limits.HourMaxPosts > 0 && limits.HourWindow > 0 && tenthInWindow.Valid {
		t := tenthInWindow.Time.Add(limits.HourWindow)
		if t.After(now) {
			limited = true
			if t.After(nextAllowed) {
				nextAllowed = t
			}
		}
	}

	if isMedia && limits.MediaCooldown > 0 && lastMedia.Valid {
		t := lastMedia.Time.Add(limits.MediaCooldown)
		if t.After(now) {
			limited = true
			if t.After(nextAllowed) {
				nextAllowed = t
			}
		}
	}

	if !limited {
		return 0, false
	}

	d := nextAllowed.Sub(now)
	// Ceiling to seconds to avoid returning 0 when still limited.
	sec := int((d + time.Second - 1) / time.Second)
	if sec < 1 {
		sec = 1
	}
	return sec, true
}
