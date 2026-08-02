FROM golang:1.26.5-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o loco-server .

FROM alpine:3.23

RUN apk add --no-cache ca-certificates

# The server ran as root. It needs no privilege at all: it binds :8080 (above
# 1024), reads no system path, and writes exactly one file, the shutdown
# snapshot under /data. So it drops to an unprivileged account, and /data is
# chowned here rather than at runtime because a container that cannot write its
# snapshot loses every match in flight on the next deploy.
RUN addgroup -g 10001 -S loco \
    && adduser -u 10001 -S -G loco loco \
    && mkdir -p /data \
    && chown loco:loco /data

WORKDIR /app
COPY --from=builder /app/loco-server .

USER loco:loco

EXPOSE 8080

CMD ["./loco-server"]
