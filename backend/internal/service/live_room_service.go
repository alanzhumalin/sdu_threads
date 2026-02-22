package service

import (
	"context"
	"errors"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"sduthreads/internal/repository"
)

var (
	ErrLiveRoomNotFound         = errors.New("room not found")
	ErrLiveRoomTitleTooLong     = errors.New("room title is too long (max 120)")
	ErrLiveRoomHostNotFound     = errors.New("host user not found")
	ErrLiveRoomUnauthorized     = errors.New("forbidden")
	ErrLiveRoomPasswordWeak     = errors.New("room password must be 4-64 characters")
	ErrLiveRoomPasswordRequired = errors.New("room password required")
	ErrLiveRoomPasswordInvalid  = errors.New("room password invalid")
)

type LiveRoomService struct {
	rooms *repository.LiveRoomRepository
	users *repository.UserRepository
}

func NewLiveRoomService(rooms *repository.LiveRoomRepository, users *repository.UserRepository) *LiveRoomService {
	return &LiveRoomService{rooms: rooms, users: users}
}

type LiveRoomHost struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	FullName   string `json:"full_name"`
	IsVerified bool   `json:"is_verified"`
	AvatarURL  string `json:"avatar_url,omitempty"`
}

type LiveRoom struct {
	ID               string       `json:"id"`
	Title            string       `json:"title"`
	IsPrivate        bool         `json:"is_private"`
	CreatedAt        string       `json:"created_at"`
	ParticipantCount int          `json:"participant_count"`
	Host             LiveRoomHost `json:"host"`
}

type LiveRoomParticipant struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	FullName     string `json:"full_name"`
	IsVerified   bool   `json:"is_verified"`
	AvatarURL    string `json:"avatar_url,omitempty"`
	AudioEnabled bool   `json:"audio_enabled"`
	VideoEnabled bool   `json:"video_enabled"`
}

func normalizeLiveRoomTitle(value string) (string, error) {
	title := strings.TrimSpace(value)
	if len([]rune(title)) > 120 {
		return "", ErrLiveRoomTitleTooLong
	}
	return title, nil
}

func normalizeLiveRoomPassword(value string) (string, error) {
	password := strings.TrimSpace(value)
	n := len([]rune(password))
	if n < 4 || n > 64 {
		return "", ErrLiveRoomPasswordWeak
	}
	return password, nil
}

func mapLiveRoom(row repository.LiveRoomRow) LiveRoom {
	out := LiveRoom{
		ID:        row.ID,
		Title:     strings.TrimSpace(row.Title),
		IsPrivate: row.IsPrivate,
		CreatedAt: row.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		Host: LiveRoomHost{
			ID:         row.HostUserID,
			Username:   row.HostUsername,
			FullName:   row.HostFullName,
			IsVerified: row.HostVerified,
		},
	}
	if row.HostAvatarURL.Valid {
		out.Host.AvatarURL = strings.TrimSpace(row.HostAvatarURL.String)
	}
	return out
}

func (s *LiveRoomService) Create(ctx context.Context, hostUserID, title string, isPrivate bool, password string) (*LiveRoom, error) {
	hostUserID = strings.TrimSpace(hostUserID)
	if hostUserID == "" {
		return nil, ErrLiveRoomHostNotFound
	}
	if _, err := s.users.GetByID(ctx, hostUserID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLiveRoomHostNotFound
		}
		return nil, err
	}

	normalized, err := normalizeLiveRoomTitle(title)
	if err != nil {
		return nil, err
	}

	passwordHash := ""
	if isPrivate {
		normalizedPassword, err := normalizeLiveRoomPassword(password)
		if err != nil {
			return nil, err
		}
		hashed, err := bcrypt.GenerateFromPassword([]byte(normalizedPassword), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		passwordHash = string(hashed)
	}

	roomID, err := s.rooms.Create(ctx, hostUserID, normalized, isPrivate, passwordHash)
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, roomID)
}

func (s *LiveRoomService) List(ctx context.Context, limit, offset int) ([]LiveRoom, error) {
	rows, err := s.rooms.ListActive(ctx, limit, offset)
	if err != nil {
		return nil, err
	}
	out := make([]LiveRoom, 0, len(rows))
	for _, row := range rows {
		out = append(out, mapLiveRoom(row))
	}
	return out, nil
}

func (s *LiveRoomService) Get(ctx context.Context, roomID string) (*LiveRoom, error) {
	row, err := s.rooms.GetActiveByID(ctx, strings.TrimSpace(roomID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLiveRoomNotFound
		}
		return nil, err
	}
	out := mapLiveRoom(*row)
	return &out, nil
}

func (s *LiveRoomService) End(ctx context.Context, roomID string) error {
	if strings.TrimSpace(roomID) == "" {
		return ErrLiveRoomNotFound
	}
	return s.rooms.End(ctx, roomID)
}

func (s *LiveRoomService) VerifyJoinAccess(ctx context.Context, roomID, password string) error {
	access, err := s.rooms.GetActiveAccessByID(ctx, strings.TrimSpace(roomID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrLiveRoomNotFound
		}
		return err
	}
	if !access.IsPrivate {
		return nil
	}
	if strings.TrimSpace(password) == "" {
		return ErrLiveRoomPasswordRequired
	}
	if strings.TrimSpace(access.PasswordHash) == "" {
		return ErrLiveRoomPasswordInvalid
	}
	if err := bcrypt.CompareHashAndPassword([]byte(access.PasswordHash), []byte(password)); err != nil {
		return ErrLiveRoomPasswordInvalid
	}
	return nil
}

func (s *LiveRoomService) Participant(ctx context.Context, userID string) (*LiveRoomParticipant, error) {
	u, err := s.users.GetByID(ctx, strings.TrimSpace(userID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrLiveRoomHostNotFound
		}
		return nil, err
	}
	return &LiveRoomParticipant{
		ID:           u.ID,
		Username:     u.Username,
		FullName:     u.FullName,
		IsVerified:   u.IsVerified,
		AvatarURL:    strings.TrimSpace(u.AvatarURL),
		AudioEnabled: false,
		VideoEnabled: false,
	}, nil
}
