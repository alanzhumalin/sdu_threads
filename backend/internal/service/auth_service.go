package service

import (
	"context"
	"errors"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"sduthreads/internal/auth"
	"sduthreads/internal/models"
	"sduthreads/internal/repository"
)

type AuthService struct {
	users *repository.UserRepository
	jwt   *auth.JWTManager
}

var ErrInvalidCredentials = errors.New("invalid email or password")

func NewAuthService(users *repository.UserRepository, jwt *auth.JWTManager) *AuthService {
	return &AuthService{users: users, jwt: jwt}
}

func (s *AuthService) Register(ctx context.Context, input models.User, password string) (string, error) {
	if len(password) < 8 {
		return "", errors.New("password must be at least 8 characters")
	}

	// reuse user creation logic for validation/uniqueness
	user, err := NewUserService(s.users).Create(ctx, inputWithPassword(input, password))
	if err != nil {
		return "", err
	}

	return s.jwt.Generate(user.ID)
}

func (s *AuthService) Login(ctx context.Context, email, password string) (string, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	var user *models.User
	u, err := s.users.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrInvalidCredentials
		}
		return "", err
	}
	user = u

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return "", ErrInvalidCredentials
	}
	return s.jwt.Generate(user.ID)
}

func inputWithPassword(u models.User, password string) models.User {
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	u.PasswordHash = string(hash)
	return u
}
