package models

type Hashtag struct {
	ID   uint64 `gorm:"primaryKey"`
	Name string `gorm:"uniqueIndex;not null"`
}

type PostHashtag struct {
	ID        uint64 `gorm:"primaryKey"`
	PostID    uint64 `gorm:"not null;index"`
	HashtagID uint64 `gorm:"not null;index"`
}
