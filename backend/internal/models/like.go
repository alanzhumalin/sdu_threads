package models

import "time"

type Like struct {
	ID        string    `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	PostID    string    `gorm:"type:uuid;not null;index"`
	UserID    string    `gorm:"type:uuid;not null;index"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
}
