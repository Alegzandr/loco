# CI/CD & Deployment

## Pipeline

Defined in `.gitlab-ci.yml`, three stages:

| Stage    | Jobs                                                                 | Trigger                            |
|----------|----------------------------------------------------------------------|------------------------------------|
| `test`   | `backend_test`, `frontend_test`, `e2e_test`                          | Every push (all branches)          |
| `build`  | `build` (Docker images)                                              | `develop` branch or `v*` tag only  |
| `deploy` | `deploy_dev` (auto on `develop`), `deploy_prod` (auto on tag), `stop_dev` (manual) | After `build`                      |

### Test jobs

- `backend_test` (`golang:1.24.7-alpine`): `cd server && go test ./...` and builds a static Linux binary as an artifact for `e2e_test`.
- `frontend_test` (`node:20-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
- `e2e_test` (`mcr.microsoft.com/playwright:v1.52.0-jammy`): runs the server binary, runs Playwright; `needs: [backend_test, frontend_test]`.

`build` and `deploy` jobs require the `devops` runner tag and the GitLab container registry.

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
