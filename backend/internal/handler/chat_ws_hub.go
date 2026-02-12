package handler

import (
	"encoding/json"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

type chatWSClient struct {
	chatID    string
	userID    string
	conn      *websocket.Conn
	writeMu   sync.Mutex
	closeOnce sync.Once
}

func (c *chatWSClient) send(payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return websocket.Message.Send(c.conn, string(data))
}

func (c *chatWSClient) close() {
	c.closeOnce.Do(func() {
		_ = c.conn.Close()
	})
}

type chatWSHub struct {
	mu    sync.RWMutex
	chats map[string]map[*chatWSClient]struct{}
}

func newChatWSHub() *chatWSHub {
	return &chatWSHub{
		chats: make(map[string]map[*chatWSClient]struct{}),
	}
}

func (h *chatWSHub) register(chatID, userID string, conn *websocket.Conn) *chatWSClient {
	client := &chatWSClient{
		chatID: chatID,
		userID: userID,
		conn:   conn,
	}

	h.mu.Lock()
	set, ok := h.chats[chatID]
	if !ok {
		set = make(map[*chatWSClient]struct{})
		h.chats[chatID] = set
	}
	set[client] = struct{}{}
	h.mu.Unlock()

	return client
}

func (h *chatWSHub) unregister(client *chatWSClient) {
	if client == nil {
		return
	}

	h.mu.Lock()
	set, ok := h.chats[client.chatID]
	if ok {
		delete(set, client)
		if len(set) == 0 {
			delete(h.chats, client.chatID)
		}
	}
	h.mu.Unlock()

	client.close()
}

func (h *chatWSHub) broadcast(chatID string, payload any) {
	h.mu.RLock()
	set := h.chats[chatID]
	clients := make([]*chatWSClient, 0, len(set))
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
