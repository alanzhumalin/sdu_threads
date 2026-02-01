package dto

type RegisterRequest struct {
	Email         string `json:"email"`
	Username      string `json:"username"`
	FullName      string `json:"full_name"`
	Password      string `json:"password"`
	Major         string `json:"major"`
	AvatarURL     string `json:"avatar_url"`
	BackgroundURL string `json:"background_url"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string `json:"token"`
}
