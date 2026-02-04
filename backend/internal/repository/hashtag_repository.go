package repository

import (
	"context"
	"strings"

	"gorm.io/gorm"
)

type HashtagRepository struct {
	db *gorm.DB
}

func NewHashtagRepository(db *gorm.DB) *HashtagRepository {
	return &HashtagRepository{db: db}
}

// Upsert returns ids for given hashtag names (lowercase), creating missing ones.
func (r *HashtagRepository) Upsert(ctx context.Context, names []string) (map[string]string, error) {
	res := make(map[string]string)
	if len(names) == 0 {
		return res, nil
	}

	tx := r.db.WithContext(ctx)
	for _, raw := range names {
		name := strings.ToLower(strings.TrimSpace(raw))
		if name == "" {
			continue
		}
		var id string
		err := tx.Raw(`INSERT INTO hashtags (name) VALUES (?) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, name).Scan(&id).Error
		if err != nil {
			return nil, err
		}
		res[name] = id
	}
	return res, nil
}

func (r *HashtagRepository) AttachToPost(ctx context.Context, postID string, hashtagIDs map[string]string) error {
	if len(hashtagIDs) == 0 {
		return nil
	}
	tx := r.db.WithContext(ctx)
	for _, id := range hashtagIDs {
		if err := tx.Exec(`INSERT INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, postID, id).Error; err != nil {
			return err
		}
	}
	return nil
}

type Hashtag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type PopularHashtag struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	PostCount int64  `json:"post_count"`
}

func (r *HashtagRepository) Search(ctx context.Context, q string, limit int) ([]Hashtag, error) {
	if limit <= 0 || limit > 20 {
		limit = 20
	}
	var res []Hashtag
	err := r.db.WithContext(ctx).
		Raw(`SELECT id, name FROM hashtags WHERE name ILIKE ? ORDER BY name ASC LIMIT ?`, "%"+q+"%", limit).
		Scan(&res).Error
	if res == nil {
		res = []Hashtag{}
	}
	return res, err
}

func (r *HashtagRepository) Popular(ctx context.Context, limit int) ([]PopularHashtag, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}
	var res []PopularHashtag
	err := r.db.WithContext(ctx).
		Raw(
			`SELECT h.id, h.name, COUNT(ph.post_id) AS post_count
			 FROM hashtags h
			 JOIN post_hashtags ph ON ph.hashtag_id = h.id
			 GROUP BY h.id, h.name
			 ORDER BY post_count DESC, h.name ASC
			 LIMIT ?`,
			limit,
		).
		Scan(&res).Error
	if res == nil {
		res = []PopularHashtag{}
	}
	return res, err
}

// ByPostIDs returns map postID -> []hashtagName (lowercase).
func (r *HashtagRepository) ByPostIDs(ctx context.Context, postIDs []string) (map[string][]string, error) {
	result := make(map[string][]string)
	if len(postIDs) == 0 {
		return result, nil
	}
	var rows []struct {
		PostID string
		Name   string
	}
	if err := r.db.WithContext(ctx).
		Raw(
			`SELECT ph.post_id, h.name
             FROM post_hashtags ph
             JOIN hashtags h ON h.id = ph.hashtag_id
             WHERE ph.post_id IN ?`,
			postIDs,
		).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, rrow := range rows {
		result[rrow.PostID] = append(result[rrow.PostID], rrow.Name)
	}
	return result, nil
}

// Existing returns set of existing hashtag names (lowercase) from provided list.
func (r *HashtagRepository) Existing(ctx context.Context, names []string) (map[string]struct{}, error) {
	result := make(map[string]struct{})
	if len(names) == 0 {
		return result, nil
	}
	unique := make([]string, 0, len(names))
	seen := make(map[string]struct{})
	for _, n := range names {
		n = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(n, "#")))
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		unique = append(unique, n)
	}
	if len(unique) == 0 {
		return result, nil
	}
	var rows []string
	if err := r.db.WithContext(ctx).
		Model(&Hashtag{}).
		Select("name").
		Where("name IN ?", unique).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, n := range rows {
		result[strings.ToLower(n)] = struct{}{}
	}
	return result, nil
}
