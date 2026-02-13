package dto

import "time"

type ModerationLogItem struct {
	ID             string             `json:"id"`
	ActorUserID    string             `json:"actor_user_id,omitempty"`
	ActorUsername  string             `json:"actor_username,omitempty"`
	ActorFullName  string             `json:"actor_full_name,omitempty"`
	ActorAvatarURL string             `json:"actor_avatar_url,omitempty"`
	Scope          string             `json:"scope"`
	Action         string             `json:"action"`
	TargetType     string             `json:"target_type,omitempty"`
	TargetID       string             `json:"target_id,omitempty"`
	Blocked        bool               `json:"blocked"`
	Reason         string             `json:"reason"`
	Score          float64            `json:"score"`
	Source         string             `json:"source,omitempty"`
	MatchedTerms   []string           `json:"matched_terms,omitempty"`
	Labels         map[string]float64 `json:"labels,omitempty"`
	Payload        map[string]any     `json:"payload,omitempty"`
	CreatedAt      time.Time          `json:"created_at"`
}
