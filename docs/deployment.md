# CI/CD & Deployment

## Pipeline

Defined in `.gitlab-ci.yml`, three stages:

| Stage    | Jobs                                                                 | Trigger                            |
|----------|----------------------------------------------------------------------|------------------------------------|
| `test`   | `backend_lint`, `backend_test`, `frontend_test`, `e2e_test`          | Every push (all branches)          |
| `build`  | `build` (Docker images)                                              | `develop` branch or `v*` tag only  |
| `deploy` | `deploy_dev` (auto on `develop`), `deploy_prod` (auto on tag), `stop_dev` (manual) | After `build`                      |

### Test jobs

- `backend_test` (`golang:1.24.7-alpine`): `cd server && go test ./...` and builds the static Linux binary `e2e_test` runs.
- `frontend_test` (`node:20-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
- `e2e_test` (`mcr.microsoft.com/playwright:v1.52.0-jammy`): runs the server binary, runs Playwright as
  4 parallel shards; `needs: [backend_test]` for that binary and nothing else.
- `backend_lint` (`golangci/golangci-lint:v1.64-alpine`): `cd server && golangci-lint run ./...`.

`build` **needs all four**. `needs` is what actually gates a deploy: naming only `backend_test` and
`frontend_test` let the build start as soon as those two finished, which made the lint and the whole
Playwright suite advisory — red on `develop` still shipped to dev, and a version tag still shipped to
prod.

`build` and `deploy` jobs require the `devops` runner tag and the GitLab container registry.

### Pipeline speed

E2E dominates the wall clock. Every second cut out of it comes from dead time, never from coverage:
nothing is skipped, no gate is loosened, no reaction window is shortened.

| Change | Why |
|---|---|
| `parallel: 4` + `--shard=$CI_NODE_INDEX/$CI_NODE_TOTAL` | The suite is stateful, so `workers` stays at 1 *inside* a job; sharding is what parallelises it. `fullyParallel: true` is what makes the split even — left false, Playwright shards whole spec files and 87 tests came out 27/39/0/21. |
| `server-bin` built once by `backend_test`, handed over by cache | `e2e_test` used to download a 70 MB Go toolchain onto an image with no Go and rebuild the same binary, once per shard. Cache rather than artifact: see below. |
| No `playwright install` | The pinned image ships the browsers. Bump the image and the dependency together. |
| Go + npm caches under `$CI_PROJECT_DIR` | GitLab only caches paths inside the project. Keys are per job family; the shards key on `$CI_NODE_INDEX` so four jobs don't race on one cache upload. |
| `e2e_test needs: [backend_test]` only | It consumes nothing from `frontend_test`, so naming it just parked the longest job behind the second-longest. `build` still needs every test job, so nothing red ships. |
| `LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS` | Bot think time is dead time nothing races. Catch, LOCO! declaration and interrupt delays keep their shipped values — tests are meant to be able to win those races. |

**The sharding has a prerequisite outside the repository**: the runner must accept concurrent jobs
(`concurrent > 1` in its `config.toml`). At `concurrent = 1` the four shards queue behind each other
and pay four setups for one suite, which is slower than not sharding at all.

### The runner cannot upload artifacts

`.gitlab-ci.yml` uses no `artifacts:` block anywhere, and that is a workaround, not a preference.
The upload helper posts to GitLab's own external URL, `http://gitlab`, and resolves it against the
LAN DNS, which does not know that name:

```
POST against http://gitlab/api/v4/jobs/<id>/artifacts …
dial tcp: lookup gitlab on 192.168.1.254:53: no such host
FATAL: invalid argument       →  ERROR: Job failed: exit code 1
```

A failed upload **fails the job**, so a single `artifacts:` line turns a run where all 87 E2E tests
passed into a red pipeline. The limitation predates the speed work: `e2e_test` rebuilt the Go
binary in-job under a comment reading "no artifact transfer needed", and it only surfaced when a job
first tried to publish one.

Consequences, and how to undo them:

- `server-bin` is passed to `e2e_test` **through the cache**, which is a tarball on the runner's own
  disk and needs no API call. Keyed per branch (a per-commit key leaves a ~15 MB cache volume behind
  on every push, and nothing collects those); a `server-bin.sha` stamp makes `e2e_test` rebuild
  unless the cached binary was built from the commit under test, which also covers two pipelines
  racing on one branch.
- The JUnit report and Playwright's traces and screenshots are **written but not collected**. The
  `artifacts:` block sits commented out at the end of `e2e_test`.

**The fix is on the runner, in one line of its `config.toml`**: `extra_hosts = ["gitlab:<ip>"]`,
or putting the runner on GitLab's Docker network, or re-registering it against the FQDN so
`CI_SERVER_URL` is publicly resolvable. Then uncomment the block; nothing else has to change.

### GitHub mirror

The `gh` remote is a plain mirror and has no pipeline of its own: `.gitlab-ci.yml` is the single CI
definition, so there is nothing to keep in sync. A commit pushed to the mirror is verified by the run
it got on GitLab.

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
