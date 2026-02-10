package db

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Client struct {
	DB *gorm.DB
}

func Connect(databaseURL string) (*Client, error) {
	if databaseURL == "" {
		return nil, errors.New("DATABASE_URL is required")
	}

	// Keep SQL logs usable, but avoid noisy "record not found" spam (common for auth/search flows).
	gormLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	db, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{Logger: gormLogger})
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}

	return &Client{DB: db}, nil
}

func (c *Client) Migrate(dir string) error {
	if dir == "" {
		return errors.New("migrations directory is required")
	}

	if err := c.ensureSchemaTable(); err != nil {
		return err
	}

	files, err := migrationsToRun(dir, c)
	if err != nil {
		return err
	}

	for _, path := range files {
		sqlBytes, readErr := os.ReadFile(path)
		if readErr != nil {
			return fmt.Errorf("read migration %s: %w", path, readErr)
		}

		if err := c.DB.Exec(string(sqlBytes)).Error; err != nil {
			return fmt.Errorf("apply migration %s: %w", path, err)
		}

		if err := c.recordMigration(filepath.Base(path)); err != nil {
			return err
		}

		log.Printf("applied migration: %s", filepath.Base(path))
	}

	return nil
}

func (c *Client) ensureSchemaTable() error {
	const q = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`
	return c.DB.Exec(q).Error
}

func (c *Client) recordMigration(name string) error {
	const q = `INSERT INTO schema_migrations (name) VALUES (?) ON CONFLICT DO NOTHING;`
	return c.DB.Exec(q, name).Error
}

func migrationsToRun(dir string, c *Client) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir: %w", err)
	}

	var upFiles []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, "_up.sql") {
			upFiles = append(upFiles, filepath.Join(dir, name))
		}
	}

	sort.Strings(upFiles)

	var pending []string
	for _, f := range upFiles {
		var exists bool
		if err := c.DB.
			Raw(`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = ?)`, filepath.Base(f)).
			Scan(&exists).Error; err != nil {
			return nil, fmt.Errorf("check migration %s: %w", f, err)
		}
		if !exists {
			pending = append(pending, f)
		}
	}

	return pending, nil
}
