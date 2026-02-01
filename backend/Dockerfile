ARG GO_VERSION=1.25

FROM golang:${GO_VERSION}-alpine AS builder
WORKDIR /app

# Install minimal tools (ca-certificates for HTTPS fetch, tzdata for logging)
RUN apk add --no-cache ca-certificates tzdata

# Download dependencies first for better layer caching
COPY go.mod ./
# go.sum may not exist yet in the skeleton; go mod download will create it when deps appear
RUN go mod download || true

# Copy source
COPY . .

# Build static binary for Linux (host architecture)
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/app ./cmd

# Runtime image
FROM alpine:3.19
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -g '' appuser

COPY --from=builder /bin/app /usr/local/bin/app
COPY --from=builder /app/internal/db/migrations /app/internal/db/migrations

EXPOSE 8080
USER appuser
ENTRYPOINT ["/usr/local/bin/app"]
