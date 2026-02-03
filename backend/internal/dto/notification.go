package dto

import "time"

type Notification struct {
	ID            string    `json:"id"`
	Type          string    `json:"type"` // like, comment, follow, mention
	ActorID       string    `json:"actor_id"`
	ActorUsername string    `json:"actor_username"`
	ActorFullName string    `json:"actor_full_name,omitempty"`
	PostID        string    `json:"post_id,omitempty"`
	CommentID     string    `json:"comment_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	Message       string    `json:"message,omitempty"`
}
