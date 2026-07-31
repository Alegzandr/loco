# CI/CD & Deployment

## Pipeline

Defined in `.gitlab-ci.yml`, three stages:

| Stage    | Jobs                                                                 | Trigger                            |
|----------|----------------------------------------------------------------------|------------------------------------|
| `test`   | `backend_lint`, `backend_test`, `frontend_test`, `e2e_test`          | Every push (all branches)          |
| `build`  | `build` (Docker images)                                              | `develop` branch or `v*` tag only  |
| `deploy` | `deploy_dev` (auto on `develop`), `deploy_prod` (auto on tag), `stop_dev` (manual) | After `build`                      |

### Test jobs

- `backend_test` (`golang:1.24.7-alpine`): `cd server && go test ./...` and builds a static Linux binary as an artifact for `e2e_test`.
- `frontend_test` (`node:20-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
- `e2e_test` (`mcr.microsoft.com/playwright:v1.52.0-jammy`): runs the server binary, runs Playwright; `needs: [backend_test, frontend_test]`.
- `backend_lint` (`golangci/golangci-lint:v1.64-alpine`): `cd server && golangci-lint run ./...`.

`build` **needs all four**. `needs` is what actually gates a deploy: naming only `backend_test` and
`frontend_test` let the build start as soon as those two finished, which made the lint and the whole
Playwright suite advisory — red on `develop` still shipped to dev, and a version tag still shipped to
prod.

`build` and `deploy` jobs require the `devops` runner tag and the GitLab container registry.

### GitHub mirror

`.github/workflows/test.yml` runs the same four jobs on the GitHub remote (tests only, never a
deploy), so a push or a pull request there is not unverified. Two pipeline definitions drift; change
both.

## Production request path

```
Browser (HTTPS) → Traefik (:443, entrypoint websecure)
  → client nginx (:80, networks: traefik + internal)
    → /ws     → Go server (:8080, network: internal only)   [WebSocket]
    → /health → Go server (:8080)                            [health probe]
    → /       → nginx serves static SPA files directly
```

- Traefik terminates TLS and routes all traffic to the nginx container on port 80.
- nginx bridges the `traefik` and `internal` Docker networks; the Go server is isolated on `internal` and is never directly reachable by Traefik.
- The Go server container exposes port 8080 internally (`expose`, not `ports`).

## Production readiness

- The `server` service in `deploy/compose.yml` has a healthcheck (`GET /health`, 10 s interval, 5 s timeout, 3 retries, 5 s start period).
- The `client` service waits for `server` to be `healthy` before starting (`condition: service_healthy`), preventing nginx from routing to a not-yet-listening Go server.
- Compose-interpolation variables (`DEPLOY_ENV`, `APP_HOST`, `IMAGE_TAG`, `CI_REGISTRY_IMAGE`) are written to `app.env` by `write_app_env` and loaded via `--env-file app.env`, so a manual `docker compose up` on the server works without CI shell exports.
- Dev hosts (`*-d.<domain>`) serve `robots.txt` with `Disallow: /`; production hosts allow indexing.
- nginx WebSocket timeouts: `proxy_connect_timeout 10s`, `proxy_read_timeout 86400s`, `proxy_send_timeout 86400s`.
- nginx sends security headers on every response (`always`): a closed CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`. The client is built for it — self-hosted fonts, no CDN, no
  remote anything — so the only relaxations are `style-src 'unsafe-inline'` (the pre-hydration
  `<style>` block plus framer-motion's inline styles) and an explicit `ws://$host wss://$host` in
  `connect-src`, since a page on `http://` and a socket on `ws://` are different CSP origins.
- The Go server checks the `Origin` header on the WebSocket upgrade. By default the Origin's hostname
  must match the request's (ports ignored, so the dev client on :5173 reaches :8080); set
  `LOCO_ALLOWED_ORIGINS` to an exact comma-separated list to narrow it further.
