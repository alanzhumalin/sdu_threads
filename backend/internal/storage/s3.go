package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var ErrDisabled = errors.New("media storage is not configured")

type S3Uploader struct {
	c          *minio.Client
	bucket     string
	publicBase string
	prefix     string
	sigVersion string
}

type S3Config struct {
	Endpoint      string
	Region        string
	Bucket        string
	AccessKey     string
	SecretKey     string
	UseSSL        bool
	PublicBaseURL string
	Prefix        string
	// SignatureVersion: v4 (default) or v2.
	SignatureVersion string
}

func NewS3Uploader(cfg S3Config) (*S3Uploader, error) {
	if strings.TrimSpace(cfg.Endpoint) == "" ||
		strings.TrimSpace(cfg.Bucket) == "" ||
		strings.TrimSpace(cfg.AccessKey) == "" ||
		strings.TrimSpace(cfg.SecretKey) == "" ||
		strings.TrimSpace(cfg.PublicBaseURL) == "" {
		return nil, ErrDisabled
	}

	endpoint := strings.TrimSpace(cfg.Endpoint)
	// MinIO client expects host[:port] without scheme; accept both.
	if strings.Contains(endpoint, "://") {
		if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
			endpoint = u.Host
		} else if err != nil {
			return nil, fmt.Errorf("invalid S3_ENDPOINT: %w", err)
		} else {
			return nil, fmt.Errorf("invalid S3_ENDPOINT: %s", endpoint)
		}
	}
	// Some S3-compatible gateways are picky about default ports in Host header.
	if host, port, err := net.SplitHostPort(endpoint); err == nil {
		if (cfg.UseSSL && port == "443") || (!cfg.UseSSL && port == "80") {
			endpoint = host
		}
	}

	publicBase := strings.TrimRight(strings.TrimSpace(cfg.PublicBaseURL), "/")
	if _, err := url.Parse(publicBase); err != nil {
		return nil, fmt.Errorf("invalid S3_PUBLIC_BASE_URL: %w", err)
	}

	sig := strings.ToLower(strings.TrimSpace(cfg.SignatureVersion))
	if sig == "" {
		sig = "v4"
	}
	var creds *credentials.Credentials
	switch sig {
	case "v2":
		creds = credentials.NewStaticV2(strings.TrimSpace(cfg.AccessKey), strings.TrimSpace(cfg.SecretKey), "")
	case "v4":
		creds = credentials.NewStaticV4(strings.TrimSpace(cfg.AccessKey), strings.TrimSpace(cfg.SecretKey), "")
	default:
		return nil, fmt.Errorf("invalid S3_SIGNATURE_VERSION: %q (expected v2 or v4)", cfg.SignatureVersion)
	}

	client, err := minio.New(endpoint, &minio.Options{
		Creds:        creds,
		Secure:       cfg.UseSSL,
		Region:       strings.TrimSpace(cfg.Region),
		BucketLookup: minio.BucketLookupPath, // Swift/Ceph gateways usually expect path-style.
	})
	if err != nil {
		return nil, err
	}

	prefix := strings.Trim(strings.TrimSpace(cfg.Prefix), "/")
	return &S3Uploader{
		c:          client,
		bucket:     strings.TrimSpace(cfg.Bucket),
		publicBase: publicBase,
		prefix:     prefix,
		sigVersion: sig,
	}, nil
}

func (u *S3Uploader) Put(ctx context.Context, objectKey string, r io.Reader, size int64, contentType string) (string, error) {
	if u == nil {
		return "", ErrDisabled
	}
	key := strings.TrimLeft(objectKey, "/")
	if key == "" {
		return "", errors.New("object key is required")
	}
	_, err := u.c.PutObject(ctx, u.bucket, key, r, size, minio.PutObjectOptions{
		ContentType: strings.TrimSpace(contentType),
	})
	if err != nil {
		return "", err
	}
	return u.PublicURL(key), nil
}

func (u *S3Uploader) PublicURL(objectKey string) string {
	key := strings.TrimLeft(objectKey, "/")
	return u.publicBase + "/" + u.bucket + "/" + key
}

func (u *S3Uploader) KeyPrefix(purpose, userID string) string {
	base := path.Join(u.prefix, strings.Trim(purpose, "/"), strings.Trim(userID, "/"))
	return strings.Trim(base, "/")
}

func (u *S3Uploader) BuildKey(purpose, userID, ext string) string {
	now := time.Now().UTC()
	ext = strings.TrimLeft(strings.ToLower(ext), ".")
	if ext == "" {
		ext = "bin"
	}
	base := path.Join(
		u.prefix,
		strings.Trim(purpose, "/"),
		userID,
		fmt.Sprintf("%04d/%02d/%02d", now.Year(), now.Month(), now.Day()),
	)
	return path.Join(base, fmt.Sprintf("%d.%s", now.UnixNano(), ext))
}

type ObjectStat struct {
	Size        int64
	ContentType string
}

func (u *S3Uploader) Stat(ctx context.Context, objectKey string) (ObjectStat, error) {
	if u == nil {
		return ObjectStat{}, ErrDisabled
	}
	key := strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if key == "" {
		return ObjectStat{}, errors.New("object key is required")
	}
	info, err := u.c.StatObject(ctx, u.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return ObjectStat{}, err
	}
	return ObjectStat{Size: info.Size, ContentType: info.ContentType}, nil
}

func (u *S3Uploader) Get(ctx context.Context, objectKey string) (io.ReadCloser, ObjectStat, error) {
	if u == nil {
		return nil, ObjectStat{}, ErrDisabled
	}
	key := strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if key == "" {
		return nil, ObjectStat{}, errors.New("object key is required")
	}
	obj, err := u.c.GetObject(ctx, u.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, ObjectStat{}, err
	}
	info, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		return nil, ObjectStat{}, err
	}
	return obj, ObjectStat{Size: info.Size, ContentType: info.ContentType}, nil
}

func (u *S3Uploader) Remove(ctx context.Context, objectKey string) error {
	if u == nil {
		return ErrDisabled
	}
	key := strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if key == "" {
		return errors.New("object key is required")
	}
	return u.c.RemoveObject(ctx, u.bucket, key, minio.RemoveObjectOptions{})
}

// KeyFromPublicURL extracts the object key from a public URL produced by PublicURL().
func (u *S3Uploader) KeyFromPublicURL(raw string) (string, bool) {
	if u == nil {
		return "", false
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	// Drop query/fragment (defensive).
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	prefix := u.publicBase + "/" + u.bucket + "/"
	if !strings.HasPrefix(raw, prefix) {
		return "", false
	}
	key := strings.TrimLeft(strings.TrimPrefix(raw, prefix), "/")
	if key == "" {
		return "", false
	}
	return key, true
}

type PresignedPost struct {
	URL     string            `json:"upload_url"`
	Fields  map[string]string `json:"fields"`
	Key     string            `json:"key"`
	Public  string            `json:"url"`
	Expires int64             `json:"expires_unix"`
}

// PresignPost returns a presigned POST policy (URL + fields) for browser upload.
// Storage will enforce maxBytes via content-length-range, and the exact contentType.
func (u *S3Uploader) PresignPost(ctx context.Context, objectKey string, contentType string, maxBytes int64, ttl time.Duration) (*PresignedPost, error) {
	if u == nil {
		return nil, ErrDisabled
	}
	key := strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if key == "" {
		return nil, errors.New("object key is required")
	}
	ct := strings.TrimSpace(contentType)
	if ct == "" {
		return nil, errors.New("content type is required")
	}
	if maxBytes <= 0 {
		return nil, errors.New("maxBytes must be positive")
	}
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}

	policy := minio.NewPostPolicy()
	if err := policy.SetBucket(u.bucket); err != nil {
		return nil, err
	}
	if err := policy.SetKey(key); err != nil {
		return nil, err
	}
	exp := time.Now().UTC().Add(ttl)
	if err := policy.SetExpires(exp); err != nil {
		return nil, err
	}
	// Allow empty files? no. Enforce at least 1 byte.
	if err := policy.SetContentLengthRange(1, maxBytes); err != nil {
		return nil, err
	}
	if err := policy.SetContentType(ct); err != nil {
		return nil, err
	}

	upl, fields, err := u.c.PresignedPostPolicy(ctx, policy)
	if err != nil {
		return nil, err
	}
	if upl == nil {
		return nil, errors.New("presign failed: nil url")
	}

	return &PresignedPost{
		URL:     upl.String(),
		Fields:  fields,
		Key:     key,
		Public:  u.PublicURL(key),
		Expires: exp.Unix(),
	}, nil
}

type PresignedPut struct {
	URL     string            `json:"upload_url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers,omitempty"`
	Key     string            `json:"key"`
	Public  string            `json:"url"`
	Expires int64             `json:"expires_unix"`
}

// PresignPut returns a presigned PUT URL for direct browser upload.
//
// Note: With Signature V2, extra signed headers are not supported by minio-go;
// we still return Content-Type in Headers for best-effort metadata.
func (u *S3Uploader) PresignPut(ctx context.Context, objectKey string, contentType string, ttl time.Duration) (*PresignedPut, error) {
	if u == nil {
		return nil, ErrDisabled
	}
	key := strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if key == "" {
		return nil, errors.New("object key is required")
	}
	ct := strings.TrimSpace(contentType)
	if ct == "" {
		return nil, errors.New("content type is required")
	}
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}

	exp := time.Now().UTC().Add(ttl)

	// For SigV4 we can sign Content-Type header, which makes browser uploads safer.
	var (
		upl *url.URL
		err error
	)
	var headers map[string]string
	if u.sigVersion == "v4" {
		hdr := make(http.Header)
		hdr.Set("Content-Type", ct)
		upl, err = u.c.PresignHeader(ctx, http.MethodPut, u.bucket, key, ttl, nil, hdr)
		headers = map[string]string{"Content-Type": ct}
	} else {
		upl, err = u.c.PresignedPutObject(ctx, u.bucket, key, ttl)
	}
	if err != nil {
		return nil, err
	}
	if upl == nil {
		return nil, errors.New("presign failed: nil url")
	}

	return &PresignedPut{
		URL:     upl.String(),
		Method:  http.MethodPut,
		Headers: headers,
		Key:     key,
		Public:  u.PublicURL(key),
		Expires: exp.Unix(),
	}, nil
}
