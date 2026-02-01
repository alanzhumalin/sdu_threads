package dto

type CreatePostRequest struct {
	Content  string   `json:"content"`
	MediaURL string   `json:"media_url"`
	Hashtags []string `json:"hashtags"`
}

type FeedResponseItem struct {
	ID        uint64 `json:"id"`
	UserID    uint64 `json:"user_id"`
	Username  string `json:"username"`
	FullName  string `json:"full_name"`
	Content   string `json:"content"`
	MediaURL  string `json:"media_url"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	LikeCount int64  `json:"like_count"`
	LikedByMe bool   `json:"liked_by_me"`
}

type LikeRequest struct{}
