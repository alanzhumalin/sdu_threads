package service

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"
	"sduthreads/internal/repository"
)

type ReportService struct {
	reports *repository.ReportRepository
	users   *repository.UserRepository
	posts   *repository.PostRepository
}

func NewReportService(reports *repository.ReportRepository, users *repository.UserRepository, posts *repository.PostRepository) *ReportService {
	return &ReportService{reports: reports, users: users, posts: posts}
}

func (s *ReportService) Create(ctx context.Context, reporterID string, targetType string, targetID string, reason string, details string) (string, error) {
	targetType = strings.TrimSpace(strings.ToLower(targetType))
	targetID = strings.TrimSpace(targetID)
	reason = strings.TrimSpace(reason)
	details = strings.TrimSpace(details)

	if reporterID == "" {
		return "", errors.New("reporter_id is required")
	}
	if targetID == "" {
		return "", errors.New("target_id is required")
	}
	if reason == "" {
		return "", errors.New("reason is required")
	}

	var postID any
	var userID any

	switch targetType {
	case "post":
		// ensure post exists to avoid storing junk IDs
		if s.posts != nil {
			ok, err := s.posts.Exists(ctx, targetID)
			if err != nil {
				return "", err
			}
			if !ok {
				return "", gorm.ErrRecordNotFound
			}
		}
		postID = targetID
		userID = nil
	case "user":
		if s.users != nil {
			if _, err := s.users.GetByID(ctx, targetID); err != nil {
				return "", err
			}
		}
		postID = nil
		userID = targetID
	default:
		return "", errors.New("invalid target_type")
	}

	return s.reports.Create(ctx, reporterID, postID, userID, reason, details)
}
