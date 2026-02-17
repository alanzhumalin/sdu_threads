package repository

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"

	"sduthreads/internal/models"
)

type TelegramRepository struct {
	db *gorm.DB
}

func NewTelegramRepository(db *gorm.DB) *TelegramRepository {
	return &TelegramRepository{db: db}
}

func (r *TelegramRepository) CreateOrReplaceLinkCode(ctx context.Context, userID, code string, expiresAt time.Time) error {
	userID = strings.TrimSpace(userID)
	code = strings.TrimSpace(code)
	if userID == "" || code == "" {
		return gorm.ErrInvalidData
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&models.TelegramLinkCode{}).Error; err != nil {
			return err
		}
		row := models.TelegramLinkCode{
			Code:      code,
			UserID:    userID,
			ExpiresAt: expiresAt.UTC(),
		}
		return tx.Create(&row).Error
	})
}

func (r *TelegramRepository) ConsumeLinkCode(ctx context.Context, code string) (string, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return "", gorm.ErrRecordNotFound
	}

	var userID string
	const q = `
DELETE FROM telegram_link_codes
WHERE code = ? AND expires_at > now()
RETURNING user_id
`
	if err := r.db.WithContext(ctx).Raw(q, code).Scan(&userID).Error; err != nil {
		return "", err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", gorm.ErrRecordNotFound
	}
	return userID, nil
}

func (r *TelegramRepository) DeleteExpiredLinkCodes(ctx context.Context) error {
	return r.db.WithContext(ctx).
		Where("expires_at <= now()").
		Delete(&models.TelegramLinkCode{}).
		Error
}

func (r *TelegramRepository) UpsertLink(
	ctx context.Context,
	userID string,
	chatID int64,
	telegramUserID int64,
	telegramUsername string,
	telegramFirstName string,
) error {
	userID = strings.TrimSpace(userID)
	telegramUsername = strings.TrimSpace(telegramUsername)
	telegramFirstName = strings.TrimSpace(telegramFirstName)
	if userID == "" || chatID == 0 {
		return gorm.ErrInvalidData
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("telegram_chat_id = ? AND user_id <> ?", chatID, userID).
			Delete(&models.TelegramLink{}).Error; err != nil {
			return err
		}

		const q = `
INSERT INTO telegram_links
  (user_id, telegram_chat_id, telegram_user_id, telegram_username, telegram_first_name, enabled, created_at, updated_at)
VALUES
  (?::uuid, ?, ?, ?, ?, true, now(), now())
ON CONFLICT (user_id) DO UPDATE SET
  telegram_chat_id = EXCLUDED.telegram_chat_id,
  telegram_user_id = EXCLUDED.telegram_user_id,
  telegram_username = EXCLUDED.telegram_username,
  telegram_first_name = EXCLUDED.telegram_first_name,
  enabled = true,
  updated_at = now()
`
		return tx.Exec(
			q,
			userID,
			chatID,
			telegramUserID,
			telegramUsername,
			telegramFirstName,
		).Error
	})
}

func (r *TelegramRepository) GetLinkByUserID(ctx context.Context, userID string) (*models.TelegramLink, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, gorm.ErrRecordNotFound
	}

	var row models.TelegramLink
	if err := r.db.WithContext(ctx).Take(&row, "user_id = ?", userID).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *TelegramRepository) UnlinkByUserID(ctx context.Context, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	return r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Delete(&models.TelegramLink{}).
		Error
}

func (r *TelegramRepository) UnlinkByChatID(ctx context.Context, chatID int64) error {
	if chatID == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Where("telegram_chat_id = ?", chatID).
		Delete(&models.TelegramLink{}).
		Error
}
