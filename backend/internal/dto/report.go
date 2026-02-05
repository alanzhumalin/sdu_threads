package dto

type CreateReportRequest struct {
	TargetType string `json:"target_type"` // "post" | "user"
	TargetID   string `json:"target_id"`
	Reason     string `json:"reason"`
	Details    string `json:"details,omitempty"`
}

type CreateReportResponse struct {
	Status string `json:"status"`
	ID     string `json:"id,omitempty"`
}
