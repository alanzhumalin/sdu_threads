package models

import "time"

type Chat struct {
	ID        string    `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Kind      string    `gorm:"not null;default:direct"`
	DirectKey *string   `gorm:"uniqueIndex"`
	CreatedAt time.Time `gorm:"not null;default:now()"`
	UpdatedAt time.Time `gorm:"not null;default:now()"`
}
