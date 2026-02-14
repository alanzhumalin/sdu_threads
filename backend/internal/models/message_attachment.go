package models

import "time"

type MessageAttachment struct {
	ID        string    `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	MessageID string    `gorm:"type:uuid;not null;index"`
	URL       string    `gorm:"type:text;not null"`
	Width     int       `gorm:"not null;default:0"`
	Height    int       `gorm:"not null;default:0"`
	Type      string    `gorm:"type:text;not null;default:image"`
	SortOrder int       `gorm:"not null;default:0"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
}

func (MessageAttachment) TableName() string {
	return "message_attachments"
}
