package dto

type OpenDirectChatRequest struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
}

type ChatMessageAttachment struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Type   string `json:"type"`
}

type SendMessageRequest struct {
	Body        string                  `json:"body"`
	ReplyToID   string                  `json:"reply_to_id"`
	Attachments []ChatMessageAttachment `json:"attachments"`
}

type UpdateChatThemeRequest struct {
	ThemeKey string `json:"theme_key"`
}

type ChatThemeResponse struct {
	ThemeKey string `json:"theme_key"`
}
