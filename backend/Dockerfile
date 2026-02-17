ARG GO_VERSION=1.25

FROM golang:${GO_VERSION}-alpine AS builder
WORKDIR /app

# Tools + build deps for CGO + libwebp headers
RUN apk add --no-cache \
    ca-certificates tzdata \
    gcc musl-dev pkgconf \
    libwebp-dev

# Download dependencies first for better layer caching
COPY go.mod ./
COPY go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build Linux binary WITH CGO (needed for libwebp)
RUN CGO_ENABLED=1 GOOS=linux go build -o /bin/app ./cmd

# Runtime image
FROM alpine:3.19
WORKDIR /app

# Runtime deps: certs/tz + libwebp shared library + ffmpeg for post music clipping
RUN apk add --no-cache ca-certificates tzdata libwebp ffmpeg && \
    adduser -D -g '' appuser

COPY --from=builder /bin/app /usr/local/bin/app
COPY --from=builder /app/internal/db/migrations /app/internal/db/migrations

EXPOSE 8080
USER appuser
ENTRYPOINT ["/usr/local/bin/app"]
