package service

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"sduthreads/internal/models"
	"sduthreads/internal/repository"

	"gorm.io/gorm"
)

type UserService struct {
	users *repository.UserRepository
}

var sduEmailRe = regexp.MustCompile(`^[0-9]{9}@sdu\.edu\.kz$`)

func NewUserService(users *repository.UserRepository) *UserService {
	return &UserService{users: users}
}

var (
	ErrEmailTaken    = errors.New("email already registered")
	ErrUsernameTaken = errors.New("username already taken")
)

var usernameRe = regexp.MustCompile(`^[a-z0-9_.]{3,32}$`)

func (s *UserService) Create(ctx context.Context, input models.User) (*models.User, error) {
	input.Email = strings.TrimSpace(strings.ToLower(input.Email))
	input.Username = strings.TrimSpace(strings.ToLower(input.Username))
	input.FullName = strings.TrimSpace(input.FullName)
	if strings.TrimSpace(input.Role) == "" {
		input.Role = "user"
	}

	if input.Email == "" || input.Username == "" || input.FullName == "" {
		return nil, errors.New("email, username and full_name are required")
	}

	if !sduEmailRe.MatchString(input.Email) {
		return nil, errors.New("email must be institutional @sdu.edu.kz")
	}

	if !usernameRe.MatchString(input.Username) {
		return nil, errors.New("username must be 3-32 chars [a-z0-9_.]")
	}
	if len(input.FullName) > 80 {
		return nil, errors.New("full_name too long (max 80)")
	}

	// uniqueness checks
	if _, err := s.users.GetByEmail(ctx, input.Email); err == nil {
		return nil, ErrEmailTaken
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if _, err := s.users.GetByUsername(ctx, input.Username); err == nil {
		return nil, ErrUsernameTaken
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if err := s.users.Create(ctx, &input); err != nil {
		return nil, err
	}
	return &input, nil
}

func (s *UserService) GetByID(ctx context.Context, id string) (*models.User, error) {
	id = strings.TrimSpace(id)
	return s.users.GetByID(ctx, id)
}

func (s *UserService) GetByUsername(ctx context.Context, username string) (*models.User, error) {
	username = strings.TrimSpace(strings.ToLower(username))
	return s.users.GetByUsername(ctx, username)
}
