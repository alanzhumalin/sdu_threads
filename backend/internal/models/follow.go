package models

import "time"

type Follow struct {
	ID         string    `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	FollowerID string    `gorm:"type:uuid;not null;index"`
	FolloweeID string    `gorm:"type:uuid;not null;index"`
	CreatedAt  time.Time `gorm:"not null;default:now()"`
}
