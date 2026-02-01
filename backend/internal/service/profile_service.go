package service

import (
	"context"

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
	ID            uint64
	Email         string
	Username      string
	FullName      string
	Major         string
	AvatarURL     string
	BackgroundURL string
	Followers     int64
	Following     int64
}

func (s *ProfileService) Get(ctx context.Context, userID uint64) (*Profile, error) {
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
	}, nil
}
