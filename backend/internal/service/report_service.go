package service

import (
	"context"
	"errors"
	"strings"

	"gorm.io/gorm"
	"sduthreads/internal/dto"
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

func (s *ReportService) ListModeration(ctx context.Context, status, query string, limit, offset int) ([]dto.ModerationReportItem, error) {
	rows, err := s.reports.ListModeration(ctx, status, query, limit, offset)
	if err != nil {
		return nil, err
	}

	out := make([]dto.ModerationReportItem, 0, len(rows))
	for _, r := range rows {
		out = append(out, dto.ModerationReportItem{
			ID:                  r.ID,
			ReporterID:          r.ReporterID,
			ReporterUsername:    r.ReporterUsername,
			ReporterFullName:    r.ReporterFullName,
			ReporterAvatarURL:   r.ReporterAvatarURL,
			TargetType:          r.TargetType,
			PostID:              r.PostID,
			PostStatus:          r.PostStatus,
			PostContent:         r.PostContent,
			PostAuthorID:        r.PostAuthorID,
			PostAuthorUsername:  r.PostAuthorUsername,
			PostAuthorFullName:  r.PostAuthorFullName,
			PostAuthorAvatarURL: r.PostAuthorAvatarURL,
			PostRemovedAt:       r.PostRemovedAt,
			TargetUserID:        r.TargetUserID,
			TargetUsername:      r.TargetUsername,
			TargetFullName:      r.TargetFullName,
			TargetAvatarURL:     r.TargetAvatarURL,
			Reason:              r.Reason,
			Details:             r.Details,
			Status:              r.Status,
			CreatedAt:           r.CreatedAt,
			ResolvedBy:          r.ResolvedBy,
			ResolvedAt:          r.ResolvedAt,
			ResolutionNote:      r.ResolutionNote,
		})
	}
	return out, nil
}

func (s *ReportService) GetModeration(ctx context.Context, id string) (*dto.ModerationReportItem, error) {
	r, err := s.reports.GetModeration(ctx, id)
	if err != nil {
		return nil, err
	}
	out := &dto.ModerationReportItem{
		ID:                  r.ID,
		ReporterID:          r.ReporterID,
		ReporterUsername:    r.ReporterUsername,
		ReporterFullName:    r.ReporterFullName,
		ReporterAvatarURL:   r.ReporterAvatarURL,
		TargetType:          r.TargetType,
		PostID:              r.PostID,
		PostStatus:          r.PostStatus,
		PostContent:         r.PostContent,
		PostAuthorID:        r.PostAuthorID,
		PostAuthorUsername:  r.PostAuthorUsername,
		PostAuthorFullName:  r.PostAuthorFullName,
		PostAuthorAvatarURL: r.PostAuthorAvatarURL,
		PostRemovedAt:       r.PostRemovedAt,
		TargetUserID:        r.TargetUserID,
		TargetUsername:      r.TargetUsername,
		TargetFullName:      r.TargetFullName,
		TargetAvatarURL:     r.TargetAvatarURL,
		Reason:              r.Reason,
		Details:             r.Details,
		Status:              r.Status,
		CreatedAt:           r.CreatedAt,
		ResolvedBy:          r.ResolvedBy,
		ResolvedAt:          r.ResolvedAt,
		ResolutionNote:      r.ResolutionNote,
	}
	return out, nil
}

func (s *ReportService) ResolveModeration(ctx context.Context, reportID, resolverID, status, note string) error {
	return s.reports.Resolve(ctx, reportID, resolverID, status, note)
}
