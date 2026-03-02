package dto

type CreateStoryRequest struct {
	Content   string    `json:"content"`
	Media     MediaItem `json:"media"`
	MediaURL  string    `json:"media_url,omitempty"`  // legacy
	MediaType string    `json:"media_type,omitempty"` // legacy
	Width     int       `json:"width,omitempty"`      // legacy
	Height    int       `json:"height,omitempty"`     // legacy
}
