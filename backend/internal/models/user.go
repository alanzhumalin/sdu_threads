package models

import "time"

type User struct {
	ID              string `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Email           string `gorm:"uniqueIndex;not null"`
	Username        string `gorm:"uniqueIndex;not null"`
	FullName        string `gorm:"not null"`
	IsVerified      bool   `gorm:"not null;default:false"`
	PasswordHash    string `gorm:"not null"`
	Role            string `gorm:"not null;default:user"`
	IsRootAdmin     bool   `gorm:"not null;default:false"`
	Bio             string
	AvatarURL       string
	BackgroundURL   string
	SocialLinks     SocialLinks `gorm:"type:jsonb"`
	AcceptedRulesAt *time.Time
	LastSeenAt      *time.Time
	CreatedAt       time.Time `gorm:"not null;default:now()"`
	UpdatedAt       time.Time `gorm:"not null;default:now()"`
}
