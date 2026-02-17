package service

import (
	"errors"
	"strings"

	"sduthreads/internal/dto"
	"sduthreads/internal/repository"
)

var (
	ErrReactionEmojiRequired    = errors.New("emoji is required")
	ErrReactionEmojiInvalid     = errors.New("invalid emoji")
	ErrReactionEmojiUnsupported = errors.New("unsupported emoji reaction")
)

var allowedReactionEmojis = map[string]struct{}{
	"😀":  {},
	"😁":  {},
	"😂":  {},
	"🤣":  {},
	"😊":  {},
	"😍":  {},
	"🥰":  {},
	"😎":  {},
	"🤗":  {},
	"🤔":  {},
	"😴":  {},
	"🤯":  {},
	"🥳":  {},
	"😇":  {},
	"🙃":  {},
	"😌":  {},
	"😬":  {},
	"😅":  {},
	"🤩":  {},
	"😭":  {},
	"👍":  {},
	"👎":  {},
	"👏":  {},
	"🙌":  {},
	"🙏":  {},
	"🤝":  {},
	"💪":  {},
	"✌️": {},
	"🤞":  {},
	"👌":  {},
	"👀":  {},
	"🤍":  {},
	"❤️": {},
	"🔥":  {},
	"😮":  {},
	"😢":  {},
	"😡":  {},
	"💯":  {},
	"✨":  {},
	"🎉":  {},
	"🎯":  {},
	"✅":  {},
	"⚡":  {},
	"📌":  {},
	"📣":  {},
	"📸":  {},
	"🎵":  {},
	"🎬":  {},
	"🧠":  {},
	"💡":  {},
	"🛠️": {},
	"🧩":  {},
	"📱":  {},
	"💻":  {},
	"⌚":  {},
	"🎁":  {},
	"🏆":  {},
	"🌍":  {},
	"☀️": {},
	"🌙":  {},
	"⭐":  {},
	"🌈":  {},
	"❗":  {},
}

func normalizeReactionEmoji(raw string) (string, error) {
	emoji := strings.TrimSpace(raw)
	if emoji == "" {
		return "", ErrReactionEmojiRequired
	}
	if len([]rune(emoji)) > 16 {
		return "", ErrReactionEmojiInvalid
	}
	if _, ok := allowedReactionEmojis[emoji]; !ok {
		return "", ErrReactionEmojiUnsupported
	}
	return emoji, nil
}

func mapReactionItems(rows []repository.ReactionAggregate) []dto.ReactionItem {
	if len(rows) == 0 {
		return []dto.ReactionItem{}
	}
	out := make([]dto.ReactionItem, 0, len(rows))
	for _, row := range rows {
		emoji := strings.TrimSpace(row.Emoji)
		if emoji == "" || row.Count <= 0 {
			continue
		}
		out = append(out, dto.ReactionItem{
			Emoji:       emoji,
			Count:       row.Count,
			ReactedByMe: row.ReactedByMe,
		})
	}
	if len(out) == 0 {
		return []dto.ReactionItem{}
	}
	return out
}
