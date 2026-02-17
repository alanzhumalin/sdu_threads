package dto

type CreatePostRequest struct {
	Content   string      `json:"content"`
	Media     []MediaItem `json:"media,omitempty"`      // preferred: urls + dimensions
	MediaURL  string      `json:"media_url,omitempty"`  // legacy: first media url
	MediaURLs []string    `json:"media_urls,omitempty"` // legacy: urls only
	Music     *PostMusic  `json:"music,omitempty"`
	Hashtags  []string    `json:"hashtags,omitempty"`
}

type MediaItem struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type PostMusic struct {
	Source       string `json:"source,omitempty"`
	TrackID      string `json:"track_id,omitempty"`
	Title        string `json:"title,omitempty"`
	Artist       string `json:"artist,omitempty"`
	CoverURL     string `json:"cover_url,omitempty"`
	AudioURL     string `json:"audio_url,omitempty"`
	DurationSec  int    `json:"duration_sec,omitempty"`
	ClipStartSec int    `json:"clip_start_sec,omitempty"`
	ClipEndSec   int    `json:"clip_end_sec,omitempty"`
}

type FeedResponseItem struct {
	ID           string         `json:"id"`
	UserID       string         `json:"user_id"`
	Username     string         `json:"username"`
	FullName     string         `json:"full_name"`
	IsVerified   bool           `json:"is_verified"`
	AvatarURL    string         `json:"avatar_url,omitempty"`
	Content      string         `json:"content"`
	Media        []MediaItem    `json:"media,omitempty"`
	Music        *PostMusic     `json:"music,omitempty"`
	CreatedAt    string         `json:"created_at"`
	UpdatedAt    string         `json:"updated_at"`
	LikeCount    int64          `json:"like_count"`
	LikedByMe    bool           `json:"liked_by_me"`
	Reactions    []ReactionItem `json:"reactions"`
	ViewCount    int64          `json:"view_count"`
	CommentCount int64          `json:"comment_count"`
	Mentions     []string       `json:"mentions"`
	Hashtags     []string       `json:"hashtags"`
	IsSubscribed bool           `json:"is_subscribed"`
	IsMe         bool           `json:"is_me"`
}

type LikeRequest struct{}
