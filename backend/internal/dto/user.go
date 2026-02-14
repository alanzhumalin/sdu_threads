package dto

type CreateUserRequest struct {
	Email         string `json:"email"`
	Username      string `json:"username"`
	FullName      string `json:"full_name"`
	Bio           string `json:"bio"`
	AvatarURL     string `json:"avatar_url"`
	BackgroundURL string `json:"background_url"`
}

type UserResponse struct {
	ID            string `json:"id"`
	Username      string `json:"username"`
	FullName      string `json:"full_name"`
	IsVerified    bool   `json:"is_verified"`
	Bio           string `json:"bio,omitempty"`
	AvatarURL     string `json:"avatar_url,omitempty"`
	BackgroundURL string `json:"background_url,omitempty"`
}
