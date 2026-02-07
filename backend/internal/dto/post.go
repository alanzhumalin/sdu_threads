package dto

type CreatePostRequest struct {
	Content   string      `json:"content"`
	Media     []MediaItem `json:"media,omitempty"`      // preferred: urls + dimensions
	MediaURL  string      `json:"media_url,omitempty"`  // legacy: first media url
	MediaURLs []string    `json:"media_urls,omitempty"` // legacy: urls only
	Hashtags  []string    `json:"hashtags,omitempty"`
}

type MediaItem struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type FeedResponseItem struct {
	ID           string   `json:"id"`
	UserID       string   `json:"user_id"`
	Username     string   `json:"username"`
	FullName     string   `json:"full_name"`
	AvatarURL    string   `json:"avatar_url,omitempty"`
	Content      string   `json:"content"`
	Media        []MediaItem `json:"media,omitempty"`
	CreatedAt    string   `json:"created_at"`
	UpdatedAt    string   `json:"updated_at"`
	LikeCount    int64    `json:"like_count"`
	LikedByMe    bool     `json:"liked_by_me"`
	ViewCount    int64    `json:"view_count"`
	CommentCount int64    `json:"comment_count"`
	Mentions     []string `json:"mentions"`
	Hashtags     []string `json:"hashtags"`
	IsSubscribed bool     `json:"is_subscribed"`
	IsMe         bool     `json:"is_me"`
}

type LikeRequest struct{}
