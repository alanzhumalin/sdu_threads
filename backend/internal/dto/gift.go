package dto

type GiftWish struct {
	Author string `json:"author"`
	Text   string `json:"text"`
}

type GiftMedia struct {
	URL    string `json:"url"`
	Type   string `json:"type,omitempty"`
	Width  int    `json:"width,omitempty"`
	Height int    `json:"height,omitempty"`
}

type CreateGiftRequest struct {
	ToName        string     `json:"to_name"`
	FromName      string     `json:"from_name"`
	Message       string     `json:"message"`
	OpenLine      string     `json:"open_line,omitempty"`
	Code          string     `json:"code,omitempty"`
	UILanguage    string     `json:"ui_language,omitempty"`
	AnimationType string     `json:"animation_type"`
	Media         GiftMedia  `json:"media"`
	Wishes        []GiftWish `json:"wishes,omitempty"`
}

type GiftCardResponse struct {
	Code          string     `json:"code"`
	ToName        string     `json:"to_name"`
	FromName      string     `json:"from_name"`
	Message       string     `json:"message"`
	OpenLine      string     `json:"open_line"`
	UILanguage    string     `json:"ui_language"`
	AnimationType string     `json:"animation_type"`
	Media         GiftMedia  `json:"media"`
	Wishes        []GiftWish `json:"wishes"`
	CreatedAt     string     `json:"created_at"`
	ExpiresAt     string     `json:"expires_at"`
}
