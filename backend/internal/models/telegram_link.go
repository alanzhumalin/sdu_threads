package models

import "time"

type TelegramLink struct {
	UserID            string    `gorm:"column:user_id;type:uuid;primaryKey"`
	TelegramChatID    int64     `gorm:"column:telegram_chat_id;not null;uniqueIndex"`
	TelegramUserID    int64     `gorm:"column:telegram_user_id;not null;default:0"`
	TelegramUsername  string    `gorm:"column:telegram_username;not null;default:''"`
	TelegramFirstName string    `gorm:"column:telegram_first_name;not null;default:''"`
	Enabled           bool      `gorm:"column:enabled;not null;default:true"`
	CreatedAt         time.Time `gorm:"column:created_at;not null;default:now()"`
	UpdatedAt         time.Time `gorm:"column:updated_at;not null;default:now()"`
}

func (TelegramLink) TableName() string {
	return "telegram_links"
}
