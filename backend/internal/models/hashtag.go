package models

type Hashtag struct {
	ID   string `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Name string `gorm:"uniqueIndex;not null"`
}

type PostHashtag struct {
	ID        string `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	PostID    string `gorm:"type:uuid;not null;index"`
	HashtagID string `gorm:"type:uuid;not null;index"`
}
