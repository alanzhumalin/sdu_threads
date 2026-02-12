package models

import "time"

type ChatParticipant struct {
	ChatID    string    `gorm:"type:uuid;primaryKey"`
	UserID    string    `gorm:"type:uuid;primaryKey"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
}
