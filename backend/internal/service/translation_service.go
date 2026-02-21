package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"sduthreads/internal/config"
)

var (
	ErrTranslationDisabled      = errors.New("translation is disabled")
	ErrTranslationTextRequired  = errors.New("text is required")
	ErrTranslationTextTooLong   = errors.New("text is too long")
	ErrTranslationTargetInvalid = errors.New("unsupported target language")
	ErrTranslationFailed        = errors.New("translation failed")
	ErrTranslationRateLimited   = errors.New("translation provider rate limited")
	ErrTranslationUnauthorized  = errors.New("translation provider unauthorized")
	ErrTranslationRejected      = errors.New("translation request rejected")
	ErrTranslationUnavailable   = errors.New("translation provider unavailable")
)

type TranslationService struct {
	enabled  bool
	apiKey   string
	baseURL  string
	maxChars int
	client   *http.Client
}

type TranslationResult struct {
	TranslatedText string
	SourceLang     string
	TargetLang     string
	Model          string
}

func NewTranslationService(cfg config.Config) *TranslationService {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.TranslationLibreURL), "/")
	if baseURL == "" {
		baseURL = "http://libretranslate:5000"
	}
	timeout := cfg.TranslationTimeoutMS
	if timeout <= 0 {
		timeout = 12000
	}
	maxChars := cfg.TranslationMaxChars
	if maxChars <= 0 {
		maxChars = 4000
	}
	apiKey := strings.TrimSpace(cfg.TranslationLibreAPIKey)
	enabled := cfg.TranslationEnabled && baseURL != ""

	return &TranslationService{
		enabled:  enabled,
		apiKey:   apiKey,
		baseURL:  baseURL,
		maxChars: maxChars,
		client: &http.Client{
			Timeout: time.Duration(timeout) * time.Millisecond,
		},
	}
}

func (s *TranslationService) Enabled() bool {
	return s != nil && s.enabled
}

func normalizeTranslationLang(raw string) (string, bool) {
	lang := strings.ToLower(strings.TrimSpace(raw))
	switch lang {
	case "kk", "ru", "en":
		return lang, true
	default:
		return "", false
	}
}

func detectTextLanguage(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	// Quick signal for Kazakh-specific Cyrillic letters.
	for _, r := range text {
		switch unicode.ToLower(r) {
		case 'ә', 'ғ', 'қ', 'ң', 'ө', 'ұ', 'ү', 'һ', 'і':
			return "kk"
		}
	}

	hasLatin := false
	hasCyrillic := false
	for _, r := range text {
		if unicode.In(r, unicode.Latin) {
			hasLatin = true
		}
		if unicode.In(r, unicode.Cyrillic) {
			hasCyrillic = true
		}
	}
	if hasCyrillic {
		return "ru"
	}
	if hasLatin {
		return "en"
	}
	return ""
}

type libreTranslateRequest struct {
	Q      string `json:"q"`
	Source string `json:"source"`
	Target string `json:"target"`
	Format string `json:"format,omitempty"`
	APIKey string `json:"api_key,omitempty"`
}

type libreTranslateResponse struct {
	TranslatedText   string `json:"translatedText"`
	DetectedLanguage struct {
		Language string `json:"language"`
	} `json:"detectedLanguage"`
	Error string `json:"error"`
}

func normalizeSourceForLibre(source string) string {
	if source == "" {
		return "auto"
	}
	return source
}

func parseTranslationProviderError(body []byte) string {
	decoded := struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}{}
	if err := json.Unmarshal(body, &decoded); err == nil {
		if msg := strings.TrimSpace(decoded.Error); msg != "" {
			return msg
		}
		if msg := strings.TrimSpace(decoded.Message); msg != "" {
			return msg
		}
	}
	return strings.TrimSpace(string(body))
}

func mapTranslationHTTPError(status int, providerMessage string) error {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return ErrTranslationUnauthorized
	case http.StatusTooManyRequests:
		return ErrTranslationRateLimited
	case http.StatusBadRequest:
		msg := strings.ToLower(strings.TrimSpace(providerMessage))
		if strings.Contains(msg, "language") &&
			(strings.Contains(msg, "unsupported") || strings.Contains(msg, "invalid")) {
			return ErrTranslationTargetInvalid
		}
		return ErrTranslationRejected
	default:
		if status == http.StatusBadGateway || status == http.StatusServiceUnavailable || status == http.StatusGatewayTimeout {
			return ErrTranslationUnavailable
		}
		return ErrTranslationFailed
	}
}

func (s *TranslationService) Translate(
	ctx context.Context,
	text string,
	targetLang string,
	sourceLang string,
) (*TranslationResult, error) {
	if !s.Enabled() {
		return nil, ErrTranslationDisabled
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, ErrTranslationTextRequired
	}
	if utf8.RuneCountInString(text) > s.maxChars {
		return nil, ErrTranslationTextTooLong
	}
	target, ok := normalizeTranslationLang(targetLang)
	if !ok {
		return nil, ErrTranslationTargetInvalid
	}
	source, _ := normalizeTranslationLang(sourceLang)
	if source == "" {
		source = detectTextLanguage(text)
	}
	if source == target {
		return &TranslationResult{
			TranslatedText: text,
			SourceLang:     source,
			TargetLang:     target,
			Model:          "noop",
		}, nil
	}
	sourceForRequest := normalizeSourceForLibre(source)
	reqBody := libreTranslateRequest{
		Q:      text,
		Source: sourceForRequest,
		Target: target,
		Format: "text",
		APIKey: s.apiKey,
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	url := s.baseURL + "/translate"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := s.client.Do(req)
	if err != nil {
		return nil, ErrTranslationUnavailable
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, mapTranslationHTTPError(res.StatusCode, parseTranslationProviderError(body))
	}

	var providerResp libreTranslateResponse
	if err := json.Unmarshal(body, &providerResp); err != nil {
		return nil, err
	}
	translated := strings.TrimSpace(providerResp.TranslatedText)
	if translated == "" {
		return nil, ErrTranslationFailed
	}
	detected := source
	if sourceForRequest == "auto" {
		if detectedCandidate, ok := normalizeTranslationLang(providerResp.DetectedLanguage.Language); ok {
			detected = detectedCandidate
		}
	}
	if detected == "" {
		detected = "unknown"
	}
	return &TranslationResult{
		TranslatedText: translated,
		SourceLang:     detected,
		TargetLang:     target,
		Model:          "libretranslate",
	}, nil
}
