package dto

type CreateCommentRequest struct {
	PostID  uint64 `json:"post_id"`
	Content string `json:"content"`
}

type CommentResponse struct {
	ID        uint64 `json:"id"`
	PostID    uint64 `json:"post_id"`
	UserID    uint64 `json:"user_id"`
	Username  string `json:"username"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
	LikedByMe bool   `json:"liked_by_me"`
}
