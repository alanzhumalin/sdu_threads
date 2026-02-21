package service

import (
	"context"
	"errors"

	"sduthreads/internal/repository"
)

type FollowService struct {
	follows *repository.FollowRepository
	users   *repository.UserRepository
}

func NewFollowService(f *repository.FollowRepository, u *repository.UserRepository) *FollowService {
	return &FollowService{follows: f, users: u}
}

func (s *FollowService) Follow(ctx context.Context, followerID, followeeID string) (bool, error) {
	if followerID == "" || followeeID == "" {
		return false, errors.New("user ids required")
	}
	if followerID == followeeID {
		return false, errors.New("cannot follow yourself")
	}
	// ensure target exists
	if _, err := s.users.GetByID(ctx, followeeID); err != nil {
		return false, err
	}
	alreadyFollowing, err := s.follows.IsFollowing(ctx, followerID, followeeID)
	if err != nil {
		return false, err
	}
	if alreadyFollowing {
		return false, nil
	}
	if err := s.follows.Follow(ctx, followerID, followeeID); err != nil {
		return false, err
	}
	return true, nil
}

func (s *FollowService) Unfollow(ctx context.Context, followerID, followeeID string) error {
	if followerID == "" || followeeID == "" {
		return errors.New("user ids required")
	}
	return s.follows.Unfollow(ctx, followerID, followeeID)
}

func (s *FollowService) Followers(ctx context.Context, userID string, limit, offset int) ([]repository.FollowUser, error) {
	return s.follows.Followers(ctx, userID, limit, offset)
}

func (s *FollowService) Following(ctx context.Context, userID string, limit, offset int) ([]repository.FollowUser, error) {
	return s.follows.Following(ctx, userID, limit, offset)
}

func (s *FollowService) Counters(ctx context.Context, userID string) (followers, following int64, err error) {
	followers, err = s.follows.FollowersCount(ctx, userID)
	if err != nil {
		return
	}
	following, err = s.follows.FollowingCount(ctx, userID)
	return
}

func (s *FollowService) TopFollowed(ctx context.Context, limit int) ([]repository.TopUser, error) {
	return s.follows.TopFollowed(ctx, limit)
}
