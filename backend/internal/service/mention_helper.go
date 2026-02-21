package service

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"

	"gorm.io/gorm"
	"sduthreads/internal/repository"
)

var mentionToken = regexp.MustCompile(`@([\p{L}\p{N}._-]+)`)
var hashtagToken = regexp.MustCompile(`#([\p{L}\p{N}_-]+)`)

// extractMentionCandidates returns unique lowercase usernames mentioned in text.
func extractMentionCandidates(text string) []string {
	matches := mentionToken.FindAllStringSubmatch(text, -1)
	if matches == nil {
		return nil
	}
	set := make(map[string]struct{})
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		username := strings.ToLower(m[1])
		if username == "" {
			continue
		}
		set[username] = struct{}{}
	}
	out := make([]string, 0, len(set))
	for u := range set {
		out = append(out, u)
	}
	slices.Sort(out)
	return out
}

func extractHashtagCandidates(text string) []string {
	matches := hashtagToken.FindAllStringSubmatch(text, -1)
	if matches == nil {
		return nil
	}
	set := make(map[string]struct{})
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		tag := strings.ToLower(strings.TrimSpace(m[1]))
		if tag == "" {
			continue
		}
		set[tag] = struct{}{}
	}
	out := make([]string, 0, len(set))
	for t := range set {
		out = append(out, t)
	}
	slices.Sort(out)
	return out
}

// filterExistingHashtags returns lowercase hashtag names that exist in DB.
func filterExistingHashtags(ctx context.Context, tags *repository.HashtagRepository, names []string) (map[string]struct{}, error) {
	if len(names) == 0 {
		return map[string]struct{}{}, nil
	}
	return tags.Existing(ctx, names)
}

// filterExistingUsernames returns only usernames that exist.
func filterExistingUsernames(ctx context.Context, users *repository.UserRepository, usernames []string) (map[string]struct{}, error) {
	if len(usernames) == 0 {
		return map[string]struct{}{}, nil
	}
	return users.ExistingUsernames(ctx, usernames)
}

type MentionRecipient struct {
	UserID   string
	Username string
	FullName string
}

func resolveMentionRecipients(ctx context.Context, users *repository.UserRepository, text string, excludeUserID string) ([]MentionRecipient, error) {
	if users == nil {
		return []MentionRecipient{}, nil
	}
	candidates := extractMentionCandidates(text)
	if len(candidates) == 0 {
		return []MentionRecipient{}, nil
	}
	existing, err := filterExistingUsernames(ctx, users, candidates)
	if err != nil {
		return nil, err
	}
	out := make([]MentionRecipient, 0, len(candidates))
	seenIDs := make(map[string]struct{}, len(candidates))
	excludeUserID = strings.TrimSpace(excludeUserID)
	for _, username := range candidates {
		if _, ok := existing[username]; !ok {
			continue
		}
		u, err := users.GetByUsername(ctx, username)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return nil, err
		}
		if u == nil {
			continue
		}
		id := strings.TrimSpace(u.ID)
		if id == "" || id == excludeUserID {
			continue
		}
		if _, ok := seenIDs[id]; ok {
			continue
		}
		seenIDs[id] = struct{}{}
		out = append(out, MentionRecipient{
			UserID:   id,
			Username: strings.TrimSpace(u.Username),
			FullName: strings.TrimSpace(u.FullName),
		})
	}
	return out, nil
}
