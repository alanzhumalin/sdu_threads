package repository

import (
	"database/sql"
	"testing"
	"time"
)

func nt(t time.Time) sql.NullTime {
	return sql.NullTime{Time: t, Valid: true}
}

func TestComputePostCreateRetry_NoLimits(t *testing.T) {
	now := time.Date(2026, 2, 5, 12, 0, 0, 0, time.UTC)
	limits := PostCreateLimits{
		Cooldown:      60 * time.Second,
		HourWindow:    60 * time.Minute,
		HourMaxPosts:  10,
		MediaCooldown: 120 * time.Second,
	}
	retry, limited := computePostCreateRetry(now, sql.NullTime{}, sql.NullTime{}, sql.NullTime{}, false, limits)
	if limited {
		t.Fatalf("expected not limited, got limited retry=%d", retry)
	}
	if retry != 0 {
		t.Fatalf("expected retry=0, got %d", retry)
	}
}

func TestComputePostCreateRetry_Cooldown(t *testing.T) {
	now := time.Date(2026, 2, 5, 12, 0, 0, 0, time.UTC)
	limits := PostCreateLimits{Cooldown: 60 * time.Second}

	last := nt(now.Add(-30 * time.Second))
	retry, limited := computePostCreateRetry(now, last, sql.NullTime{}, sql.NullTime{}, false, limits)
	if !limited {
		t.Fatalf("expected limited")
	}
	if retry != 30 {
		t.Fatalf("expected retry=30, got %d", retry)
	}
}

func TestComputePostCreateRetry_HourMaxPosts(t *testing.T) {
	now := time.Date(2026, 2, 5, 12, 0, 0, 0, time.UTC)
	limits := PostCreateLimits{HourWindow: 60 * time.Minute, HourMaxPosts: 10}

	tenth := nt(now.Add(-10 * time.Minute))
	retry, limited := computePostCreateRetry(now, sql.NullTime{}, tenth, sql.NullTime{}, false, limits)
	if !limited {
		t.Fatalf("expected limited")
	}
	// Need to wait until the 10th latest post leaves the 60-minute window.
	if retry != 50*60 {
		t.Fatalf("expected retry=%d, got %d", 50*60, retry)
	}
}

func TestComputePostCreateRetry_MediaCooldown(t *testing.T) {
	now := time.Date(2026, 2, 5, 12, 0, 0, 0, time.UTC)
	limits := PostCreateLimits{MediaCooldown: 120 * time.Second}

	lastMedia := nt(now.Add(-60 * time.Second))
	retry, limited := computePostCreateRetry(now, sql.NullTime{}, sql.NullTime{}, lastMedia, true, limits)
	if !limited {
		t.Fatalf("expected limited")
	}
	if retry != 60 {
		t.Fatalf("expected retry=60, got %d", retry)
	}
}

func TestComputePostCreateRetry_PicksMaxConstraint(t *testing.T) {
	now := time.Date(2026, 2, 5, 12, 0, 0, 0, time.UTC)
	limits := PostCreateLimits{
		Cooldown:      60 * time.Second,
		HourWindow:    60 * time.Minute,
		HourMaxPosts:  10,
		MediaCooldown: 120 * time.Second,
	}

	lastPost := nt(now.Add(-30 * time.Second))  // 30s left
	tenth := nt(now.Add(-10 * time.Minute))     // 50m left
	lastMedia := nt(now.Add(-60 * time.Second)) // 60s left (media)
	retry, limited := computePostCreateRetry(now, lastPost, tenth, lastMedia, true, limits)
	if !limited {
		t.Fatalf("expected limited")
	}
	// Hour limit is the strongest here.
	if retry != 50*60 {
		t.Fatalf("expected retry=%d, got %d", 50*60, retry)
	}
}

func TestComputePostCreateRetry_CeilSeconds(t *testing.T) {
	now := time.Date(2026, 2, 5, 12, 0, 0, 0, time.UTC)
	limits := PostCreateLimits{Cooldown: 60 * time.Second}

	// If nextAllowed is 1.2s away, we must return 2 seconds (ceil).
	last := nt(now.Add(-58*time.Second - 800*time.Millisecond))
	retry, limited := computePostCreateRetry(now, last, sql.NullTime{}, sql.NullTime{}, false, limits)
	if !limited {
		t.Fatalf("expected limited")
	}
	if retry != 2 {
		t.Fatalf("expected retry=2, got %d", retry)
	}
}
