package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"sduthreads/internal/auth"
	"sduthreads/internal/models"
	"sduthreads/internal/repository"
)

func newTestUserRepo(t *testing.T) *repository.UserRepository {
	t.Helper()
	dbName := fmt.Sprintf("file:user_test_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dbName), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	schema := `
CREATE TABLE users (
    id integer PRIMARY KEY AUTOINCREMENT,
    email text NOT NULL UNIQUE,
    username text NOT NULL UNIQUE,
    full_name text NOT NULL,
    is_verified boolean NOT NULL DEFAULT 0,
    password_hash text NOT NULL,
    temp_password_hash text,
    temp_password_expires_at datetime,
    role text NOT NULL DEFAULT 'user',
    is_root_admin boolean NOT NULL DEFAULT 0,
    bio text,
    avatar_url text,
    background_url text,
    social_links text,
    accepted_rules_at datetime,
    last_seen_at datetime,
    created_at datetime,
    updated_at datetime
);`
	if err := db.Exec(schema).Error; err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return repository.NewUserRepository(db)
}

// ---- tests ----
func TestUserServiceValidation(t *testing.T) {
	svc := NewUserService(newTestUserRepo(t))
	_, err := svc.Create(context.Background(), models.User{
		Email:    "bad@mail.com",
		Username: "okname",
		FullName: "Name",
	})
	if err == nil {
		t.Fatal("expected domain validation error")
	}

	_, err = svc.Create(context.Background(), models.User{
		Email:    "230107200@sdu.edu.kz",
		Username: "a",
		FullName: "Name",
	})
	if err == nil {
		t.Fatal("expected username length error")
	}
}

func TestAuthServiceRegisterLogin(t *testing.T) {
	repo := newTestUserRepo(t)
	jwtMgr := auth.NewJWTManager("secret", 24)
	authSvc := NewAuthService(repo, jwtMgr)

	_, err := authSvc.Register(context.Background(), models.User{
		Email:    "230107200@sdu.edu.kz",
		Username: "userone",
		FullName: "User One",
	}, "password1")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	token, err := authSvc.Login(context.Background(), "230107200@sdu.edu.kz", "password1")
	if err != nil || token == "" {
		t.Fatalf("login failed: %v", err)
	}
	// bcrypt stored
	u, _ := repo.GetByEmail(context.Background(), "230107200@sdu.edu.kz")
	if u == nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("password1")) != nil {
		t.Fatalf("password not hashed correctly")
	}
}

func TestAuthServiceLoginWithTempPassword(t *testing.T) {
	repo := newTestUserRepo(t)
	jwtMgr := auth.NewJWTManager("secret", 24)
	authSvc := NewAuthService(repo, jwtMgr)

	mainHash, err := bcrypt.GenerateFromPassword([]byte("password1"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("main hash: %v", err)
	}
	tempHash, err := bcrypt.GenerateFromPassword([]byte("TempPass123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("temp hash: %v", err)
	}
	expiresAt := time.Now().UTC().Add(15 * time.Minute)
	_, err = NewUserService(repo).Create(context.Background(), models.User{
		Email:                 "230107201@sdu.edu.kz",
		Username:              "usertwo",
		FullName:              "User Two",
		PasswordHash:          string(mainHash),
		TempPasswordHash:      string(tempHash),
		TempPasswordExpiresAt: &expiresAt,
	})
	if err != nil {
		t.Fatalf("create user failed: %v", err)
	}

	if _, err := authSvc.Login(context.Background(), "usertwo", "TempPass123"); err != nil {
		t.Fatalf("temp password login failed: %v", err)
	}
}
