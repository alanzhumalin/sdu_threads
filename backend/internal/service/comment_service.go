package service

import (
	"context"
	"errors"
	"strings"

	"sduthreads/internal/dto"
	"sduthreads/internal/models"
	"sduthreads/internal/moderation"
	"sduthreads/internal/repository"
)

type CommentService struct {
	comments *repository.CommentRepository
	posts    *repository.PostRepository
	likes    *repository.LikeRepository
	users    *repository.UserRepository
	tags     *repository.HashtagRepository
	mod      *moderation.Client
}

func NewCommentService(comments *repository.CommentRepository, posts *repository.PostRepository, likes *repository.LikeRepository, users *repository.UserRepository, tags *repository.HashtagRepository, mod *moderation.Client) *CommentService {
	return &CommentService{comments: comments, posts: posts, likes: likes, users: users, tags: tags, mod: mod}
}

func normalizeTagsLocal(raw []string) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0, len(raw))
	for _, t := range raw {
		t = strings.TrimSpace(strings.TrimPrefix(t, "#"))
		t = strings.ToLower(t)
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}

func (s *CommentService) Create(ctx context.Context, postID, userID string, body string, replyTo *string, hashtags []string) (*models.Comment, error) {
	if postID == "" || userID == "" {
		return nil, errors.New("post_id and user_id are required")
	}
	if len(body) == 0 {
		return nil, errors.New("content is required")
	}
	preview := strings.TrimSpace(body)
	if len(preview) > 160 {
		preview = preview[:160] + "..."
	}
	if err := s.mod.CheckText(ctx, body, "comment_text", &moderation.AuditMeta{
		ActorUserID: userID,
		Action:      "create_comment",
		TargetType:  "post",
		TargetID:    postID,
		Payload: map[string]any{
			"content_preview": preview,
		},
	}); err != nil {
		return nil, err
	}
	exists, err := s.posts.Exists(ctx, postID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, errors.New("post not found")
	}
	comment := models.Comment{
		PostID:           postID,
		UserID:           userID,
		Body:             body,
		ReplyToCommentID: replyTo,
	}
	if err := s.comments.Create(ctx, &comment); err != nil {
		return nil, err
	}
	// upsert hashtags mentioned in comment text
	if s.tags != nil {
		_ = func() error {
			cands := normalizeTagsLocal(hashtags)
			if len(cands) == 0 {
				return nil
			}
			_, err := s.tags.Upsert(ctx, cands)
			return err
		}()
	}
	return &comment, nil
}

func (s *CommentService) List(ctx context.Context, postID string, limit, offset int, viewerID string) ([]dto.CommentResponse, error) {
	items, err := s.comments.ListByPost(ctx, postID, limit, offset, viewerID)
	if err != nil {
		return nil, err
	}
	resp := make([]dto.CommentResponse, 0, len(items))
	for _, c := range items {
		mentions := []string{}
		hashtags := []string{}
		if s.users != nil {
			if allowed, err := filterExistingUsernames(ctx, s.users, extractMentionCandidates(c.Body)); err == nil && len(allowed) > 0 {
				for u := range allowed {
					mentions = append(mentions, u)
				}
			}
		}
		if s.tags != nil {
			if allowed, err := filterExistingHashtags(ctx, s.tags, extractHashtagCandidates(c.Body)); err == nil && len(allowed) > 0 {
				for t := range allowed {
					hashtags = append(hashtags, t)
				}
			}
		}
		resp = append(resp, dto.CommentResponse{
			ID:               c.ID,
			PostID:           c.PostID,
			UserID:           c.UserID,
			Username:         c.Username,
			FullName:         c.FullName,
			IsVerified:       c.IsVerified,
			AvatarURL:        c.AvatarURL,
			Body:             c.Body,
			CreatedAt:        c.CreatedAt,
			LikedByMe:        c.LikedByMe,
			LikeCount:        c.LikeCount,
			RepliesCount:     c.RepliesCount,
			ReplyToCommentID: c.ReplyToCommentID,
			ReplyToFullName:  c.ReplyToFullName,
			ReplyToUsername:  c.ReplyToUsername,
			Replies:          []dto.CommentResponse{},
			Mentions:         mentions,
			Hashtags:         hashtags,
		})
	}
	return resp, nil
}

func (s *CommentService) ListReplies(ctx context.Context, commentID string, limit, offset int, viewerID string) ([]dto.CommentResponse, error) {
	items, err := s.comments.ListReplies(ctx, commentID, limit, offset, viewerID)
	if err != nil {
		return nil, err
	}
	resp := make([]dto.CommentResponse, 0, len(items))
	for _, c := range items {
		mentions := []string{}
		hashtags := []string{}
		if s.users != nil {
			if allowed, err := filterExistingUsernames(ctx, s.users, extractMentionCandidates(c.Body)); err == nil && len(allowed) > 0 {
				for u := range allowed {
					mentions = append(mentions, u)
				}
			}
		}
		if s.tags != nil {
			if allowed, err := filterExistingHashtags(ctx, s.tags, extractHashtagCandidates(c.Body)); err == nil && len(allowed) > 0 {
				for t := range allowed {
					hashtags = append(hashtags, t)
				}
			}
		}
		resp = append(resp, dto.CommentResponse{
			ID:               c.ID,
			PostID:           c.PostID,
			UserID:           c.UserID,
			Username:         c.Username,
			FullName:         c.FullName,
			IsVerified:       c.IsVerified,
			AvatarURL:        c.AvatarURL,
			Body:             c.Body,
			CreatedAt:        c.CreatedAt,
			LikedByMe:        c.LikedByMe,
			LikeCount:        c.LikeCount,
			RepliesCount:     c.RepliesCount,
			ReplyToCommentID: c.ReplyToCommentID,
			ReplyToFullName:  c.ReplyToFullName,
			ReplyToUsername:  c.ReplyToUsername,
			Replies:          []dto.CommentResponse{},
			Mentions:         mentions,
			Hashtags:         hashtags,
		})
	}
	return resp, nil
}

func (s *CommentService) Delete(ctx context.Context, commentID, userID string) error {
	if commentID == "" || userID == "" {
		return errors.New("comment_id and user_id are required")
	}
	ok, err := s.comments.DeleteIfOwner(ctx, commentID, userID)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("not found or not owner")
	}
	return nil
}

func (s *CommentService) Like(ctx context.Context, commentID, userID string) (bool, error) {
	if commentID == "" || userID == "" {
		return false, errors.New("comment_id and user_id are required")
	}
	alreadyLiked, err := s.likes.CommentLikedBy(ctx, commentID, userID)
	if err != nil {
		return false, err
	}
	if alreadyLiked {
		return false, nil
	}
	if err := s.likes.AddComment(ctx, commentID, userID); err != nil {
		return false, err
	}
	return true, nil
}

func (s *CommentService) Unlike(ctx context.Context, commentID, userID string) error {
	if commentID == "" || userID == "" {
		return errors.New("comment_id and user_id are required")
	}
	return s.likes.RemoveComment(ctx, commentID, userID)
}

type CommentNotificationMeta struct {
	CommentID        string
	PostID           string
	AuthorID         string
	Body             string
	ReplyToCommentID *string
}

func (s *CommentService) MetaByID(ctx context.Context, commentID string) (*CommentNotificationMeta, error) {
	row, err := s.comments.MetaByID(ctx, commentID)
	if err != nil {
		return nil, err
	}
	return &CommentNotificationMeta{
		CommentID:        row.ID,
		PostID:           row.PostID,
		AuthorID:         row.UserID,
		Body:             row.Body,
		ReplyToCommentID: row.ReplyToCommentID,
	}, nil
}

func (s *CommentService) PostMetaByID(ctx context.Context, postID string) (*repository.PostMeta, error) {
	if strings.TrimSpace(postID) == "" {
		return nil, errors.New("post_id is required")
	}
	return s.posts.MetaByID(ctx, postID)
}

func (s *CommentService) UserIdentity(ctx context.Context, userID string) (fullName string, username string) {
	userID = strings.TrimSpace(userID)
	if userID == "" || s.users == nil {
		return "", ""
	}
	u, err := s.users.GetByID(ctx, userID)
	if err != nil || u == nil {
		return "", ""
	}
	return strings.TrimSpace(u.FullName), strings.TrimSpace(u.Username)
}

func (s *CommentService) ResolveMentionRecipients(ctx context.Context, text string, excludeUserID string) ([]MentionRecipient, error) {
	return resolveMentionRecipients(ctx, s.users, text, excludeUserID)
}
