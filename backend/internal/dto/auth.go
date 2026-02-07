package dto

type RegisterRequest struct {
	Email         string `json:"email"`
	Username      string `json:"username"`
	FullName      string `json:"full_name"`
	Password      string `json:"password"`
	AcceptedRules bool   `json:"accepted_rules"`
	Bio           string `json:"bio"`
	AvatarURL     string `json:"avatar_url"`
	BackgroundURL string `json:"background_url"`
}

type LoginRequest struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string `json:"token"`
}
