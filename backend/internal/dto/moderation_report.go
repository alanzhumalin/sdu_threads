package dto

import "time"

// ModerationReportItem is a report record enriched for moderation UI.
type ModerationReportItem struct {
	ID                  string     `json:"id"`
	ReporterID          string     `json:"reporter_id"`
	ReporterUsername    string     `json:"reporter_username"`
	ReporterFullName    string     `json:"reporter_full_name"`
	ReporterAvatarURL   string     `json:"reporter_avatar_url,omitempty"`
	TargetType          string     `json:"target_type"` // "post" | "user"
	PostID              string     `json:"post_id,omitempty"`
	PostStatus          string     `json:"post_status,omitempty"` // "active" | "removed" | "not_found"
	PostContent         string     `json:"post_content,omitempty"`
	PostAuthorID        string     `json:"post_author_id,omitempty"`
	PostAuthorUsername  string     `json:"post_author_username,omitempty"`
	PostAuthorFullName  string     `json:"post_author_full_name,omitempty"`
	PostAuthorAvatarURL string     `json:"post_author_avatar_url,omitempty"`
	PostRemovedAt       *time.Time `json:"post_removed_at,omitempty"`
	TargetUserID        string     `json:"target_user_id,omitempty"`
	TargetUsername      string     `json:"target_username,omitempty"`
	TargetFullName      string     `json:"target_full_name,omitempty"`
	TargetAvatarURL     string     `json:"target_avatar_url,omitempty"`
	Reason              string     `json:"reason"`
	Details             string     `json:"details,omitempty"`
	Status              string     `json:"status"` // "open" | "resolved" | "rejected"
	CreatedAt           time.Time  `json:"created_at"`
	ResolvedBy          string     `json:"resolved_by,omitempty"`
	ResolvedAt          *time.Time `json:"resolved_at,omitempty"`
	ResolutionNote      string     `json:"resolution_note,omitempty"`
}

type ResolveReportRequest struct {
	Status string `json:"status"` // "resolved" | "rejected"
	Note   string `json:"note,omitempty"`
}

type ResolveReportResponse struct {
	Status string `json:"status"`
}
