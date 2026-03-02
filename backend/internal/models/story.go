package models

import "time"

type Story struct {
	ID        string    `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	UserID    string    `gorm:"type:uuid;not null;index"`
	Content   string    `gorm:"type:text;not null;default:''"`
	MediaURL  string    `gorm:"type:text;not null"`
	MediaType string    `gorm:"type:text;not null"`
	Width     int       `gorm:"not null;default:0"`
	Height    int       `gorm:"not null;default:0"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
	ExpiresAt time.Time `gorm:"not null"`
}

func (Story) TableName() string {
	return "stories"
}
