package service

import (
	"context"
	"regexp"
	"slices"
	"strings"

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
