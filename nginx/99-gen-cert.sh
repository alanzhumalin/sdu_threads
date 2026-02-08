#!/bin/sh
set -e

CERT_DIR="/etc/nginx/certs"
CERT_FILE="${CERT_DIR}/cert.pem"
KEY_FILE="${CERT_DIR}/key.pem"

mkdir -p "${CERT_DIR}"

if [ -s "${CERT_FILE}" ] && [ -s "${KEY_FILE}" ]; then
  echo "[nginx] TLS certs found in ${CERT_DIR}"
  exit 0
fi

echo "[nginx] TLS certs not found, generating self-signed cert for local/dev"

# Self-signed cert is only a fallback for local development.
# In production behind Cloudflare use an Origin Certificate mounted into /etc/nginx/certs.
openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -subj "/CN=localhost" \
  -keyout "${KEY_FILE}" \
  -out "${CERT_FILE}" >/dev/null 2>&1

chmod 600 "${KEY_FILE}" || true
chmod 644 "${CERT_FILE}" || true
