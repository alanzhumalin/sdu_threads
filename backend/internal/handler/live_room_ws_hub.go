package handler

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"golang.org/x/net/websocket"

	"sduthreads/internal/service"
)

type liveRoomWSClient struct {
	roomID    string
	userID    string
	user      service.LiveRoomParticipant
	conn      *websocket.Conn
	writeMu   sync.Mutex
	closeOnce sync.Once
}

func (c *liveRoomWSClient) send(payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return websocket.Message.Send(c.conn, string(data))
}

func (c *liveRoomWSClient) close() {
	c.closeOnce.Do(func() {
		_ = c.conn.Close()
	})
}

type liveRoomWSHub struct {
	mu    sync.RWMutex
	rooms map[string]map[*liveRoomWSClient]struct{}
}

func newLiveRoomWSHub() *liveRoomWSHub {
	return &liveRoomWSHub{
		rooms: make(map[string]map[*liveRoomWSClient]struct{}),
	}
}

func (h *liveRoomWSHub) register(roomID string, user service.LiveRoomParticipant, conn *websocket.Conn) *liveRoomWSClient {
	client := &liveRoomWSClient{
		roomID: roomID,
		userID: user.ID,
		user:   user,
		conn:   conn,
	}

	var replaced []*liveRoomWSClient
	h.mu.Lock()
	set, ok := h.rooms[roomID]
	if !ok {
		set = make(map[*liveRoomWSClient]struct{})
		h.rooms[roomID] = set
	}
	for existing := range set {
		if existing.userID == user.ID {
			delete(set, existing)
			replaced = append(replaced, existing)
		}
	}
	set[client] = struct{}{}
	h.mu.Unlock()

	for _, old := range replaced {
		old.close()
	}
	return client
}

func (h *liveRoomWSHub) unregister(client *liveRoomWSClient) {
	if client == nil {
		return
	}

	h.mu.Lock()
	set, ok := h.rooms[client.roomID]
	if ok {
		delete(set, client)
		if len(set) == 0 {
			delete(h.rooms, client.roomID)
		}
	}
	h.mu.Unlock()

	client.close()
}

func (h *liveRoomWSHub) roomSize(roomID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[roomID])
}

func (h *liveRoomWSHub) listParticipants(roomID string, excludeUserID string) []service.LiveRoomParticipant {
	h.mu.RLock()
	set := h.rooms[roomID]
	out := make([]service.LiveRoomParticipant, 0, len(set))
	for c := range set {
		if excludeUserID != "" && c.userID == excludeUserID {
			continue
		}
		out = append(out, c.user)
	}
	h.mu.RUnlock()
	return out
}

func (h *liveRoomWSHub) updateMediaState(client *liveRoomWSClient, audioEnabled, videoEnabled, screenEnabled *bool) service.LiveRoomParticipant {
	if client == nil {
		return service.LiveRoomParticipant{}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if audioEnabled != nil {
		client.user.AudioEnabled = *audioEnabled
	}
	if videoEnabled != nil {
		client.user.VideoEnabled = *videoEnabled
	}
	if screenEnabled != nil {
		client.user.ScreenEnabled = *screenEnabled
	}
	return client.user
}

func (h *liveRoomWSHub) broadcast(roomID string, payload any) {
	h.mu.RLock()
	set := h.rooms[roomID]
	clients := make([]*liveRoomWSClient, 0, len(set))
	for c := range set {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		if err := c.send(payload); err != nil {
			log.Printf("live-room ws send failed room=%s user=%s err=%v", c.roomID, c.userID, err)
			h.unregister(c)
		}
	}
}

func (h *liveRoomWSHub) broadcastExcept(roomID, excludeUserID string, payload any) {
	h.mu.RLock()
	set := h.rooms[roomID]
	clients := make([]*liveRoomWSClient, 0, len(set))
	for c := range set {
		if excludeUserID != "" && c.userID == excludeUserID {
			continue
		}
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		if err := c.send(payload); err != nil {
			log.Printf("live-room ws send failed room=%s user=%s err=%v", c.roomID, c.userID, err)
			h.unregister(c)
		}
	}
}

func (h *liveRoomWSHub) sendToUser(roomID, userID string, payload any) bool {
	h.mu.RLock()
	set := h.rooms[roomID]
	clients := make([]*liveRoomWSClient, 0, 1)
	for c := range set {
		if c.userID == userID {
			clients = append(clients, c)
		}
	}
	h.mu.RUnlock()

	if len(clients) == 0 {
		return false
	}
	for _, c := range clients {
		if err := c.send(payload); err != nil {
			log.Printf("live-room ws send failed room=%s user=%s err=%v", c.roomID, c.userID, err)
			h.unregister(c)
		}
	}
	return true
}
