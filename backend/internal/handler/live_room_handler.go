package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/websocket"

	"sduthreads/internal/auth"
	"sduthreads/internal/dto"
	"sduthreads/internal/service"
)

type LiveRoomHandler struct {
	service *service.LiveRoomService
	jwt     *auth.JWTManager
	ws      *liveRoomWSHub

	cleanupMu     sync.Mutex
	cleanupTimers map[string]*time.Timer
}

func NewLiveRoomHandler(s *service.LiveRoomService, jwt *auth.JWTManager) *LiveRoomHandler {
	return &LiveRoomHandler{
		service:       s,
		jwt:           jwt,
		ws:            newLiveRoomWSHub(),
		cleanupTimers: make(map[string]*time.Timer),
	}
}

const liveRoomCleanupDelay = 5 * time.Minute

func (h *LiveRoomHandler) cancelCleanup(roomID string) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return
	}

	h.cleanupMu.Lock()
	defer h.cleanupMu.Unlock()
	if timer, ok := h.cleanupTimers[roomID]; ok {
		timer.Stop()
		delete(h.cleanupTimers, roomID)
	}
}

func (h *LiveRoomHandler) scheduleCleanup(roomID string) {
	roomID = strings.TrimSpace(roomID)
	if roomID == "" {
		return
	}

	h.cleanupMu.Lock()
	if old, ok := h.cleanupTimers[roomID]; ok {
		old.Stop()
	}
	h.cleanupTimers[roomID] = time.AfterFunc(liveRoomCleanupDelay, func() {
		if h.ws.roomSize(roomID) == 0 {
			_ = h.service.End(context.Background(), roomID)
		}
		h.cleanupMu.Lock()
		delete(h.cleanupTimers, roomID)
		h.cleanupMu.Unlock()
	})
	h.cleanupMu.Unlock()
}

func (h *LiveRoomHandler) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/rooms", h.handleRooms)
	mux.HandleFunc("/api/rooms/", h.handleRoomActions)
}

func (h *LiveRoomHandler) handleRooms(w http.ResponseWriter, r *http.Request) {
	userID, err := requireUserID(r, h.jwt)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	_ = userID

	switch r.Method {
	case http.MethodGet:
		limit := parseIntQuery(r, "limit", 20)
		offset := parseIntQuery(r, "offset", 0)
		items, err := h.service.List(r.Context(), limit, offset)
		if err != nil {
			h.writeRoomError(w, err)
			return
		}
		for i := range items {
			items[i].ParticipantCount = h.ws.roomSize(items[i].ID)
		}
		setNextOffset(w, offset, limit, len(items))
		writeJSON(w, http.StatusOK, items)
	case http.MethodPost:
		var req dto.CreateLiveRoomRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid json")
			return
		}
		item, err := h.service.Create(r.Context(), userID, req.Title, req.IsPrivate, req.Password)
		if err != nil {
			h.writeRoomError(w, err)
			return
		}
		item.ParticipantCount = h.ws.roomSize(item.ID)
		writeJSON(w, http.StatusCreated, item)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *LiveRoomHandler) handleRoomActions(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.TrimPrefix(r.URL.Path, "/api/rooms/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	roomID := strings.TrimSpace(parts[0])

	if len(parts) == 1 {
		h.handleRoomByID(w, r, roomID)
		return
	}

	if len(parts) == 2 && parts[1] == "ws" {
		h.handleRoomWS(w, r, roomID)
		return
	}

	writeError(w, http.StatusNotFound, "not found")
}

func (h *LiveRoomHandler) handleRoomByID(w http.ResponseWriter, r *http.Request, roomID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if _, err := requireUserID(r, h.jwt); err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	item, err := h.service.Get(r.Context(), roomID)
	if err != nil {
		h.writeRoomError(w, err)
		return
	}
	item.ParticipantCount = h.ws.roomSize(item.ID)
	writeJSON(w, http.StatusOK, item)
}

func (h *LiveRoomHandler) handleRoomWS(w http.ResponseWriter, r *http.Request, roomID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	websocket.Handler(func(conn *websocket.Conn) {
		userID, roomPassword, err := h.wsAuthenticate(conn)
		if err != nil {
			_ = websocket.Message.Send(conn, `{"type":"error","message":"unauthorized"}`)
			_ = conn.Close()
			return
		}

		room, err := h.service.Get(r.Context(), roomID)
		if err != nil {
			_ = websocket.Message.Send(conn, `{"type":"error","message":"room_not_found"}`)
			_ = conn.Close()
			return
		}

		if err := h.service.VerifyJoinAccess(r.Context(), roomID, roomPassword); err != nil {
			switch {
			case errors.Is(err, service.ErrLiveRoomPasswordRequired):
				_ = websocket.Message.Send(conn, `{"type":"error","message":"room_password_required"}`)
			case errors.Is(err, service.ErrLiveRoomPasswordInvalid):
				_ = websocket.Message.Send(conn, `{"type":"error","message":"room_password_invalid"}`)
			default:
				_ = websocket.Message.Send(conn, `{"type":"error","message":"forbidden"}`)
			}
			_ = conn.Close()
			return
		}

		participant, err := h.service.Participant(r.Context(), userID)
		if err != nil {
			_ = websocket.Message.Send(conn, `{"type":"error","message":"unauthorized"}`)
			_ = conn.Close()
			return
		}
		client := h.ws.register(roomID, *participant, conn)
		h.cancelCleanup(roomID)
		log.Printf("live-room ws joined room=%s user=%s online=%d", roomID, userID, h.ws.roomSize(roomID))

		heartbeatStop := make(chan struct{})
		go func() {
			ticker := time.NewTicker(25 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-heartbeatStop:
					return
				case <-ticker.C:
					if err := client.send(map[string]any{
						"type": "ping",
						"ts":   time.Now().UnixMilli(),
					}); err != nil {
						log.Printf("live-room ws heartbeat failed room=%s user=%s err=%v", roomID, userID, err)
						client.close()
						return
					}
				}
			}
		}()

		others := h.ws.listParticipants(roomID, userID)
		room.ParticipantCount = h.ws.roomSize(roomID)
		_ = client.send(map[string]any{
			"type":         "ready",
			"room":         room,
			"self":         participant,
			"participants": others,
		})

		h.ws.broadcastExcept(roomID, userID, map[string]any{
			"type":        "user_joined",
			"room_id":     roomID,
			"participant": participant,
		})

		defer func() {
			close(heartbeatStop)
			h.ws.unregister(client)
			h.ws.broadcast(roomID, map[string]any{
				"type":    "user_left",
				"room_id": roomID,
				"user_id": userID,
			})
			log.Printf("live-room ws left room=%s user=%s online=%d", roomID, userID, h.ws.roomSize(roomID))
			if h.ws.roomSize(roomID) == 0 {
				h.scheduleCleanup(roomID)
			}
		}()

		for {
			var raw string
			if err := websocket.Message.Receive(conn, &raw); err != nil {
				return
			}
			var frame struct {
				Type          string          `json:"type"`
				TargetUserID  string          `json:"target_user_id"`
				SignalType    string          `json:"signal_type"`
				Payload       json.RawMessage `json:"payload"`
				AudioEnabled  *bool           `json:"audio_enabled"`
				VideoEnabled  *bool           `json:"video_enabled"`
				ScreenEnabled *bool           `json:"screen_enabled"`
			}
			if err := json.Unmarshal([]byte(raw), &frame); err != nil {
				continue
			}

			switch strings.ToLower(strings.TrimSpace(frame.Type)) {
			case "leave":
				return
			case "ping":
				_ = client.send(map[string]any{
					"type": "pong",
					"ts":   time.Now().UnixMilli(),
				})
			case "pong":
				continue
			case "signal":
				targetUserID := strings.TrimSpace(frame.TargetUserID)
				if targetUserID == "" || targetUserID == userID {
					continue
				}
				delivered := h.ws.sendToUser(roomID, targetUserID, map[string]any{
					"type":         "signal",
					"room_id":      roomID,
					"from_user_id": userID,
					"signal_type":  strings.TrimSpace(frame.SignalType),
					"payload":      frame.Payload,
				})
				log.Printf(
					"live-room ws signal room=%s from=%s to=%s type=%s delivered=%t",
					roomID,
					userID,
					targetUserID,
					strings.TrimSpace(frame.SignalType),
					delivered,
				)
			case "media_state":
				updated := h.ws.updateMediaState(client, frame.AudioEnabled, frame.VideoEnabled, frame.ScreenEnabled)
				log.Printf(
					"live-room ws media_state room=%s user=%s audio=%t video=%t screen=%t",
					roomID,
					userID,
					updated.AudioEnabled,
					updated.VideoEnabled,
					updated.ScreenEnabled,
				)
				h.ws.broadcastExcept(roomID, userID, map[string]any{
					"type":           "participant_state_updated",
					"room_id":        roomID,
					"user_id":        userID,
					"audio_enabled":  updated.AudioEnabled,
					"video_enabled":  updated.VideoEnabled,
					"screen_enabled": updated.ScreenEnabled,
				})
			}
		}
	}).ServeHTTP(w, r)
}

func (h *LiveRoomHandler) wsAuthenticate(conn *websocket.Conn) (string, string, error) {
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	var authRaw string
	if err := websocket.Message.Receive(conn, &authRaw); err != nil {
		return "", "", err
	}

	var authFrame struct {
		Type         string `json:"type"`
		Token        string `json:"token"`
		RoomPassword string `json:"room_password"`
	}
	if err := json.Unmarshal([]byte(authRaw), &authFrame); err != nil || strings.TrimSpace(authFrame.Type) != "auth" {
		return "", "", errors.New("unauthorized")
	}
	claims, err := h.jwt.Parse(strings.TrimSpace(authFrame.Token))
	if err != nil {
		return "", "", err
	}
	userID := strings.TrimSpace(claims.UserID)
	if userID == "" {
		return "", "", errors.New("unauthorized")
	}
	_ = conn.SetReadDeadline(time.Time{})
	return userID, strings.TrimSpace(authFrame.RoomPassword), nil
}

func (h *LiveRoomHandler) writeRoomError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrLiveRoomNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrLiveRoomTitleTooLong):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrLiveRoomPasswordWeak):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, service.ErrLiveRoomHostNotFound),
		errors.Is(err, service.ErrLiveRoomUnauthorized):
		writeError(w, http.StatusForbidden, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}
