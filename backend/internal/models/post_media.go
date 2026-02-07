package models

// PostMedia stores ordered media attachments for a post.
// We keep posts.media_url as a legacy "first media" for backward compatibility.
type PostMedia struct {
	ID        string `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	PostID    string `gorm:"type:uuid;not null;index"`
	URL       string `gorm:"type:text;not null"`
	Width     int    `gorm:"not null;default:0"`
	Height    int    `gorm:"not null;default:0"`
	SortOrder int    `gorm:"not null;default:0"`
}

func (PostMedia) TableName() string {
	return "post_media"
}
