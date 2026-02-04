package app

import (
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

	// repositories
	userRepo := repository.NewUserRepository(client.DB)
	postRepo := repository.NewPostRepository(client.DB)
	likeRepo := repository.NewLikeRepository(client.DB)
	commentRepo := repository.NewCommentRepository(client.DB)
	followRepo := repository.NewFollowRepository(client.DB)
	tagRepo := repository.NewHashtagRepository(client.DB)
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
	searchHandler := handler.NewSearchHandler(userRepo)
	topUsersHandler := handler.NewTopUsersHandler(followService)

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
