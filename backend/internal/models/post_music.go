package models

import "time"

// PostMusic stores optional music metadata attached to a post.
// One post can have at most one music attachment.
type PostMusic struct {
	ID           string    `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	PostID       string    `gorm:"type:uuid;not null;uniqueIndex"`
	Source       string    `gorm:"type:text;not null;default:upload"`
	TrackID      string    `gorm:"type:text;not null;default:''"`
	Title        string    `gorm:"type:text;not null;default:''"`
	Artist       string    `gorm:"type:text;not null;default:''"`
	CoverURL     string    `gorm:"type:text;not null;default:''"`
	AudioURL     string    `gorm:"type:text;not null"`
	DurationSec  int       `gorm:"column:duration_sec;not null;default:0"`
	ClipStartSec int       `gorm:"column:clip_start_sec;not null;default:0"`
	ClipEndSec   int       `gorm:"column:clip_end_sec;not null;default:0"`
	CreatedAt    time.Time `gorm:"not null;default:now()"`
	UpdatedAt    time.Time `gorm:"not null;default:now()"`
}

func (PostMusic) TableName() string {
	return "post_music"
}
