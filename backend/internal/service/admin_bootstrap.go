package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"sduthreads/internal/models"
	"sduthreads/internal/repository"
)

var allowedUsernameCharsRe = regexp.MustCompile(`[^a-z0-9_.]+`)

func sanitizeUsername(raw string) string {
	s := strings.TrimSpace(strings.ToLower(raw))
	if s == "" {
		return ""
	}
	// Replace unsupported chars with underscore.
	s = allowedUsernameCharsRe.ReplaceAllString(s, "_")
	s = strings.Trim(s, "._")
	if len(s) > 32 {
		s = s[:32]
		s = strings.TrimRight(s, "._")
	}
	if len(s) < 3 {
		return ""
	}
	return s
}

// EnsureAdminUser creates (or upgrades) an admin user on backend start.
// This is intentionally independent from normal registration validation rules.
func EnsureAdminUser(ctx context.Context, users *repository.UserRepository, email, password, username, fullName string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	password = strings.TrimSpace(password)

	// Admin bootstrap is optional.
	if email == "" && password == "" {
		return nil
	}
	if email == "" || password == "" {
		return errors.New("ADMIN_EMAIL and ADMIN_PASSWORD must be set together")
	}
	if len(password) < 8 {
		return errors.New("ADMIN_PASSWORD must be at least 8 characters")
	}

	if u, err := users.GetByEmail(ctx, email); err == nil {
		// Existing user: ensure role is admin.
		if strings.TrimSpace(strings.ToLower(u.Role)) != "admin" {
			if err := users.UpdateRole(ctx, u.ID, "admin"); err != nil {
				return err
			}
		}
		// Mark the bootstrap admin as root/protected.
		if !u.IsRootAdmin {
			if err := users.SetRootAdmin(ctx, u.ID, true); err != nil {
				return err
			}
		}
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	// New user: determine a unique username.
	if strings.TrimSpace(username) == "" {
		if at := strings.Index(email, "@"); at > 0 {
			username = email[:at]
		}
	}
	base := sanitizeUsername(username)
	if base == "" {
		base = "admin"
	}

	unique := ""
	for i := 0; i < 50; i++ {
		cand := base
		if i > 0 {
			suffix := fmt.Sprintf("%d", i+1)
			maxBase := 32 - len(suffix)
			if maxBase < 3 {
				maxBase = 3
			}
			b := base
			if len(b) > maxBase {
				b = b[:maxBase]
				b = strings.TrimRight(b, "._")
			}
			cand = b + suffix
		}
		if _, err := users.GetByUsername(ctx, cand); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				unique = cand
				break
			}
			return err
		}
	}
	if unique == "" {
		return errors.New("failed to generate a unique admin username")
	}

	if strings.TrimSpace(fullName) == "" {
		fullName = "Admin"
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	u := models.User{
		Email:           email,
		Username:        unique,
		FullName:        strings.TrimSpace(fullName),
		PasswordHash:    string(hash),
		Role:            "admin",
		IsRootAdmin:     true,
		AcceptedRulesAt: &now,
	}
	return users.Create(ctx, &u)
}
