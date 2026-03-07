package service

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"

	"sduthreads/internal/dto"
	"sduthreads/internal/repository"
	"sduthreads/internal/storage"
)

const (
	giftToNameMaxRunes    = 80
	giftFromNameMaxRunes  = 80
	giftMessageMaxRunes   = 2400
	giftOpenLineMaxRunes  = 120
	giftWishAuthorMax     = 60
	giftWishTextMax       = 220
	giftMaxWishes         = 12
	giftCodeLen           = 10
	giftCustomCodeMinLen  = 4
	giftCustomCodeMaxLen  = 40
	giftDefaultUILanguage = "kk"
)

var (
	ErrGiftNotFound          = errors.New("gift not found")
	ErrGiftToNameRequired    = errors.New("to_name is required")
	ErrGiftToNameTooLong     = errors.New("to_name is too long")
	ErrGiftFromNameTooLong   = errors.New("from_name is too long")
	ErrGiftMessageRequired   = errors.New("message is required")
	ErrGiftMessageTooLong    = errors.New("message is too long")
	ErrGiftOpenLineTooLong   = errors.New("open_line is too long")
	ErrGiftAnimationInvalid  = errors.New("invalid animation_type")
	ErrGiftMediaTypeInvalid  = errors.New("invalid gift media type")
	ErrGiftMediaURLInvalid   = errors.New("invalid gift media url")
	ErrGiftWishesTooMany     = errors.New("too many wishes")
	ErrGiftWishInvalid       = errors.New("invalid wish")
	ErrGiftCodeInvalid       = errors.New("invalid gift code")
	ErrGiftCodeReserved      = errors.New("gift code is reserved")
	ErrGiftUILanguageInvalid = errors.New("invalid ui_language")
	giftCustomCodePattern    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$`)
	giftSupportedUILanguages = map[string]struct{}{"kk": {}, "ru": {}, "en": {}}
	giftReservedCodes        = map[string]struct{}{
		"gift": {}, "create": {}, "login": {}, "register": {}, "logout": {}, "search": {},
		"notifications": {}, "chats": {}, "rooms": {}, "profile": {}, "admin": {}, "moderation": {},
		"u": {}, "p": {}, "api": {}, "healthz": {},
	}
)

var giftAnimationTypes = map[string]struct{}{
	"envelope":   {},
	"petals":     {},
	"collective": {},
}

type GiftCodeTakenError struct {
	ExpiresAt time.Time
}

func (e *GiftCodeTakenError) Error() string {
	if e == nil || e.ExpiresAt.IsZero() {
		return "gift code is already taken"
	}
	return fmt.Sprintf("gift code is already taken until %s", e.ExpiresAt.UTC().Format(time.RFC3339))
}

func (e *GiftCodeTakenError) RetryAfterSeconds() int {
	if e == nil || e.ExpiresAt.IsZero() {
		return 0
	}
	remaining := int(time.Until(e.ExpiresAt).Seconds())
	if remaining < 1 {
		return 1
	}
	return remaining
}

type GiftService struct {
	repo     *repository.GiftRepository
	uploader *storage.S3Uploader
}

func NewGiftService(repo *repository.GiftRepository, uploader *storage.S3Uploader) *GiftService {
	return &GiftService{repo: repo, uploader: uploader}
}

func normalizeGiftMediaType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return ""
	case "image":
		return "image"
	case "video":
		return "video"
	default:
		return ""
	}
}

func normalizeGiftUILanguage(raw string) (string, bool) {
	lang := strings.ToLower(strings.TrimSpace(raw))
	if lang == "" {
		return giftDefaultUILanguage, true
	}
	if _, ok := giftSupportedUILanguages[lang]; !ok {
		return "", false
	}
	return lang, true
}

func normalizeGiftCode(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func defaultGiftOpenLine(lang string) string {
	switch lang {
	case "ru":
		return "Для вас открытка"
	case "en":
		return "A card for you"
	default:
		return "Сізге ашық хат"
	}
}

func isGiftCodeValid(code string) bool {
	if code == "" {
		return false
	}
	l := len(code)
	if l < giftCustomCodeMinLen || l > giftCustomCodeMaxLen {
		return false
	}
	return giftCustomCodePattern.MatchString(code)
}

func isGiftCodeReserved(code string) bool {
	_, ok := giftReservedCodes[strings.ToLower(strings.TrimSpace(code))]
	return ok
}

func inferGiftMediaTypeFromURL(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return ""
	}
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	if strings.HasSuffix(raw, ".mp4") ||
		strings.HasSuffix(raw, ".webm") ||
		strings.HasSuffix(raw, ".mov") ||
		strings.HasSuffix(raw, ".m4v") ||
		strings.HasSuffix(raw, ".avi") ||
		strings.HasSuffix(raw, ".mkv") ||
		strings.HasSuffix(raw, ".3gp") ||
		strings.HasSuffix(raw, ".ogv") {
		return "video"
	}
	return "image"
}

func generateGiftCode() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	code := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf))
	if len(code) > giftCodeLen {
		code = code[:giftCodeLen]
	}
	return code, nil
}

func normalizeGiftWishes(in []dto.GiftWish) ([]dto.GiftWish, error) {
	if len(in) > giftMaxWishes {
		return nil, ErrGiftWishesTooMany
	}
	if len(in) == 0 {
		return []dto.GiftWish{}, nil
	}
	out := make([]dto.GiftWish, 0, len(in))
	for _, w := range in {
		author := strings.TrimSpace(w.Author)
		text := strings.TrimSpace(w.Text)
		if author == "" && text == "" {
			continue
		}
		if text == "" {
			return nil, ErrGiftWishInvalid
		}
		if len([]rune(author)) > giftWishAuthorMax || len([]rune(text)) > giftWishTextMax {
			return nil, ErrGiftWishInvalid
		}
		out = append(out, dto.GiftWish{Author: author, Text: text})
	}
	return out, nil
}

func giftFromRow(row *repository.GiftRow) (*dto.GiftCardResponse, error) {
	if row == nil {
		return nil, ErrGiftNotFound
	}
	wishes := make([]dto.GiftWish, 0)
	if strings.TrimSpace(row.WishesJSON) != "" {
		if err := json.Unmarshal([]byte(row.WishesJSON), &wishes); err != nil {
			wishes = []dto.GiftWish{}
		}
	}
	uiLanguage, ok := normalizeGiftUILanguage(row.UILanguage)
	if !ok {
		uiLanguage = giftDefaultUILanguage
	}
	return &dto.GiftCardResponse{
		Code:          strings.TrimSpace(row.Code),
		ToName:        strings.TrimSpace(row.ToName),
		FromName:      strings.TrimSpace(row.FromName),
		Message:       strings.TrimSpace(row.Message),
		OpenLine:      strings.TrimSpace(row.OpenLine),
		UILanguage:    uiLanguage,
		AnimationType: strings.TrimSpace(row.AnimationType),
		Media: dto.GiftMedia{
			URL:  strings.TrimSpace(row.MediaURL),
			Type: normalizeGiftMediaType(row.MediaType),
		},
		Wishes:    wishes,
		CreatedAt: row.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		ExpiresAt: row.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}, nil
}

func isGiftDuplicateError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "duplicate")
}

func (s *GiftService) createByCode(
	ctx context.Context,
	code string,
	toName string,
	fromName string,
	message string,
	openLine string,
	uiLanguage string,
	animationType string,
	mediaURL string,
	mediaType string,
	wishesJSON string,
) (*dto.GiftCardResponse, error) {
	row, err := s.repo.Create(
		ctx,
		code,
		toName,
		fromName,
		message,
		openLine,
		uiLanguage,
		animationType,
		mediaURL,
		mediaType,
		wishesJSON,
	)
	if err != nil {
		return nil, err
	}
	return giftFromRow(row)
}

func (s *GiftService) Create(ctx context.Context, req dto.CreateGiftRequest) (*dto.GiftCardResponse, error) {
	toName := strings.TrimSpace(req.ToName)
	if toName == "" {
		return nil, ErrGiftToNameRequired
	}
	if len([]rune(toName)) > giftToNameMaxRunes {
		return nil, ErrGiftToNameTooLong
	}

	fromName := strings.TrimSpace(req.FromName)
	if len([]rune(fromName)) > giftFromNameMaxRunes {
		return nil, ErrGiftFromNameTooLong
	}

	message := strings.TrimSpace(req.Message)
	if message == "" {
		return nil, ErrGiftMessageRequired
	}
	if len([]rune(message)) > giftMessageMaxRunes {
		return nil, ErrGiftMessageTooLong
	}

	uiLanguage, ok := normalizeGiftUILanguage(req.UILanguage)
	if !ok {
		return nil, ErrGiftUILanguageInvalid
	}
	openLine := strings.TrimSpace(req.OpenLine)
	if len([]rune(openLine)) > giftOpenLineMaxRunes {
		return nil, ErrGiftOpenLineTooLong
	}
	if openLine == "" {
		openLine = defaultGiftOpenLine(uiLanguage)
	}

	animationType := strings.ToLower(strings.TrimSpace(req.AnimationType))
	if animationType == "" {
		animationType = "envelope"
	}
	if _, ok := giftAnimationTypes[animationType]; !ok {
		return nil, ErrGiftAnimationInvalid
	}

	mediaURL := strings.TrimSpace(req.Media.URL)
	mediaType := normalizeGiftMediaType(req.Media.Type)
	if mediaURL != "" {
		if mediaType == "" {
			mediaType = inferGiftMediaTypeFromURL(mediaURL)
		}
		if mediaType == "" {
			return nil, ErrGiftMediaTypeInvalid
		}
		if !isHTTPURL(mediaURL) {
			if s.uploader == nil {
				return nil, ErrGiftMediaURLInvalid
			}
			key, ok := s.uploader.KeyFromPublicURL(mediaURL)
			if !ok || strings.TrimSpace(key) == "" {
				return nil, ErrGiftMediaURLInvalid
			}
			mediaURL = s.uploader.PublicURL(key)
		}
	} else {
		mediaType = ""
	}

	wishes, err := normalizeGiftWishes(req.Wishes)
	if err != nil {
		return nil, err
	}
	if animationType == "collective" && len(wishes) == 0 {
		wishes = append(wishes, dto.GiftWish{
			Author: fromName,
			Text:   message,
		})
	}
	wishesJSONBytes, _ := json.Marshal(wishes)
	wishesJSON := string(wishesJSONBytes)

	customCode := normalizeGiftCode(req.Code)
	now := time.Now().UTC()
	if customCode != "" {
		if !isGiftCodeValid(customCode) {
			return nil, ErrGiftCodeInvalid
		}
		if isGiftCodeReserved(customCode) {
			return nil, ErrGiftCodeReserved
		}
		existing, lookupErr := s.repo.GetByCodeAny(ctx, customCode)
		if lookupErr != nil && !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return nil, lookupErr
		}
		if lookupErr == nil && existing != nil {
			if existing.ExpiresAt.After(now) {
				return nil, &GiftCodeTakenError{ExpiresAt: existing.ExpiresAt}
			}
			if delErr := s.repo.DeleteExpiredByCode(ctx, customCode); delErr != nil {
				return nil, delErr
			}
		}

		created, createErr := s.createByCode(ctx, customCode, toName, fromName, message, openLine, uiLanguage, animationType, mediaURL, mediaType, wishesJSON)
		if createErr == nil {
			return created, nil
		}
		if isGiftDuplicateError(createErr) {
			retryRow, retryErr := s.repo.GetByCodeAny(ctx, customCode)
			if retryErr == nil && retryRow != nil && retryRow.ExpiresAt.After(now) {
				return nil, &GiftCodeTakenError{ExpiresAt: retryRow.ExpiresAt}
			}
		}
		return nil, createErr
	}

	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		code, genErr := generateGiftCode()
		if genErr != nil {
			return nil, genErr
		}
		if isGiftCodeReserved(code) {
			continue
		}
		row, createErr := s.repo.Create(
			ctx,
			code,
			toName,
			fromName,
			message,
			openLine,
			uiLanguage,
			animationType,
			mediaURL,
			mediaType,
			wishesJSON,
		)
		if createErr == nil {
			return giftFromRow(row)
		}
		if isGiftDuplicateError(createErr) {
			lastErr = createErr
			continue
		}
		return nil, createErr
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("failed to create gift")
}

func (s *GiftService) GetByCode(ctx context.Context, code string) (*dto.GiftCardResponse, error) {
	code = strings.TrimSpace(strings.ToLower(code))
	if code == "" {
		return nil, ErrGiftNotFound
	}
	row, err := s.repo.GetActiveByCode(ctx, code)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrGiftNotFound
		}
		return nil, err
	}
	return giftFromRow(row)
}
