package dto

type UpdateProfileRequest struct {
	FullName      *string            `json:"full_name,omitempty"`
	Bio           *string            `json:"bio,omitempty"`
	AvatarURL     *string            `json:"avatar_url,omitempty"`
	BackgroundURL *string            `json:"background_url,omitempty"`
	SocialLinks   *map[string]string `json:"social_links,omitempty"`
}
