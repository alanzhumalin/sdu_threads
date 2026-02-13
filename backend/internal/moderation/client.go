package moderation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

type Config struct {
	Enabled     bool
	BaseURL     string
	Timeout     time.Duration
	FailClosed  bool
	RecordEvent RecordEventFn
}

type Client struct {
	enabled    bool
	baseURL    string
	failClosed bool
	http       *http.Client
	recordFn   RecordEventFn
}

type ViolationError struct {
	Reason       string
	Score        float64
	Source       string
	Scope        string
	Action       string
	TargetType   string
	TargetID     string
	ActorUserID  string
	MatchedTerms []string
	Labels       map[string]float64
}

func (e *ViolationError) Error() string {
	if e == nil {
		return "контент не прошел модерацию"
	}
	reason := strings.TrimSpace(e.Reason)
	if reason == "" {
		return "контент не прошел модерацию"
	}
	return reason
}

type ServiceUnavailableError struct {
	Err error
}

type APIError struct {
	StatusCode int
	Message    string
}

type AuditMeta struct {
	ActorUserID string
	Action      string
	TargetType  string
	TargetID    string
	Payload     map[string]any
}

type Event struct {
	ActorUserID  string
	Scope        string
	Action       string
	TargetType   string
	TargetID     string
	Blocked      bool
	Reason       string
	Score        float64
	Source       string
	MatchedTerms []string
	Labels       map[string]float64
	Payload      map[string]any
}

type RecordEventFn func(ctx context.Context, event Event)

func (e *ServiceUnavailableError) Error() string {
	if e == nil {
		return "сервис модерации временно недоступен"
	}
	return "сервис модерации временно недоступен"
}

func (e *ServiceUnavailableError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func (e *APIError) Error() string {
	if e == nil {
		return "ошибка moderation api"
	}
	msg := strings.TrimSpace(e.Message)
	if msg == "" {
		msg = "ошибка moderation api"
	}
	return msg
}

func IsViolation(err error) bool {
	var v *ViolationError
	return errors.As(err, &v)
}

func IsUnavailable(err error) bool {
	var v *ServiceUnavailableError
	return errors.As(err, &v)
}

type decisionResponse struct {
	Allowed      bool               `json:"allowed"`
	Reason       string             `json:"reason"`
	Score        float64            `json:"score"`
	Source       string             `json:"source"`
	MatchedTerms []string           `json:"matched_terms"`
	Labels       map[string]float64 `json:"labels"`
}

func NewClient(cfg Config) *Client {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 4 * time.Second
	}

	base := strings.TrimSpace(cfg.BaseURL)
	base = strings.TrimRight(base, "/")

	enabled := cfg.Enabled && base != ""
	return &Client{
		enabled:    enabled,
		baseURL:    base,
		failClosed: cfg.FailClosed,
		http:       &http.Client{Timeout: timeout},
		recordFn:   cfg.RecordEvent,
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.enabled
}

func (c *Client) CheckText(ctx context.Context, text string, scope string, meta *AuditMeta) error {
	if c == nil || !c.enabled {
		return nil
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}

	reqBody := map[string]string{
		"text":    text,
		"context": strings.TrimSpace(scope),
	}
	var resp decisionResponse
	if err := c.postJSON(ctx, "/moderate/text", reqBody, &resp); err != nil {
		return c.handleServiceErr(err)
	}
	return c.handleDecision(ctx, resp, strings.TrimSpace(scope), meta)
}

func (c *Client) CheckImageURL(ctx context.Context, imageURL string, scope string, meta *AuditMeta) error {
	if c == nil || !c.enabled {
		return nil
	}
	imageURL = strings.TrimSpace(imageURL)
	if imageURL == "" {
		return nil
	}

	reqBody := map[string]string{
		"url":     imageURL,
		"context": strings.TrimSpace(scope),
	}
	var resp decisionResponse
	if err := c.postJSON(ctx, "/moderate/image/url", reqBody, &resp); err != nil {
		return c.handleServiceErr(err)
	}
	return c.handleDecision(ctx, resp, strings.TrimSpace(scope), meta)
}

func (c *Client) CheckImageBytes(ctx context.Context, data []byte, filename, contentType, scope string, meta *AuditMeta) error {
	if c == nil || !c.enabled || len(data) == 0 {
		return nil
	}

	if strings.TrimSpace(filename) == "" {
		filename = "upload"
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)

	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escapeQuotes(filename)))
	if ct := strings.TrimSpace(contentType); ct != "" {
		h.Set("Content-Type", ct)
	}

	part, err := mw.CreatePart(h)
	if err != nil {
		_ = mw.Close()
		return c.handleServiceErr(err)
	}
	if _, err := part.Write(data); err != nil {
		_ = mw.Close()
		return c.handleServiceErr(err)
	}
	if err := mw.WriteField("context", strings.TrimSpace(scope)); err != nil {
		_ = mw.Close()
		return c.handleServiceErr(err)
	}
	if err := mw.Close(); err != nil {
		return c.handleServiceErr(err)
	}

	var resp decisionResponse
	if err := c.postMultipart(ctx, "/moderate/image/file", mw.FormDataContentType(), &body, &resp); err != nil {
		return c.handleServiceErr(err)
	}
	return c.handleDecision(ctx, resp, strings.TrimSpace(scope), meta)
}

func (c *Client) postJSON(ctx context.Context, path string, payload any, out any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return decodeResponse(resp, out)
}

func (c *Client) postMultipart(ctx context.Context, path string, contentType string, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return decodeResponse(resp, out)
}

func decodeResponse(resp *http.Response, out any) error {
	if resp == nil {
		return errors.New("nil response")
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &APIError{
			StatusCode: resp.StatusCode,
			Message:    extractMessage(raw),
		}
	}

	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("invalid moderation response: %w", err)
	}
	return nil
}

func extractMessage(raw []byte) string {
	if len(raw) == 0 {
		return "empty response"
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err == nil {
		for _, key := range []string{"detail", "error", "message"} {
			if v, ok := obj[key]; ok {
				if s := strings.TrimSpace(fmt.Sprintf("%v", v)); s != "" {
					return s
				}
			}
		}
	}

	s := strings.TrimSpace(string(raw))
	if s == "" {
		return "empty response"
	}
	if len(s) > 300 {
		return s[:300]
	}
	return s
}

func (c *Client) handleServiceErr(err error) error {
	if err == nil {
		return nil
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		// 4xx means the moderation service is reachable, but rejected/invalid request.
		// Return explicit client error instead of masking it as service unavailable.
		if apiErr.StatusCode >= 400 && apiErr.StatusCode < 500 {
			return apiErr
		}
	}
	if !c.failClosed {
		log.Printf("moderation skipped: %v", err)
		return nil
	}
	return &ServiceUnavailableError{Err: err}
}

func (c *Client) handleDecision(ctx context.Context, resp decisionResponse, scope string, meta *AuditMeta) error {
	if resp.Allowed {
		return nil
	}
	viol := &ViolationError{
		Reason: strings.TrimSpace(resp.Reason),
		Score:  resp.Score,
		Source: strings.TrimSpace(resp.Source),
		Scope:  scope,
	}
	if meta != nil {
		viol.Action = strings.TrimSpace(meta.Action)
		viol.TargetType = strings.TrimSpace(meta.TargetType)
		viol.TargetID = strings.TrimSpace(meta.TargetID)
		viol.ActorUserID = strings.TrimSpace(meta.ActorUserID)
	}
	if len(resp.MatchedTerms) > 0 {
		viol.MatchedTerms = append([]string(nil), resp.MatchedTerms...)
	}
	if len(resp.Labels) > 0 {
		viol.Labels = copyMap(resp.Labels)
	}
	c.recordEvent(ctx, viol, meta)
	return viol
}

func escapeQuotes(s string) string {
	return strings.NewReplacer(`\\`, `\\\\`, `"`, `\"`).Replace(s)
}

func (c *Client) recordEvent(ctx context.Context, viol *ViolationError, meta *AuditMeta) {
	if c == nil || viol == nil {
		return
	}
	ev := Event{
		ActorUserID:  strings.TrimSpace(viol.ActorUserID),
		Scope:        strings.TrimSpace(viol.Scope),
		Action:       strings.TrimSpace(viol.Action),
		TargetType:   strings.TrimSpace(viol.TargetType),
		TargetID:     strings.TrimSpace(viol.TargetID),
		Blocked:      true,
		Reason:       strings.TrimSpace(viol.Reason),
		Score:        viol.Score,
		Source:       strings.TrimSpace(viol.Source),
		MatchedTerms: append([]string(nil), viol.MatchedTerms...),
		Labels:       copyMap(viol.Labels),
	}
	if meta != nil && len(meta.Payload) > 0 {
		ev.Payload = copyAnyMap(meta.Payload)
	}
	if ev.Action == "" {
		ev.Action = ev.Scope
	}
	if ev.Reason == "" {
		ev.Reason = "контент не прошел модерацию"
	}
	log.Printf(
		"moderation blocked: scope=%s action=%s actor_user_id=%s target=%s/%s source=%s score=%.4f reason=%q matched_terms=%v labels=%v",
		ev.Scope,
		ev.Action,
		ev.ActorUserID,
		ev.TargetType,
		ev.TargetID,
		ev.Source,
		ev.Score,
		ev.Reason,
		ev.MatchedTerms,
		ev.Labels,
	)
	if c.recordFn != nil {
		c.recordFn(ctx, ev)
	}
}

func copyMap(in map[string]float64) map[string]float64 {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]float64, len(in))
	for k, v := range in {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		out[key] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func copyAnyMap(in map[string]any) map[string]any {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		key := strings.TrimSpace(k)
		if key == "" {
			continue
		}
		out[key] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
