package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
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
