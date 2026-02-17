package models

import "time"

type TelegramLinkCode struct {
	ID        string    `gorm:"column:id;type:uuid;default:uuid_generate_v4();primaryKey"`
	Code      string    `gorm:"column:code;not null;uniqueIndex"`
	UserID    string    `gorm:"column:user_id;type:uuid;not null;uniqueIndex"`
	ExpiresAt time.Time `gorm:"column:expires_at;not null"`
	CreatedAt time.Time `gorm:"column:created_at;not null;default:now()"`
}

func (TelegramLinkCode) TableName() string {
	return "telegram_link_codes"
}
