package config

import (
	"os"
	"strconv"
)

type Config struct {
	AppEnv       string
	AppPort      string
	DatabaseURL  string
	JWTSecret    string
	JWTTTLHours  int
	RateLimitRPM int
	ViewTTLMin   int

	// Bootstrap admin (created on backend start if not exists).
	AdminEmail    string
	AdminPassword string
	AdminUsername string
	AdminFullName string

	// S3-compatible media storage (MinIO/Ceph/Swift gateway).
	S3Endpoint      string
	S3Region        string
	S3Bucket        string
	S3AccessKey     string
	S3SecretKey     string
	S3UseSSL        bool
	S3PublicBaseURL string
	S3Prefix        string
	// v4 (default) or v2 for some Swift/Ceph gateways.
	S3SignatureVersion string

	// External moderation service (FastAPI).
	ModerationEnabled    bool
	ModerationURL        string
	ModerationTimeout    int
	ModerationFailClosed bool

	// Query cache (L1 in-memory + optional Redis L2).
	CacheEnabled       bool
	CacheRedisAddr     string
	CacheRedisPassword string
	CacheRedisDB       int
	CacheKeyPrefix     string
	CacheL1MaxEntries  int
	CacheL1CleanupSec  int
}

func Load() Config {
	return Config{
		AppEnv:       getEnv("APP_ENV", "development"),
		AppPort:      getEnv("APP_PORT", "8080"),
		DatabaseURL:  getEnv("DATABASE_URL", ""),
		JWTSecret:    getEnv("JWT_SECRET", "dev-secret"),
		JWTTTLHours:  getEnvInt("JWT_TTL_HOURS", 24),
		RateLimitRPM: getEnvInt("RATE_LIMIT_RPM", 120),
		ViewTTLMin:   getEnvInt("VIEW_TTL_MIN", 15),

		AdminEmail:    getEnv("ADMIN_EMAIL", ""),
		AdminPassword: getEnv("ADMIN_PASSWORD", ""),
		AdminUsername: getEnv("ADMIN_USERNAME", ""),
		AdminFullName: getEnv("ADMIN_FULL_NAME", ""),

		S3Endpoint:      getEnv("S3_ENDPOINT", ""),
		S3Region:        getEnv("S3_REGION", "us-east-1"),
		S3Bucket:        getEnv("S3_BUCKET", ""),
		S3AccessKey:     getEnv("S3_ACCESS_KEY", ""),
		S3SecretKey:     getEnv("S3_SECRET_KEY", ""),
		S3UseSSL:        getEnvBool("S3_USE_SSL", true),
		S3PublicBaseURL: getEnv("S3_PUBLIC_BASE_URL", ""),
		// Optional. Leave empty to avoid an extra path segment in object keys.
		S3Prefix:           getEnv("S3_PREFIX", ""),
		S3SignatureVersion: getEnv("S3_SIGNATURE_VERSION", "v4"),

		ModerationEnabled:    getEnvBool("MODERATION_ENABLED", false),
		ModerationURL:        getEnv("MODERATION_URL", ""),
		ModerationTimeout:    getEnvInt("MODERATION_TIMEOUT_MS", 4000),
		ModerationFailClosed: getEnvBool("MODERATION_FAIL_CLOSED", true),

		CacheEnabled:       getEnvBool("CACHE_ENABLED", true),
		CacheRedisAddr:     getEnv("CACHE_REDIS_ADDR", ""),
		CacheRedisPassword: getEnv("CACHE_REDIS_PASSWORD", ""),
		CacheRedisDB:       getEnvInt("CACHE_REDIS_DB", 0),
		CacheKeyPrefix:     getEnv("CACHE_KEY_PREFIX", "sdu:cache:"),
		CacheL1MaxEntries:  getEnvInt("CACHE_L1_MAX_ENTRIES", 5000),
		CacheL1CleanupSec:  getEnvInt("CACHE_L1_CLEANUP_SEC", 60),
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getEnvBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		switch v {
		case "1", "true", "TRUE", "yes", "YES", "y", "Y", "on", "ON":
			return true
		case "0", "false", "FALSE", "no", "NO", "n", "N", "off", "OFF":
			return false
		default:
			return def
		}
	}
	return def
}
