package dto

type ProfileResponse struct {
	ID            uint64 `json:"id"`
	Email         string `json:"email"`
	Username      string `json:"username"`
	FullName      string `json:"full_name"`
	Major         string `json:"major,omitempty"`
	AvatarURL     string `json:"avatar_url,omitempty"`
	BackgroundURL string `json:"background_url,omitempty"`
	Followers     int64  `json:"followers"`
	Following     int64  `json:"following"`
}
