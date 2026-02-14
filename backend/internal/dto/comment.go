package dto

type CreateCommentRequest struct {
	PostID   string   `json:"post_id"`
	Content  string   `json:"content"`
	ReplyTo  *string  `json:"reply_to_comment_id,omitempty"`
	Hashtags []string `json:"hashtags,omitempty"`
}

type CommentResponse struct {
	ID               string            `json:"id"`
	PostID           string            `json:"post_id"`
	UserID           string            `json:"user_id"`
	Username         string            `json:"username"`
	FullName         string            `json:"full_name,omitempty"`
	IsVerified       bool              `json:"is_verified"`
	AvatarURL        string            `json:"avatar_url,omitempty"`
	Body             string            `json:"body"`
	CreatedAt        string            `json:"created_at"`
	LikedByMe        bool              `json:"liked_by_me"`
	LikeCount        int64             `json:"like_count"`
	RepliesCount     int64             `json:"replies_count"`
	Replies          []CommentResponse `json:"replies"`
	ReplyToCommentID *string           `json:"reply_to_comment_id,omitempty"`
	ReplyToFullName  *string           `json:"reply_to_full_name,omitempty"`
	ReplyToUsername  *string           `json:"reply_to_username,omitempty"`
	Mentions         []string          `json:"mentions,omitempty"`
	Hashtags         []string          `json:"hashtags,omitempty"`
}
