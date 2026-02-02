package models

import "time"

type Comment struct {
	ID               string    `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	PostID           string    `gorm:"type:uuid;not null;index"`
	UserID           string    `gorm:"type:uuid;not null;index"`
	ReplyToCommentID *string   `gorm:"type:uuid"`
	Body             string    `gorm:"type:text;not null"`
	CreatedAt        time.Time `gorm:"not null;default:now()"`
	UpdatedAt        time.Time `gorm:"not null;default:now()"`
}
