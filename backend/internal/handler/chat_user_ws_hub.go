package handler

import (
	"encoding/json"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

type chatUserWSClient struct {
	userID    string
	conn      *websocket.Conn
	writeMu   sync.Mutex
	closeOnce sync.Once
}

func (c *chatUserWSClient) send(payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return websocket.Message.Send(c.conn, string(data))
}

func (c *chatUserWSClient) close() {
	c.closeOnce.Do(func() {
		_ = c.conn.Close()
	})
}

type chatUserWSHub struct {
	mu    sync.RWMutex
	users map[string]map[*chatUserWSClient]struct{}
}

func newChatUserWSHub() *chatUserWSHub {
	return &chatUserWSHub{
		users: make(map[string]map[*chatUserWSClient]struct{}),
	}
}

func (h *chatUserWSHub) register(userID string, conn *websocket.Conn) *chatUserWSClient {
	client := &chatUserWSClient{
		userID: userID,
		conn:   conn,
	}

	h.mu.Lock()
	set, ok := h.users[userID]
	if !ok {
		set = make(map[*chatUserWSClient]struct{})
		h.users[userID] = set
	}
	set[client] = struct{}{}
	h.mu.Unlock()

	return client
}

func (h *chatUserWSHub) unregister(client *chatUserWSClient) {
	if client == nil {
		return
	}

	h.mu.Lock()
	set, ok := h.users[client.userID]
	if ok {
		delete(set, client)
		if len(set) == 0 {
			delete(h.users, client.userID)
		}
	}
	h.mu.Unlock()

	client.close()
}

func (h *chatUserWSHub) broadcastMany(userIDs []string, payload any) {
	seen := make(map[string]struct{}, len(userIDs))
	for _, userID := range userIDs {
		if userID == "" {
			continue
		}
		if _, ok := seen[userID]; ok {
			continue
		}
		seen[userID] = struct{}{}
		h.broadcastUser(userID, payload)
	}
}

func (h *chatUserWSHub) broadcastUser(userID string, payload any) {
	h.mu.RLock()
	set := h.users[userID]
	clients := make([]*chatUserWSClient, 0, len(set))
	for client := range set {
		clients = append(clients, client)
	}
	h.mu.RUnlock()

	for _, client := range clients {
		if err := client.send(payload); err != nil {
			h.unregister(client)
		}
	}
}
