package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"sduthreads/internal/config"
	"sduthreads/internal/repository"
)

var (
	ErrTelegramDisabled = errors.New("telegram notifications are disabled")
)

type TelegramStatus struct {
	Enabled          bool    `json:"enabled"`
	Connected        bool    `json:"connected"`
	BotUsername      string  `json:"bot_username,omitempty"`
	TelegramUsername string  `json:"telegram_username,omitempty"`
	TelegramName     string  `json:"telegram_name,omitempty"`
	ConnectedAt      *string `json:"connected_at,omitempty"`
}

type TelegramConnectSession struct {
	Enabled     bool   `json:"enabled"`
	BotUsername string `json:"bot_username,omitempty"`
	StartCode   string `json:"start_code,omitempty"`
	DeepLink    string `json:"deep_link,omitempty"`
	ExpiresAt   string `json:"expires_at,omitempty"`
}

type TelegramDirectMessageNotification struct {
	RecipientUserID string
	ChatID          string
	SenderFullName  string
	SenderUsername  string
	MessagePreview  string
}

type telegramURLButton struct {
	Text string
	URL  string
}

type TelegramService struct {
	repo *repository.TelegramRepository

	enabled            bool
	token              string
	linkTTL            time.Duration
	pollTimeoutSec     int
	notifyTextMaxRunes int
	appPublicURL       string

	httpClient *http.Client
	startOnce  sync.Once

	mu          sync.RWMutex
	botUsername string
}

func NewTelegramService(cfg config.Config, repo *repository.TelegramRepository) *TelegramService {
	token := strings.TrimSpace(cfg.TelegramBotToken)
	enabled := cfg.TelegramNotificationsEnabled && token != ""
	pollTimeout := cfg.TelegramBotPollTimeoutSec
	if pollTimeout <= 0 {
		pollTimeout = 45
	}
	if pollTimeout > 55 {
		pollTimeout = 55
	}
	linkTTL := time.Duration(cfg.TelegramLinkTTLMin) * time.Minute
	if linkTTL <= 0 {
		linkTTL = 10 * time.Minute
	}
	previewLimit := cfg.TelegramNotifyPreviewRunes
	if previewLimit <= 0 {
		previewLimit = 180
	}
	publicURL := strings.TrimSpace(cfg.AppPublicURL)
	publicURL = strings.TrimSuffix(publicURL, "/")
	botUsername := strings.TrimSpace(cfg.TelegramBotUsername)
	botUsername = strings.TrimPrefix(botUsername, "@")

	clientTimeout := time.Duration(pollTimeout+10) * time.Second
	if clientTimeout < 20*time.Second {
		clientTimeout = 20 * time.Second
	}

	return &TelegramService{
		repo:               repo,
		enabled:            enabled,
		token:              token,
		linkTTL:            linkTTL,
		pollTimeoutSec:     pollTimeout,
		notifyTextMaxRunes: previewLimit,
		appPublicURL:       publicURL,
		httpClient: &http.Client{
			Timeout: clientTimeout,
		},
		botUsername: botUsername,
	}
}

func (s *TelegramService) Enabled() bool {
	return s != nil && s.enabled && s.repo != nil
}

func (s *TelegramService) BotUsername() string {
	if s == nil {
		return ""
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.TrimSpace(s.botUsername)
}

func (s *TelegramService) setBotUsername(username string) {
	username = strings.TrimSpace(strings.TrimPrefix(username, "@"))
	s.mu.Lock()
	s.botUsername = username
	s.mu.Unlock()
}

func (s *TelegramService) StartBackground() {
	if !s.Enabled() {
		return
	}
	s.startOnce.Do(func() {
		go s.pollLoop(context.Background())
	})
}

func (s *TelegramService) GetStatus(ctx context.Context, userID string) (TelegramStatus, error) {
	status := TelegramStatus{
		Enabled:     s.Enabled(),
		Connected:   false,
		BotUsername: s.BotUsername(),
	}
	if !s.Enabled() {
		return status, nil
	}

	link, err := s.repo.GetLinkByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return status, nil
		}
		return status, err
	}
	status.Connected = true
	status.TelegramUsername = strings.TrimSpace(link.TelegramUsername)
	status.TelegramName = strings.TrimSpace(link.TelegramFirstName)
	connectedAt := link.UpdatedAt.UTC().Format(time.RFC3339)
	status.ConnectedAt = &connectedAt
	return status, nil
}

func (s *TelegramService) CreateConnectSession(ctx context.Context, userID string) (*TelegramConnectSession, error) {
	if !s.Enabled() {
		return nil, ErrTelegramDisabled
	}

	now := time.Now().UTC()
	expiresAt := now.Add(s.linkTTL)

	var (
		code string
		err  error
	)
	for i := 0; i < 5; i++ {
		code, err = newTelegramStartCode()
		if err != nil {
			return nil, err
		}
		err = s.repo.CreateOrReplaceLinkCode(ctx, userID, code, expiresAt)
		if err == nil {
			break
		}
		if !isUniqueViolation(err) {
			return nil, err
		}
	}
	if err != nil {
		return nil, err
	}

	// Ensure deep-link always points to the bot behind the current token.
	if err := s.syncBotIdentity(ctx); err != nil {
		log.Printf("telegram sync bot identity on connect failed: %v", err)
	}
	botUsername := s.BotUsername()
	result := &TelegramConnectSession{
		Enabled:     true,
		BotUsername: botUsername,
		StartCode:   code,
		ExpiresAt:   expiresAt.Format(time.RFC3339),
	}
	if botUsername != "" {
		result.DeepLink = fmt.Sprintf("https://t.me/%s?start=%s", botUsername, code)
	}
	return result, nil
}

func (s *TelegramService) Disconnect(ctx context.Context, userID string) error {
	if !s.Enabled() {
		return nil
	}
	return s.repo.UnlinkByUserID(ctx, userID)
}

func (s *TelegramService) NotifyDirectMessage(ctx context.Context, req TelegramDirectMessageNotification) error {
	if !s.Enabled() {
		return nil
	}
	recipientID := strings.TrimSpace(req.RecipientUserID)
	if recipientID == "" {
		return nil
	}
	link, err := s.repo.GetLinkByUserID(ctx, recipientID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("telegram notify skipped: no link for user_id=%s", recipientID)
			return nil
		}
		return err
	}
	if !link.Enabled || link.TelegramChatID == 0 {
		log.Printf("telegram notify skipped: link disabled/invalid for user_id=%s chat_id=%d enabled=%v", recipientID, link.TelegramChatID, link.Enabled)
		return nil
	}

	sender := strings.TrimSpace(req.SenderFullName)
	if sender == "" {
		username := strings.TrimSpace(req.SenderUsername)
		if username != "" {
			sender = "@" + strings.TrimPrefix(username, "@")
		} else {
			sender = "пользователя"
		}
	}

	preview := strings.TrimSpace(req.MessagePreview)
	if preview == "" {
		preview = "Новое сообщение"
	}
	preview = truncateRunes(preview, s.notifyTextMaxRunes)

	text := fmt.Sprintf("💬 Новое сообщение от %s\n\n%s", sender, preview)
	chatID := strings.TrimSpace(req.ChatID)
	replyButtons := s.buildAppChatButtons(chatID)
	log.Printf("telegram notify attempt: recipient_user_id=%s telegram_chat_id=%d app_chat_id=%s", recipientID, link.TelegramChatID, chatID)
	if len(replyButtons) > 0 {
		if err := s.sendMessageWithURLButtons(ctx, link.TelegramChatID, text, replyButtons); err != nil {
			return err
		}
		log.Printf("telegram notify sent: recipient_user_id=%s telegram_chat_id=%d", recipientID, link.TelegramChatID)
		return nil
	}
	if err := s.sendMessage(ctx, link.TelegramChatID, text); err != nil {
		return err
	}
	log.Printf("telegram notify sent: recipient_user_id=%s telegram_chat_id=%d", recipientID, link.TelegramChatID)
	return nil
}

func (s *TelegramService) pollLoop(ctx context.Context) {
	if !s.Enabled() {
		return
	}
	if err := s.syncBotIdentity(ctx); err != nil {
		log.Printf("telegram bot identity unavailable: %v", err)
	}

	cleanupTicker := time.NewTicker(30 * time.Minute)
	defer cleanupTicker.Stop()

	var offset int64
	for {
		select {
		case <-ctx.Done():
			return
		case <-cleanupTicker.C:
			if err := s.repo.DeleteExpiredLinkCodes(ctx); err != nil {
				log.Printf("telegram cleanup expired link codes failed: %v", err)
			}
		default:
		}

		updates, nextOffset, err := s.getUpdates(ctx, offset)
		if err != nil {
			log.Printf("telegram getUpdates failed: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}
		offset = nextOffset
		for _, upd := range updates {
			s.handleUpdate(ctx, upd)
		}
	}
}

func (s *TelegramService) handleUpdate(ctx context.Context, upd telegramUpdate) {
	chatID := upd.Message.Chat.ID
	if chatID == 0 {
		return
	}

	cmd, arg := parseTelegramCommand(upd.Message.Text)
	switch cmd {
	case "/start":
		if strings.TrimSpace(arg) == "" {
			_ = s.sendMessage(ctx, chatID, "Привет! Для привязки аккаунта откройте сайт, перейдите в Профиль → Редактировать → Telegram и нажмите «Подключить Telegram».")
			return
		}
		userID, err := s.repo.ConsumeLinkCode(ctx, arg)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				_ = s.sendMessage(ctx, chatID, "Код привязки не найден или истек. Сгенерируйте новый код в профиле на сайте.")
				return
			}
			_ = s.sendMessage(ctx, chatID, "Не удалось обработать код. Попробуйте снова чуть позже.")
			return
		}
		if err := s.repo.UpsertLink(
			ctx,
			userID,
			chatID,
			upd.Message.From.ID,
			upd.Message.From.Username,
			upd.Message.From.FirstName,
		); err != nil {
			_ = s.sendMessage(ctx, chatID, "Не удалось привязать аккаунт. Попробуйте снова.")
			return
		}
		successText := "Готово! Уведомления о новых сообщениях включены."
		replyButtons := s.buildAppChatsButtons()
		if len(replyButtons) > 0 {
			_ = s.sendMessageWithURLButtons(ctx, chatID, successText, replyButtons)
			return
		}
		_ = s.sendMessage(ctx, chatID, successText)
	case "/unlink":
		if err := s.repo.UnlinkByChatID(ctx, chatID); err != nil {
			_ = s.sendMessage(ctx, chatID, "Не удалось отключить уведомления. Попробуйте снова.")
			return
		}
		_ = s.sendMessage(ctx, chatID, "Уведомления отключены. Для повторного подключения используйте новый код на сайте.")
	case "/help":
		_ = s.sendMessage(ctx, chatID, "Команды:\n/start <код> — привязать аккаунт\n/unlink — отключить уведомления")
	}
}

func (s *TelegramService) syncBotIdentity(ctx context.Context) error {
	if !s.Enabled() {
		return ErrTelegramDisabled
	}
	var resp telegramGetMeResult
	if err := s.callTelegram(ctx, "getMe", map[string]any{}, &resp); err != nil {
		return err
	}
	resolvedUsername := strings.TrimSpace(strings.TrimPrefix(resp.Username, "@"))
	if resolvedUsername != "" {
		previousUsername := strings.TrimSpace(strings.TrimPrefix(s.BotUsername(), "@"))
		if previousUsername != "" && !strings.EqualFold(previousUsername, resolvedUsername) {
			log.Printf("telegram bot username mismatch: configured=@%s token=@%s; using token username", previousUsername, resolvedUsername)
		}
		s.setBotUsername(resolvedUsername)
	}
	return nil
}

func (s *TelegramService) getUpdates(ctx context.Context, offset int64) ([]telegramUpdate, int64, error) {
	if !s.Enabled() {
		return nil, offset, ErrTelegramDisabled
	}
	req := map[string]any{
		"offset":          offset,
		"timeout":         s.pollTimeoutSec,
		"allowed_updates": []string{"message"},
	}
	var updates []telegramUpdate
	if err := s.callTelegram(ctx, "getUpdates", req, &updates); err != nil {
		return nil, offset, err
	}
	nextOffset := offset
	for _, upd := range updates {
		if upd.UpdateID >= nextOffset {
			nextOffset = upd.UpdateID + 1
		}
	}
	return updates, nextOffset, nil
}

func (s *TelegramService) sendMessage(ctx context.Context, chatID int64, text string) error {
	return s.sendMessageWithMarkup(ctx, chatID, text, nil)
}

func (s *TelegramService) sendMessageWithURLButton(ctx context.Context, chatID int64, text, buttonText, buttonURL string) error {
	return s.sendMessageWithURLButtons(ctx, chatID, text, []telegramURLButton{
		{
			Text: buttonText,
			URL:  buttonURL,
		},
	})
}

func (s *TelegramService) sendMessageWithURLButtons(ctx context.Context, chatID int64, text string, buttons []telegramURLButton) error {
	markup := buildInlineURLKeyboard(buttons)
	if markup == nil {
		return s.sendMessage(ctx, chatID, text)
	}
	if err := s.sendMessageWithMarkup(ctx, chatID, text, markup); err != nil {
		if isInvalidTelegramButtonURLError(err) {
			log.Printf("telegram button URL rejected, sending message without button: %v", err)
			return s.sendMessage(ctx, chatID, text)
		}
		return err
	}
	return nil
}

func (s *TelegramService) sendMessageWithMarkup(ctx context.Context, chatID int64, text string, replyMarkup map[string]any) error {
	if !s.Enabled() || chatID == 0 || strings.TrimSpace(text) == "" {
		return nil
	}
	req := map[string]any{
		"chat_id":                  chatID,
		"text":                     text,
		"disable_web_page_preview": true,
	}
	if replyMarkup != nil {
		req["reply_markup"] = replyMarkup
	}
	var out map[string]any
	if err := s.callTelegram(ctx, "sendMessage", req, &out); err != nil {
		log.Printf("telegram sendMessage failed: chat_id=%d err=%v", chatID, err)
		return err
	}
	return nil
}

func (s *TelegramService) buildAppChatsButtons() []telegramURLButton {
	return buildAppURLButtons(s.appPublicURL, "/chats", "Ответить")
}

func (s *TelegramService) buildAppChatButtons(chatID string) []telegramURLButton {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return nil
	}
	return buildAppURLButtons(s.appPublicURL, "/chats/"+url.PathEscape(chatID), "Ответить")
}

func (s *TelegramService) callTelegram(ctx context.Context, method string, req any, out any) error {
	method = strings.TrimSpace(method)
	if method == "" {
		return errors.New("telegram method is required")
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return err
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/%s", s.token, method)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	res, err := s.httpClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	var parsed telegramAPIResponse
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return err
	}
	if !parsed.OK {
		desc := strings.TrimSpace(parsed.Description)
		if desc == "" {
			desc = "telegram api error"
		}
		return errors.New(desc)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(parsed.Result, out)
}

type telegramAPIResponse struct {
	OK          bool            `json:"ok"`
	Description string          `json:"description"`
	Result      json.RawMessage `json:"result"`
}

type telegramGetMeResult struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type telegramUpdate struct {
	UpdateID int64 `json:"update_id"`
	Message  struct {
		Text string `json:"text"`
		From struct {
			ID        int64  `json:"id"`
			Username  string `json:"username"`
			FirstName string `json:"first_name"`
		} `json:"from"`
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
	} `json:"message"`
}

func parseTelegramCommand(text string) (string, string) {
	text = strings.TrimSpace(text)
	if text == "" || !strings.HasPrefix(text, "/") {
		return "", ""
	}
	parts := strings.Fields(text)
	if len(parts) == 0 {
		return "", ""
	}
	cmd := strings.ToLower(strings.TrimSpace(parts[0]))
	if idx := strings.Index(cmd, "@"); idx > 0 {
		cmd = cmd[:idx]
	}
	arg := ""
	if len(parts) > 1 {
		arg = strings.TrimSpace(strings.Join(parts[1:], " "))
	}
	return cmd, arg
}

func newTelegramStartCode() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func isUniqueViolation(err error) bool {
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(msg, "duplicate key value violates unique constraint")
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(strings.TrimSpace(s))
	if len(r) <= max {
		return string(r)
	}
	if max <= 1 {
		return string(r[:max])
	}
	return string(r[:max-1]) + "…"
}

func buildInlineURLKeyboard(buttons []telegramURLButton) map[string]any {
	if len(buttons) == 0 {
		return nil
	}
	rows := make([][]map[string]string, 0, len(buttons))
	for _, btn := range buttons {
		buttonText := strings.TrimSpace(btn.Text)
		buttonURL := strings.TrimSpace(btn.URL)
		if buttonText == "" || buttonURL == "" {
			continue
		}
		rows = append(rows, []map[string]string{
			{
				"text": buttonText,
				"url":  buttonURL,
			},
		})
	}
	if len(rows) == 0 {
		return nil
	}
	return map[string]any{
		"inline_keyboard": rows,
	}
}

func buildAppURLButtons(baseURLsRaw, path, baseLabel string) []telegramURLButton {
	urls := buildAppURLs(baseURLsRaw, path)
	if len(urls) == 0 {
		return nil
	}

	baseLabel = strings.TrimSpace(baseLabel)
	if baseLabel == "" {
		baseLabel = "Открыть"
	}
	withHostInLabel := len(urls) > 1
	out := make([]telegramURLButton, 0, len(urls))
	for _, link := range urls {
		label := baseLabel
		if withHostInLabel {
			if host := appURLHostname(link); host != "" {
				label = fmt.Sprintf("%s (%s)", baseLabel, host)
			}
		}
		out = append(out, telegramURLButton{
			Text: label,
			URL:  link,
		})
	}
	return out
}

func buildAppURLs(baseURLsRaw, path string) []string {
	baseURLs := splitAppBaseURLs(baseURLsRaw)
	if len(baseURLs) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(baseURLs))
	out := make([]string, 0, len(baseURLs))
	for _, baseURL := range baseURLs {
		link := buildAppURL(baseURL, path)
		if link == "" {
			continue
		}
		if _, ok := seen[link]; ok {
			continue
		}
		seen[link] = struct{}{}
		out = append(out, link)
	}
	return out
}

func splitAppBaseURLs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	raw = strings.ReplaceAll(raw, ";", ",")
	parts := strings.Split(raw, ",")
	seen := make(map[string]struct{}, len(parts))
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, ok := seen[part]; ok {
			continue
		}
		seen[part] = struct{}{}
		out = append(out, part)
	}
	return out
}

func buildAppURL(baseURL, path string) string {
	baseURL = strings.TrimSpace(baseURL)
	path = strings.TrimSpace(path)
	if baseURL == "" || path == "" {
		return ""
	}
	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" {
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return ""
	}

	prefix := strings.TrimSuffix(strings.TrimSpace(u.Path), "/")
	path = "/" + strings.TrimPrefix(path, "/")
	u.Path = prefix + path
	u.RawPath = ""
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimSpace(u.String())
}

func appURLHostname(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(u.Hostname())
}

func isInvalidTelegramButtonURLError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(msg, "inline keyboard button url") ||
		strings.Contains(msg, "wrong http url")
}
