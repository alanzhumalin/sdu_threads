package models

import "time"

type Follow struct {
	ID         uint64    `gorm:"primaryKey"`
	FollowerID uint64    `gorm:"not null;index"`
	FolloweeID uint64    `gorm:"not null;index"`
	CreatedAt  time.Time `gorm:"not null;default:now()"`
}
