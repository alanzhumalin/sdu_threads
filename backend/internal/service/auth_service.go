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

var ErrInvalidCredentials = errors.New("invalid credentials")

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

func (s *AuthService) Login(ctx context.Context, login, password string) (string, error) {
	login = strings.TrimSpace(strings.ToLower(login))
	var user *models.User
	var u *models.User
	var err error
	if strings.Contains(login, "@") {
		u, err = s.users.GetByEmail(ctx, login)
	} else {
		u, err = s.users.GetByUsername(ctx, login)
	}
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
