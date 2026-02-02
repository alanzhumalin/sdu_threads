package service

import (
	"context"
	"time"

	"sduthreads/internal/repository"
)

type ProfileService struct {
	users   *repository.UserRepository
	follows *repository.FollowRepository
}

func NewProfileService(users *repository.UserRepository, follows *repository.FollowRepository) *ProfileService {
	return &ProfileService{users: users, follows: follows}
}

type Profile struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	Username      string `json:"username"`
	FullName      string `json:"full_name"`
	Major         string `json:"major"`
	AvatarURL     string `json:"avatar_url"`
	BackgroundURL string `json:"background_url"`
	Followers     int64  `json:"followers"`
	Following     int64  `json:"following"`
	CreatedAt     string `json:"created_at"`
}

func (s *ProfileService) Get(ctx context.Context, userID string) (*Profile, error) {
	u, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	followers, err := s.follows.FollowersCount(ctx, userID)
	if err != nil {
		return nil, err
	}
	following, err := s.follows.FollowingCount(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &Profile{
		ID:            u.ID,
		Email:         u.Email,
		Username:      u.Username,
		FullName:      u.FullName,
		Major:         u.Major,
		AvatarURL:     u.AvatarURL,
		BackgroundURL: u.BackgroundURL,
		Followers:     followers,
		Following:     following,
		CreatedAt:     u.CreatedAt.Format(time.RFC3339),
	}, nil
}
