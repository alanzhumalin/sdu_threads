package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// helper to create fresh in-memory db per test
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dbName := fmt.Sprintf("file:repo_test_%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dbName), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return db
}

func TestCommentRepositoryLikedByMe(t *testing.T) {
	db := newTestDB(t)
	// schema
	// seed
	db.Exec(`CREATE TABLE users (id text primary key, username text, full_name text, email text, password_hash text, created_at text, updated_at text)`)
	db.Exec(`CREATE TABLE posts (id text primary key, user_id text, content text, media_url text, view_count integer default 0, created_at text, updated_at text)`)
	db.Exec(`CREATE TABLE comments (id text primary key, post_id text, user_id text, body text, reply_to_comment_id text, created_at text, updated_at text)`)
	db.Exec(`CREATE TABLE comment_likes (id text primary key, comment_id text, user_id text)`)
	db.Exec(`INSERT INTO users (id, username, full_name, email, password_hash) VALUES ('u1','u1','U One','1@sdu.edu.kz','x')`)
	db.Exec(`INSERT INTO posts (id, user_id, content) VALUES ('p1','u1','hello')`)
	db.Exec(`INSERT INTO comments (id, post_id, user_id, body) VALUES ('c1','p1','u1','c1')`)
	db.Exec(`INSERT INTO comment_likes (comment_id, user_id) VALUES ('c1','u1')`)

	repo := NewCommentRepository(db)
	items, err := repo.ListByPost(context.Background(), "p1", 10, 0, "u1")
	if err != nil {
		t.Fatalf("ListByPost: %v", err)
	}
	if len(items) != 1 || !items[0].LikedByMe {
		t.Fatalf("expected liked_by_me=true, got %+v", items)
	}
}

func TestFollowRepositoryCounts(t *testing.T) {
	db := newTestDB(t)
	fRepo := NewFollowRepository(db)
	db.Exec(`CREATE TABLE follows (id text primary key, follower_id text, followee_id text, created_at text)`)

	if err := fRepo.Follow(context.Background(), "u1", "u2"); err != nil {
		t.Fatalf("follow: %v", err)
	}
	c, err := fRepo.FollowersCount(context.Background(), "u2")
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if c != 1 {
		t.Fatalf("expected 1 follower, got %d", c)
	}
}

func TestHashtagRepositoryByPost(t *testing.T) {
	db := newTestDB(t)
	db.Exec(`CREATE TABLE users (id text primary key, username text, full_name text, email text, password_hash text)`)
	db.Exec(`CREATE TABLE posts (id text primary key, user_id text, content text, media_url text, view_count integer default 0, created_at text, updated_at text)`)
	db.Exec(`CREATE TABLE comments (id text primary key, post_id text, user_id text, body text, reply_to_comment_id text, created_at text, updated_at text)`)
	db.Exec(`CREATE TABLE hashtags (id text primary key, name text unique)`)
	db.Exec(`CREATE TABLE post_hashtags (id text primary key, post_id text, hashtag_id text)`)
	db.Exec(`CREATE TABLE likes (id text primary key, post_id text, user_id text)`)
	db.Exec(`INSERT INTO users (id, username, full_name, email, password_hash) VALUES ('u1','u1','U One','1@sdu.edu.kz','x')`)
	db.Exec(`INSERT INTO posts (id, user_id, content) VALUES ('p1','u1','hello')`)
	db.Exec(`INSERT INTO hashtags (id, name) VALUES ('h1','sdu')`)
	db.Exec(`INSERT INTO post_hashtags (post_id, hashtag_id) VALUES ('p1','h1')`)
	db.Exec(`INSERT INTO likes (post_id, user_id) VALUES ('p1','u1')`)

	postRepo := NewPostRepository(db)
	items, err := postRepo.ByHashtag(context.Background(), "sdu", 10, 0, nil)
	if err != nil {
		t.Fatalf("ByHashtag: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].LikeCount != 1 {
		t.Fatalf("expected like count 1, got %d", items[0].LikeCount)
	}
}
