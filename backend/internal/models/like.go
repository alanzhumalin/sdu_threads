package models

import "time"

type Like struct {
	ID        uint64    `gorm:"primaryKey"`
	PostID    uint64    `gorm:"not null;index"`
	UserID    uint64    `gorm:"not null;index"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
}
