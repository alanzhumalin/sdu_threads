package models

import "time"

type Post struct {
	ID        uint64 `gorm:"primaryKey"`
	UserID    uint64 `gorm:"not null;index"`
	Content   string `gorm:"type:text;not null"`
	MediaURL  string
	CreatedAt time.Time `gorm:"not null;default:now()"`
	UpdatedAt time.Time `gorm:"not null;default:now()"`
	User      User      `gorm:"foreignKey:UserID"`
}
