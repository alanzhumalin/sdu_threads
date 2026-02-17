package dto

type ReactionRequest struct {
	Emoji string `json:"emoji"`
}

type ReactionItem struct {
	Emoji       string `json:"emoji"`
	Count       int64  `json:"count"`
	ReactedByMe bool   `json:"reacted_by_me"`
}
