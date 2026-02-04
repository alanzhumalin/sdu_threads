package repository

import (
	"context"
	"strings"

	"gorm.io/gorm"
	"sduthreads/internal/models"
)

type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(ctx context.Context, user *models.User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	var u models.User
	if err := r.db.WithContext(ctx).First(&u, "email = ?", email).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByUsername(ctx context.Context, username string) (*models.User, error) {
	var u models.User
	if err := r.db.WithContext(ctx).First(&u, "username = ?", username).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (*models.User, error) {
	var u models.User
	if err := r.db.WithContext(ctx).First(&u, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) Search(ctx context.Context, q string, limit, offset int) ([]models.User, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var users []models.User
	err := r.db.WithContext(ctx).
		Where("username ILIKE ? OR full_name ILIKE ?", "%"+q+"%", "%"+q+"%").
		Order("username ASC").
		Limit(limit).Offset(offset).
		Find(&users).Error
	return users, err
}

func (r *UserRepository) UpdateProfile(ctx context.Context, id string, fields map[string]interface{}) error {
	if len(fields) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Model(&models.User{}).
		Where("id = ?", id).
		Updates(fields).Error
}

// ExistingUsernames returns a set of usernames that exist in DB (case-insensitive exact match).
func (r *UserRepository) ExistingUsernames(ctx context.Context, usernames []string) (map[string]struct{}, error) {
	result := make(map[string]struct{})
	if len(usernames) == 0 {
		return result, nil
	}
	unique := make([]string, 0, len(usernames))
	seen := make(map[string]struct{})
	for _, u := range usernames {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		u = strings.ToLower(u)
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		unique = append(unique, u)
	}
	if len(unique) == 0 {
		return result, nil
	}
	var rows []string
	if err := r.db.WithContext(ctx).
		Model(&models.User{}).
		Select("username").
		Where("LOWER(username) IN ?", unique).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, u := range rows {
		result[strings.ToLower(u)] = struct{}{}
	}
	return result, nil
}
