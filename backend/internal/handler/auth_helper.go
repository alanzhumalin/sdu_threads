package handler

import (
	"errors"
	"net/http"
	"strings"

	"sduthreads/internal/auth"
)

func requireUserID(r *http.Request, jwtMgr *auth.JWTManager) (string, error) {
	header := r.Header.Get("Authorization")
	if header == "" || !strings.HasPrefix(header, "Bearer ") {
		return "", errors.New("missing bearer token")
	}
	token := strings.TrimPrefix(header, "Bearer ")
	claims, err := jwtMgr.Parse(token)
	if err != nil {
		return "", errors.New("invalid token")
	}
	return claims.UserID, nil
}

func tryGetUserID(r *http.Request, jwtMgr *auth.JWTManager) (string, error) {
	header := r.Header.Get("Authorization")
	if header == "" || !strings.HasPrefix(header, "Bearer ") {
		return "", errors.New("no token")
	}
	token := strings.TrimPrefix(header, "Bearer ")
	claims, err := jwtMgr.Parse(token)
	if err != nil {
		return "", err
	}
	return claims.UserID, nil
}
