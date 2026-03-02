package models

import "time"

type Post struct {
	ID             string  `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	UserID         string  `gorm:"type:uuid;not null;index"`
	QuotedPostID   *string `gorm:"type:uuid;index"`
	Content        string  `gorm:"type:text;not null"`
	ContainerColor string  `gorm:"type:text;not null;default:''"`
	MediaURL       string
	ViewCount      int64      `gorm:"not null;default:0"`
	RemovedAt      *time.Time `gorm:"type:timestamptz"`
	RemovedBy      *string    `gorm:"type:uuid"`
	RemovedReason  *string    `gorm:"type:text"`
	CreatedAt      time.Time  `gorm:"not null;default:now()"`
	UpdatedAt      time.Time  `gorm:"not null;default:now()"`
	User           User       `gorm:"foreignKey:UserID"`
}
