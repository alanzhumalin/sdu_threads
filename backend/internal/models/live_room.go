package models

import "time"

type LiveRoom struct {
	ID           string     `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	HostUserID   string     `gorm:"type:uuid;not null;index"`
	Title        string     `gorm:"type:text;not null;default:''"`
	IsPrivate    bool       `gorm:"type:boolean;not null;default:false"`
	PasswordHash string     `gorm:"type:text;not null;default:''"`
	CreatedAt    time.Time  `gorm:"not null;default:now()"`
	UpdatedAt    time.Time  `gorm:"not null;default:now()"`
	EndedAt      *time.Time `gorm:"type:timestamptz"`
}
