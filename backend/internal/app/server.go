package app

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"sduthreads/internal/auth"
	"sduthreads/internal/config"
	"sduthreads/internal/db"
	"sduthreads/internal/handler"
	"sduthreads/internal/repository"
	"sduthreads/internal/service"
	"sduthreads/internal/storage"
	"sduthreads/middleware"
)

type Server struct {
	cfg config.Config
	db  *db.Client
	h   http.Handler
}

func NewServer(cfg config.Config, client *db.Client) *Server {
	mux := http.NewServeMux()

	// jwt
	jwtMgr := auth.NewJWTManager(cfg.JWTSecret, cfg.JWTTTLHours)

	// media storage (optional; server must still start if not configured)
	var uploader *storage.S3Uploader
	if u, err := storage.NewS3Uploader(storage.S3Config{
		Endpoint:      cfg.S3Endpoint,
		Region:        cfg.S3Region,
		Bucket:        cfg.S3Bucket,
		AccessKey:     cfg.S3AccessKey,
		SecretKey:     cfg.S3SecretKey,
		UseSSL:        cfg.S3UseSSL,
		PublicBaseURL: cfg.S3PublicBaseURL,
		Prefix:        cfg.S3Prefix,
		SignatureVersion: cfg.S3SignatureVersion,
	}); err == nil {
		uploader = u
	}

	// repositories
	userRepo := repository.NewUserRepository(client.DB)
	postRepo := repository.NewPostRepository(client.DB)
	likeRepo := repository.NewLikeRepository(client.DB)
	commentRepo := repository.NewCommentRepository(client.DB)
	followRepo := repository.NewFollowRepository(client.DB)
	tagRepo := repository.NewHashtagRepository(client.DB)
	reportRepo := repository.NewReportRepository(client.DB)
	viewService := service.NewViewService(postRepo, cfg.ViewTTLMin)

	// services
	userService := service.NewUserService(userRepo)
	postService := service.NewPostService(postRepo, likeRepo, tagRepo, userRepo, followRepo)
	authService := service.NewAuthService(userRepo, jwtMgr)
	commentService := service.NewCommentService(commentRepo, postRepo, likeRepo, userRepo, tagRepo)
	followService := service.NewFollowService(followRepo, userRepo)
	profileService := service.NewProfileService(userRepo, followRepo)
	hashtagService := service.NewHashtagService(tagRepo, postRepo, userRepo, followRepo)
	notificationService := service.NewNotificationService(client.DB, userRepo)
	reportService := service.NewReportService(reportRepo, userRepo, postRepo)
	searchHandler := handler.NewSearchHandler(userRepo)
	topUsersHandler := handler.NewTopUsersHandler(followService)
	reportHandler := handler.NewReportHandler(reportService, jwtMgr)
	mediaHandler := handler.NewMediaHandler(uploader, jwtMgr)
	adminHandler := handler.NewAdminHandler(client.DB, userRepo, postRepo, profileService, postService, jwtMgr)
	moderationHandler := handler.NewModerationHandler(userRepo, postRepo, postService, reportService, jwtMgr)

	if err := service.EnsureAdminUser(context.Background(), userRepo, cfg.AdminEmail, cfg.AdminPassword, cfg.AdminUsername, cfg.AdminFullName); err != nil {
		log.Printf("admin bootstrap: %v", err)
	}

	// handlers
	handler.NewHealthHandler().Register(mux)
	handler.NewAuthHandler(authService).Register(mux)
	handler.NewUserHandler(userService).Register(mux)
	handler.NewPostHandler(postService, viewService, jwtMgr).Register(mux)
	handler.NewCommentHandler(commentService, jwtMgr).Register(mux)
	handler.NewFollowHandler(followService, profileService, postService, jwtMgr).Register(mux)
	handler.NewHashtagHandler(hashtagService, jwtMgr).Register(mux)
	handler.NewNotificationHandler(notificationService, jwtMgr).Register(mux)
	searchHandler.Register(mux)
	topUsersHandler.Register(mux)
	reportHandler.Register(mux)
	mediaHandler.Register(mux)
	adminHandler.Register(mux)
	moderationHandler.Register(mux)

	// path-aware rate limiting: stricter for auth endpoints
	pathLimiter := middleware.NewPathRateLimiter(cfg.RateLimitRPM, map[string]int{
		"/api/auth/register": 10,
		"/api/auth/login":    60,
	})

	handlerWithMw := middleware.Logging(pathLimiter.Middleware(middleware.Recover(mux)))

	return &Server{
		cfg: cfg,
		db:  client,
		h:   handlerWithMw,
	}
}

func (s *Server) Start() error {
	addr := fmt.Sprintf(":%s", s.cfg.AppPort)
	srv := &http.Server{
		Addr:              addr,
		Handler:           s.h,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("backend started on %s (env=%s)", addr, s.cfg.AppEnv)
	return srv.ListenAndServe()
}
