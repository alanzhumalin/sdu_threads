package dto

import "time"

type Notification struct {
	ID             string    `json:"id"`
	Type           string    `json:"type"` // like, comment, follow, mention
	ActorID        string    `json:"actor_id"`
	ActorUsername  string    `json:"actor_username"`
	ActorFullName  string    `json:"actor_full_name,omitempty"`
	ActorAvatarURL string    `json:"actor_avatar_url,omitempty"`
	PostID         string    `json:"post_id,omitempty"`
	CommentID      string    `json:"comment_id,omitempty"`
	PostContent    string    `json:"post_content,omitempty"`
	PostMediaURL   string    `json:"post_media_url,omitempty"`
	CommentBody    string    `json:"comment_body,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	Message        string    `json:"message,omitempty"`
	Read           bool      `json:"read"`
}
