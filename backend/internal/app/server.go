package app

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"sduthreads/internal/auth"
	"sduthreads/internal/cache"
	"sduthreads/internal/config"
	"sduthreads/internal/db"
	"sduthreads/internal/handler"
	modsvc "sduthreads/internal/moderation"
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
		Endpoint:         cfg.S3Endpoint,
		Region:           cfg.S3Region,
		Bucket:           cfg.S3Bucket,
		AccessKey:        cfg.S3AccessKey,
		SecretKey:        cfg.S3SecretKey,
		UseSSL:           cfg.S3UseSSL,
		PublicBaseURL:    cfg.S3PublicBaseURL,
		Prefix:           cfg.S3Prefix,
		SignatureVersion: cfg.S3SignatureVersion,
	}); err == nil {
		uploader = u
	}

	// repositories
	userRepo := repository.NewUserRepository(client.DB)
	postRepo := repository.NewPostRepository(client.DB)
	likeRepo := repository.NewLikeRepository(client.DB)
	reactionRepo := repository.NewReactionRepository(client.DB)
	commentRepo := repository.NewCommentRepository(client.DB)
	followRepo := repository.NewFollowRepository(client.DB)
	tagRepo := repository.NewHashtagRepository(client.DB)
	reportRepo := repository.NewReportRepository(client.DB)
	chatRepo := repository.NewChatRepository(client.DB)
	liveRoomRepo := repository.NewLiveRoomRepository(client.DB)
	storyRepo := repository.NewStoryRepository(client.DB)
	giftRepo := repository.NewGiftRepository(client.DB)
	telegramRepo := repository.NewTelegramRepository(client.DB)
	moderationEventRepo := repository.NewModerationEventRepository(client.DB)
	viewService := service.NewViewService(postRepo, cfg.ViewTTLMin)
	moderationClient := modsvc.NewClient(modsvc.Config{
		Enabled:    cfg.ModerationEnabled,
		BaseURL:    cfg.ModerationURL,
		Timeout:    time.Duration(cfg.ModerationTimeout) * time.Millisecond,
		FailClosed: cfg.ModerationFailClosed,
		RecordEvent: func(ctx context.Context, event modsvc.Event) {
			if err := moderationEventRepo.CreateFromEvent(ctx, event); err != nil {
				log.Printf("moderation event write failed: %v", err)
			}
		},
	})

	var queryCache *cache.QueryCache
	if cfg.CacheEnabled {
		l1 := cache.NewMemoryStore(cfg.CacheL1MaxEntries, time.Duration(cfg.CacheL1CleanupSec)*time.Second)
		var store cache.Store = l1
		if addr := strings.TrimSpace(cfg.CacheRedisAddr); addr != "" {
			redisStore, err := cache.NewRedisStore(cache.RedisConfig{
				Addr:         addr,
				Password:     cfg.CacheRedisPassword,
				DB:           cfg.CacheRedisDB,
				KeyPrefix:    cfg.CacheKeyPrefix,
				DialTimeout:  500 * time.Millisecond,
				ReadTimeout:  500 * time.Millisecond,
				WriteTimeout: 500 * time.Millisecond,
			})
			if err != nil {
				log.Printf("cache redis unavailable, falling back to memory-only cache: %v", err)
			} else {
				store = cache.NewHybridStore(l1, redisStore)
			}
		}
		queryCache = cache.NewQueryCache(true, store)
	} else {
		queryCache = cache.NewQueryCache(false, nil)
	}

	// services
	userService := service.NewUserService(userRepo)
	postService := service.NewPostService(postRepo, likeRepo, reactionRepo, tagRepo, userRepo, followRepo, uploader, moderationClient)
	authService := service.NewAuthService(userRepo, jwtMgr, moderationClient)
	commentService := service.NewCommentService(commentRepo, postRepo, likeRepo, userRepo, tagRepo, moderationClient)
	followService := service.NewFollowService(followRepo, userRepo)
	profileService := service.NewProfileService(userRepo, followRepo, moderationClient)
	hashtagService := service.NewHashtagService(tagRepo, postRepo, userRepo, followRepo)
	notificationService := service.NewNotificationService(client.DB, userRepo)
	reportService := service.NewReportService(reportRepo, userRepo, postRepo)
	chatService := service.NewChatService(chatRepo, userRepo, reactionRepo)
	liveRoomService := service.NewLiveRoomService(liveRoomRepo, userRepo)
	storyService := service.NewStoryService(storyRepo, userRepo, uploader)
	giftService := service.NewGiftService(giftRepo, uploader)
	telegramService := service.NewTelegramService(cfg, telegramRepo)
	searchHandler := handler.NewSearchHandler(userRepo, queryCache)
	topUsersHandler := handler.NewTopUsersHandler(followService, queryCache)
	reportHandler := handler.NewReportHandler(reportService, jwtMgr)
	mediaHandler := handler.NewMediaHandler(uploader, jwtMgr, moderationClient)
	chatHandler := handler.NewChatHandler(chatService, telegramService, jwtMgr)
	liveRoomHandler := handler.NewLiveRoomHandler(liveRoomService, jwtMgr)
	storyHandler := handler.NewStoryHandler(storyService, jwtMgr)
	giftHandler := handler.NewGiftHandler(giftService, uploader, moderationClient)
	telegramHandler := handler.NewTelegramHandler(telegramService, jwtMgr)
	adminHandler := handler.NewAdminHandler(client.DB, userRepo, postRepo, profileService, postService, jwtMgr)
	moderationHandler := handler.NewModerationHandler(userRepo, postRepo, postService, reportService, moderationEventRepo, jwtMgr)

	if err := service.EnsureAdminUser(context.Background(), userRepo, cfg.AdminEmail, cfg.AdminPassword, cfg.AdminUsername, cfg.AdminFullName); err != nil {
		log.Printf("admin bootstrap: %v", err)
	}

	// handlers
	handler.NewHealthHandler().Register(mux)
	handler.NewAuthHandler(authService, queryCache).Register(mux)
	handler.NewUserHandler(userService).Register(mux)
	handler.NewPostHandler(postService, viewService, telegramService, jwtMgr, queryCache).Register(mux)
	handler.NewCommentHandler(commentService, telegramService, jwtMgr, queryCache).Register(mux)
	handler.NewFollowHandler(followService, profileService, postService, telegramService, jwtMgr, queryCache).Register(mux)
	handler.NewHashtagHandler(hashtagService, jwtMgr, queryCache).Register(mux)
	handler.NewNotificationHandler(notificationService, jwtMgr).Register(mux)
	searchHandler.Register(mux)
	topUsersHandler.Register(mux)
	reportHandler.Register(mux)
	mediaHandler.Register(mux)
	chatHandler.Register(mux)
	liveRoomHandler.Register(mux)
	storyHandler.Register(mux)
	giftHandler.Register(mux)
	telegramHandler.Register(mux)
	// Translation is temporarily disabled.
	adminHandler.Register(mux)
	moderationHandler.Register(mux)

	telegramService.StartBackground()

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
