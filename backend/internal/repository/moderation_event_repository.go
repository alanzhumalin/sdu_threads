package repository

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"sduthreads/internal/moderation"

	"gorm.io/gorm"
)

type ModerationEventRepository struct {
	db *gorm.DB
}

func NewModerationEventRepository(db *gorm.DB) *ModerationEventRepository {
	return &ModerationEventRepository{db: db}
}

type ModerationEventRow struct {
	ID               string
	ActorUserID      string
	ActorUsername    string
	ActorFullName    string
	ActorAvatarURL   string
	Scope            string
	Action           string
	TargetType       string
	TargetID         string
	Blocked          bool
	Reason           string
	Score            float64
	Source           string
	MatchedTermsJSON string
	LabelsJSON       string
	PayloadJSON      string
	CreatedAt        time.Time
}

func (r *ModerationEventRepository) CreateFromEvent(ctx context.Context, ev moderation.Event) error {
	if r == nil || r.db == nil {
		return nil
	}

	actorID := strings.TrimSpace(ev.ActorUserID)
	scope := strings.TrimSpace(ev.Scope)
	action := strings.TrimSpace(ev.Action)
	targetType := strings.TrimSpace(ev.TargetType)
	targetID := strings.TrimSpace(ev.TargetID)
	reason := strings.TrimSpace(ev.Reason)
	source := strings.TrimSpace(ev.Source)

	if scope == "" {
		scope = "unknown"
	}
	if action == "" {
		action = scope
	}
	if reason == "" {
		reason = "контент не прошел модерацию"
	}

	matched, _ := json.Marshal(normalizeStringList(ev.MatchedTerms))
	labels, _ := json.Marshal(normalizeFloatMap(ev.Labels))
	payload, _ := json.Marshal(normalizeAnyMap(ev.Payload))

	const q = `
INSERT INTO moderation_events
  (actor_user_id, scope, action, target_type, target_id, blocked, reason, score, source, matched_terms, labels, payload)
VALUES
  (NULLIF(?, '')::uuid, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
`
	return r.db.WithContext(ctx).Exec(
		q,
		actorID,
		scope,
		action,
		targetType,
		targetID,
		ev.Blocked,
		reason,
		ev.Score,
		source,
		string(matched),
		string(labels),
		string(payload),
	).Error
}

func (r *ModerationEventRepository) List(ctx context.Context, scope string, query string, limit int, offset int) ([]ModerationEventRow, error) {
	if r == nil || r.db == nil {
		return []ModerationEventRow{}, nil
	}

	scope = strings.TrimSpace(scope)
	query = strings.TrimSpace(query)
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	const q = `
SELECT
  e.id,
  COALESCE(e.actor_user_id::text, '') AS actor_user_id,
  COALESCE(u.username, '') AS actor_username,
  COALESCE(u.full_name, '') AS actor_full_name,
  COALESCE(u.avatar_url, '') AS actor_avatar_url,
  e.scope,
  e.action,
  COALESCE(e.target_type, '') AS target_type,
  COALESCE(e.target_id, '') AS target_id,
  e.blocked,
  COALESCE(e.reason, '') AS reason,
  COALESCE(e.score, 0) AS score,
  COALESCE(e.source, '') AS source,
  COALESCE(e.matched_terms::text, '[]') AS matched_terms_json,
  COALESCE(e.labels::text, '{}') AS labels_json,
  COALESCE(e.payload::text, '{}') AS payload_json,
  e.created_at
FROM moderation_events e
LEFT JOIN users u ON u.id = e.actor_user_id
WHERE (? = '' OR e.scope = ?)
  AND (
    ? = ''
    OR e.reason ILIKE '%' || ? || '%'
    OR e.action ILIKE '%' || ? || '%'
    OR e.target_id ILIKE '%' || ? || '%'
    OR COALESCE(u.username, '') ILIKE '%' || ? || '%'
  )
ORDER BY e.created_at DESC
LIMIT ? OFFSET ?
`

	rows := make([]ModerationEventRow, 0, limit)
	err := r.db.WithContext(ctx).Raw(
		q,
		scope,
		scope,
		query,
		query,
		query,
		query,
		query,
		limit,
		offset,
	).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func normalizeStringList(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, raw := range in {
		v := strings.TrimSpace(raw)
		if v == "" {
			continue
		}
		key := strings.ToLower(v)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, v)
	}
	if len(out) == 0 {
		return []string{}
	}
	return out
}

func normalizeFloatMap(in map[string]float64) map[string]float64 {
	if len(in) == 0 {
		return map[string]float64{}
	}
	out := make(map[string]float64, len(in))
	for k, v := range in {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		out[key] = v
	}
	return out
}

func normalizeAnyMap(in map[string]any) map[string]any {
	if len(in) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		out[key] = v
	}
	return out
}
