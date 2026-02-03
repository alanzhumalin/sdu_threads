package dto

type UpdateProfileRequest struct {
	FullName      *string `json:"full_name,omitempty"`
	Major         *string `json:"major,omitempty"`
	AvatarURL     *string `json:"avatar_url,omitempty"`
	BackgroundURL *string `json:"background_url,omitempty"`
}
