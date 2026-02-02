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
