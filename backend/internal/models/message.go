package models

import "time"

type Message struct {
	ID          string              `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ChatID      string              `gorm:"type:uuid;not null;index"`
	SenderID    string              `gorm:"type:uuid;not null;index"`
	ReplyToID   *string             `gorm:"type:uuid;index"`
	Body        string              `gorm:"type:text;not null"`
	ReadAt      *time.Time          `gorm:"type:timestamptz"`
	CreatedAt   time.Time           `gorm:"not null;default:now()"`
	Attachments []MessageAttachment `gorm:"-"`
}
