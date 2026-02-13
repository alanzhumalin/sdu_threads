package handler

import (
	"strings"

	"sduthreads/internal/moderation"
)

func moderationViolationPayload(viol *moderation.ViolationError) errorPayload {
	if viol == nil {
		return errorPayload{
			Code:    "CONTENT_BLOCKED",
			Message: "Контент не прошел модерацию. Измените его и попробуйте снова.",
		}
	}

	scope := strings.ToLower(strings.TrimSpace(viol.Scope))
	switch {
	case scope == "post_text" || scope == "comment_text" || strings.Contains(scope, "text"):
		return errorPayload{
			Code:    "TEXT_BLOCKED",
			Message: "Текст не прошел модерацию. Измените формулировку и попробуйте снова.",
		}
	case scope == "post_media" ||
		scope == "post_upload" ||
		scope == "avatar_image" ||
		scope == "avatar_upload" ||
		scope == "background_image" ||
		scope == "background_upload" ||
		strings.Contains(scope, "image") ||
		strings.Contains(scope, "media") ||
		strings.Contains(scope, "upload"):
		return errorPayload{
			Code:    "MEDIA_BLOCKED",
			Message: "Изображение не прошло модерацию. Выберите другое фото.",
		}
	default:
		return errorPayload{
			Code:    "CONTENT_BLOCKED",
			Message: "Контент не прошел модерацию. Измените его и попробуйте снова.",
		}
	}
}
