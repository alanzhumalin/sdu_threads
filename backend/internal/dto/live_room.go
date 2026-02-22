package dto

type CreateLiveRoomRequest struct {
	Title     string `json:"title"`
	IsPrivate bool   `json:"is_private"`
	Password  string `json:"password,omitempty"`
}
