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
		Model(&models.User{}).
		Select("id, username, full_name, is_verified, bio, avatar_url, background_url").
		Where("username ILIKE ? OR full_name ILIKE ?", "%"+q+"%", "%"+q+"%").
		Order("username ASC").
		Limit(limit).Offset(offset).
		Find(&users).Error
	return users, err
}

// SearchAdmin searches users by username/full_name and also by email/id (without returning email).
// Optionally excludes the bootstrap/root admin user from results.
func (r *UserRepository) SearchAdmin(ctx context.Context, q string, limit, offset int, excludeRoot bool) ([]models.User, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	q = strings.TrimSpace(q)
	var users []models.User

	db := r.db.WithContext(ctx).Model(&models.User{})
	if excludeRoot {
		db = db.Where("is_root_admin = false")
	}
	if q == "" {
		err := db.Order("created_at DESC").Limit(limit).Offset(offset).Find(&users).Error
		return users, err
	}

	like := "%" + q + "%"
	// Avoid invalid UUID cast errors by checking shape before using id equality.
	isUUIDish := len(q) == 36 && strings.Count(q, "-") == 4
	if isUUIDish {
		db = db.Where("id = ? OR username ILIKE ? OR full_name ILIKE ? OR email ILIKE ?", q, like, like, like)
	} else {
		db = db.Where("username ILIKE ? OR full_name ILIKE ? OR email ILIKE ?", like, like, like)
	}

	err := db.Order("created_at DESC").Limit(limit).Offset(offset).Find(&users).Error
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

func (r *UserRepository) UpdatePasswordHash(ctx context.Context, id string, hash string) error {
	return r.db.WithContext(ctx).
		Model(&models.User{}).
		Where("id = ?", id).
		Update("password_hash", hash).Error
}

func (r *UserRepository) UpdateRole(ctx context.Context, id string, role string) error {
	role = strings.TrimSpace(strings.ToLower(role))
	if role == "" {
		return nil
	}
	return r.db.WithContext(ctx).
		Model(&models.User{}).
		Where("id = ?", id).
		Update("role", role).Error
}

func (r *UserRepository) UpdateVerified(ctx context.Context, id string, verified bool) error {
	return r.db.WithContext(ctx).
		Model(&models.User{}).
		Where("id = ?", id).
		Update("is_verified", verified).Error
}

func (r *UserRepository) SetRootAdmin(ctx context.Context, id string, isRoot bool) error {
	return r.db.WithContext(ctx).
		Model(&models.User{}).
		Where("id = ?", id).
		Update("is_root_admin", isRoot).Error
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
