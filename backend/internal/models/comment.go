package models

import "time"

type Comment struct {
	ID        uint64    `gorm:"primaryKey"`
	PostID    uint64    `gorm:"not null;index"`
	UserID    uint64    `gorm:"not null;index"`
	Body      string    `gorm:"type:text;not null"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
	UpdatedAt time.Time `gorm:"not null;default:now()"`
}
