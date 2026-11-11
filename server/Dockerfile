# The game server.
#
# A static musl binary on distroless: no shell, no package manager, no wget.
# The healthcheck is therefore the binary itself (`loco-server healthcheck`),
# and the image runs as distroless's nonroot user, uid 65532, which is why
# the deploy chowns ${DATA_DIR}/snapshots/${DEPLOY_ENV} to it
# (docs/deployment.md).

FROM rust:1.97-alpine AS builder

# ring (rustls's crypto) compiles a little C; musl-dev is what makes the
# result static.
RUN apk add --no-cache musl-dev gcc

WORKDIR /app
COPY . .
RUN cargo build --release --locked -p loco-server \
    && cp target/release/loco-server /loco-server \
    && mkdir -p /rootfs/data

FROM gcr.io/distroless/static:nonroot

COPY --from=builder /loco-server /loco-server
# /data is created here and owned by the runtime uid, because a container that
# cannot write its snapshot loses every match in flight on the next deploy. A
# bind mount overrides it, which is why the deploy chowns the host path too.
COPY --from=builder --chown=65532:65532 /rootfs/data /data

USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD ["/loco-server", "healthcheck"]
ENTRYPOINT ["/loco-server"]
