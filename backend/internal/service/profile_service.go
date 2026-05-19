package service

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/moderation"
	"sduthreads/internal/repository"

	"golang.org/x/crypto/bcrypt"
)

type ProfileService struct {
	users   *repository.UserRepository
	follows *repository.FollowRepository
	mod     *moderation.Client
}

var (
	ErrCurrentPasswordInvalid = errors.New("current password is invalid")
	ErrNewPasswordTooShort    = errors.New("password must be at least 8 characters")
	ErrNewPasswordSameAsOld   = errors.New("new password must be different from current password")
)

func NewProfileService(users *repository.UserRepository, follows *repository.FollowRepository, mod *moderation.Client) *ProfileService {
	return &ProfileService{users: users, follows: follows, mod: mod}
}

type Profile struct {
	ID            string            `json:"id"`
	Username      string            `json:"username"`
	FullName      string            `json:"full_name"`
	IsVerified    bool              `json:"is_verified"`
	Bio           string            `json:"bio"`
	AvatarURL     string            `json:"avatar_url"`
	BackgroundURL string            `json:"background_url"`
	SocialLinks   map[string]string `json:"social_links,omitempty"`
	Followers     int64             `json:"followers"`
	Following     int64             `json:"following"`
	CreatedAt     string            `json:"created_at"`
	IsMe          bool              `json:"is_me"`
	IsSubscribed  bool              `json:"is_subscribed"`
}

func validateSocialLinks(in map[string]string) (models.SocialLinks, error) {
	allowed := map[string]struct{}{
		"instagram": {},
		"telegram":  {},
		"github":    {},
		"linkedin":  {},
	}

	label := func(kind string) string {
		switch kind {
		case "instagram":
			return "Instagram"
		case "telegram":
			return "Telegram"
		case "github":
			return "GitHub"
		case "linkedin":
			return "LinkedIn"
		default:
			return kind
		}
	}

	allowedDomainHint := func(kind string) string {
		switch kind {
		case "instagram":
			return "instagram.com"
		case "telegram":
			return "t.me"
		case "github":
			return "github.com"
		case "linkedin":
			return "www.linkedin.com"
		default:
			return ""
		}
	}

	hostOk := func(kind, host string) bool {
		h := strings.ToLower(strings.TrimSpace(host))
		switch kind {
		case "instagram":
			return h == "instagram.com" || h == "www.instagram.com"
		case "telegram":
			return h == "t.me" || h == "telegram.me"
		case "github":
			return h == "github.com" || h == "www.github.com"
		case "linkedin":
			// LinkedIn: require www to match frontend UX.
			return h == "www.linkedin.com"
		default:
			return false
		}
	}

	out := make(map[string]string)
	for k, raw := range in {
		kind := strings.ToLower(strings.TrimSpace(k))
		if kind == "" {
			continue
		}
		if _, ok := allowed[kind]; !ok {
			return nil, fmt.Errorf("Некорректный тип соцсети")
		}
		raw = strings.TrimSpace(raw)
		if raw == "" {
			// treat empty as "remove"
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return nil, fmt.Errorf("Неверный URL для %s", label(kind))
		}
		if strings.ToLower(u.Scheme) != "https" {
			return nil, fmt.Errorf("%s: ссылка должна начинаться с https://", label(kind))
		}
		if !hostOk(kind, u.Host) {
			hint := allowedDomainHint(kind)
			if hint != "" {
				return nil, fmt.Errorf("%s: ссылка должна вести на %s", label(kind), hint)
			}
			return nil, fmt.Errorf("Неверная ссылка для %s", label(kind))
		}
		out[kind] = raw
	}

	if len(out) > 4 {
		return nil, fmt.Errorf("Можно добавить максимум 4 соцсети")
	}
	if len(out) == 0 {
		return nil, nil
	}
	return models.SocialLinks(out), nil
}

func (s *ProfileService) Get(ctx context.Context, userID string, viewerID *string) (*Profile, error) {
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
	isMe := viewerID != nil && *viewerID == userID
	isSubscribed := false
	if viewerID != nil && !isMe {
		if ok, err := s.follows.IsFollowing(ctx, *viewerID, userID); err == nil {
			isSubscribed = ok
		}
	}

	var social map[string]string
	if u.SocialLinks != nil && len(u.SocialLinks) > 0 {
		social = map[string]string(u.SocialLinks)
	}
	return &Profile{
		ID:            u.ID,
		Username:      u.Username,
		FullName:      u.FullName,
		IsVerified:    u.IsVerified,
		Bio:           u.Bio,
		AvatarURL:     u.AvatarURL,
		BackgroundURL: u.BackgroundURL,
		SocialLinks:   social,
		Followers:     followers,
		Following:     following,
		CreatedAt:     u.CreatedAt.Format(time.RFC3339),
		IsMe:          isMe,
		IsSubscribed:  isSubscribed,
	}, nil
}

func (s *ProfileService) Update(ctx context.Context, userID string, req dto.UpdateProfileRequest) (*Profile, error) {
	fields := map[string]interface{}{}
	if req.FullName != nil {
		fields["full_name"] = strings.TrimSpace(*req.FullName)
	}
	if req.Bio != nil {
		fields["bio"] = strings.TrimSpace(*req.Bio)
	}
	if req.AvatarURL != nil {
		avatar := strings.TrimSpace(*req.AvatarURL)
		fields["avatar_url"] = avatar
	}
	if req.BackgroundURL != nil {
		background := strings.TrimSpace(*req.BackgroundURL)
		fields["background_url"] = background
	}
	if req.SocialLinks != nil {
		links, err := validateSocialLinks(*req.SocialLinks)
		if err != nil {
			return nil, err
		}
		fields["social_links"] = links
	}

	if err := s.users.UpdateProfile(ctx, userID, fields); err != nil {
		return nil, err
	}

	return s.Get(ctx, userID, &userID)
}

func (s *ProfileService) GetByUsername(ctx context.Context, username string, viewerID *string) (*Profile, error) {
	u, err := s.users.GetByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, u.ID, viewerID)
}

func (s *ProfileService) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	currentPassword = strings.TrimSpace(currentPassword)
	if currentPassword == "" {
		return ErrCurrentPasswordInvalid
	}
	if len(newPassword) < 8 {
		return ErrNewPasswordTooShort
	}

	u, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(currentPassword)); err != nil {
		return ErrCurrentPasswordInvalid
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(newPassword)); err == nil {
		return ErrNewPasswordSameAsOld
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.users.UpdatePasswordHash(ctx, userID, string(hash))
}
