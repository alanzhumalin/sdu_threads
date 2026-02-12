package dto

type OpenDirectChatRequest struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
}

type SendMessageRequest struct {
	Body      string `json:"body"`
	ReplyToID string `json:"reply_to_id"`
}
