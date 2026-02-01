package models

import "time"

type User struct {
	ID            uint64 `gorm:"primaryKey"`
	Email         string `gorm:"uniqueIndex;not null"`
	Username      string `gorm:"uniqueIndex;not null"`
	FullName      string `gorm:"not null"`
	PasswordHash  string `gorm:"not null"`
	Major         string
	AvatarURL     string
	BackgroundURL string
	CreatedAt     time.Time `gorm:"not null;default:now()"`
	UpdatedAt     time.Time `gorm:"not null;default:now()"`
}
