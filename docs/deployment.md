# CI/CD & Deployment

## Pipeline

Defined in `.gitlab-ci.yml`, three stages:

| Stage    | Jobs                                                                 | Trigger                            |
|----------|----------------------------------------------------------------------|------------------------------------|
| `test`   | `backend_lint`, `backend_test`, `frontend_test`, `e2e_test`          | Every push (all branches)          |
| `build`  | `build` (Docker images)                                              | `develop` branch or `v*` tag only  |
| `deploy` | `deploy_dev` (auto on `develop`, manual if `DEPLOY_DEV != "true"`), `deploy_prod` (auto on tag), `stop_dev` (manual) | After `build`                      |

### `DEPLOY_DEV`

The one switch deciding whether a push to `develop` reaches `loco-d`. Declared in the global
`variables:` block with `options: ["true", "false"]`, so it is a dropdown in the *Run pipeline* form
as well as a project variable under Settings → CI/CD → Variables.

Off, `deploy_dev` becomes `when: manual` + `allow_failure: true` rather than vanishing: `build`
still runs and still pushes both images under `$CI_COMMIT_REF_SLUG`, so deploying afterwards is one
press on the pipeline instead of another push. That is the whole reason the gate sits on the deploy
job and not on `build` — a `rules:` block on `build` would also take `deploy_dev`'s images with it.

The condition is `$DEPLOY_DEV != "true"`, never `== "false"`. A variable someone typed `0`, `no` or
an empty string into must fall on the *safe* side of a switch whose only job is to stop a rollout.

Production ignores it entirely: `deploy_prod` keys on `$CI_COMMIT_TAG =~ /^v.*/` and nothing else.

### Test jobs

- `backend_test` (`golang:1.26.5-alpine`): `cd server && go test ./...` and builds the static Linux binary `e2e_test` runs.
- `frontend_test` (`node:24-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
- `e2e_test` (`mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy`): runs the server binary, runs
  Playwright as 4 parallel shards; `needs: [backend_test]` for that binary and nothing else.
- `backend_lint` (`golangci/golangci-lint:v2.12-alpine`): `cd server && golangci-lint run ./...`.

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
| No `playwright install` | The image ships the browsers, and only the ones its own Playwright needs. `PLAYWRIGHT_VERSION` is declared once, interpolated into the image tag, and asserted against the installed version before the suite runs; `@playwright/test` is pinned exactly. Bump the two together and commit the lockfile. |
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

## Hosts

| Environment | Host | Deployed by |
|-------------|------|-------------|
| Production  | `ohloco.com` | `deploy_prod`, on a `v*` tag |
| Development | `loco-d.kisukesaama.com` | `deploy_dev`, on `develop` |

Both are declared once, as `PROD_HOST` and `DEV_HOST` in the global `variables:` block of
`.gitlab-ci.yml`. Every job exports the right one into `APP_HOST`, `write_app_env` writes it to
`app.env`, and `deploy/compose.yml` interpolates it into the Traefik `Host()` rule.

`APP_SUBDOMAIN` is still `loco` and no longer has anything to do with the address. It names the stack
— the compose project, the Traefik router, the `internal` network, the directory under `DEPLOY_DIR` —
which is why production changing domain touched two variables and left every container name alone.
Do not derive one from the other in either direction.

The dev host must keep its `-d.` prefix: `client/nginx.conf` keys `robots.txt` on that pattern, and it
is the only thing keeping the dev deployment out of the index. See
[`docs/notes/seo.md`](notes/seo.md).

### The edge, in front of Traefik

DNS for `ohloco.com` is on Cloudflare, proxied. Three settings are load-bearing rather than
preferences:

- **SSL/TLS mode `Full (strict)`.** `Flexible` makes Cloudflare talk HTTP to an origin that redirects
  every HTTP request to HTTPS, which is an infinite redirect and takes the whole site down.
- **`www.ohloco.com` 301s to the apex, at the edge**, by a Cloudflare redirect rule. It never reaches
  Traefik, which is why `compose.yml` carries one `Host()` and not two. The apex is canonical
  everywhere — `VITE_PUBLIC_ORIGIN`, the sitemap, the `hreflang` sets — and a canonical naming a
  redirect is the failure nothing reports.
- **The origin certificate is a Cloudflare Origin Certificate, and there is no ACME anywhere.** The
  host's Traefik runs with no `certificatesResolvers` at all: certificates are files under
  `/etc/traefik/certs`, declared as `tls.certificates` pairs in its file provider, which watches the
  directory and reloads without a restart. `compose.yml` therefore asks for `tls=true` and names no
  resolver — **adding a `certresolver` label would name something that does not exist.**

  The consequence is the one that took production down the day it moved: **a new domain needs a new
  certificate posted by hand, and nothing in this repo can tell you it is missing.** Cloudflare in
  `Full (strict)` answers an origin serving Traefik's self-signed default with **error 526**, which is
  the symptom to recognise. One Origin Certificate per zone (`ohloco.com` + `*.ohloco.com`), an entry
  appended to the existing `certificates:` list, and Traefik picks the right one by SNI.

  These certificates are trusted by Cloudflare and by nothing else, so **the orange cloud is not
  optional**: a record turned DNS-only serves a certificate every browser rejects. In exchange they
  last 15 years and renew nothing.

### The socket is not behind the edge, and here is what that needs

`ws.ohloco.com` is **DNS-only** — a grey cloud, an `A` record straight to the origin — and it is the
only hostname in this stack that is. The reason is measured rather than assumed: on a socket already
established, between a Paris connection and a Paris origin, a round trip cost **389 ms median through
Cloudflare and 8.5 ms direct**. The same edge answered two unrelated zones in 40 ms at the same
moment, so the slow leg is Cloudflare to *this* origin, and it congests by the hour. An interrupt in
this game is decided by arrival order at the server, so that is the mechanic, not the polish.

Three things it costs, and none of them is optional:

- **A publicly trusted certificate, which the Origin Certificate above is not.** Grey cloud means the
  browser validates the certificate itself, and a Cloudflare Origin Certificate is trusted by
  Cloudflare and by nothing else. This host's Traefik has no `certificatesResolvers`, so today that
  means a certificate obtained elsewhere and dropped into `/etc/traefik/certs` with an entry appended
  to the file provider's `certificates:` list — **and nothing in this repo can tell you it expired.**
  Adding an ACME resolver is the change that removes that trap; until it exists, the expiry date is a
  calendar entry.
- **The origin's address becomes public.** It was hidden behind the proxy and now resolves in DNS.
  Whatever protects `:443` on that machine is now the whole of the protection.
- **`LOCO_ALLOWED_ORIGINS`.** The page and the socket are on two hostnames, so the server's default
  origin rule refuses every upgrade. `write_app_env` sets it; see
  [`docs/notes/server.md`](notes/server.md).

**The failure mode is deliberately not fatal.** If that hostname will not open a socket — expired
certificate, missing DNS, closed port — the client falls back to `wss://ohloco.com/ws` after three
attempts and the game keeps working at the old latency. That is why the CSP still lists both origins
and why `client/nginx.conf` still proxies `/ws` on the main host. **A fallback in effect is silent**:
the symptom is the game feeling like it did before this change, so if it ever does, check the
certificate first.

To deploy it the first time: create the `A` record grey-clouded, install the certificate, then tag.
The client bundle only dials the hostname when built on a `v*` tag, so the record and the certificate
can be in place well before anything uses them — and should be.

One caveat this stack has to live with: **Cloudflare closes a proxied WebSocket that has been idle for
about 100 seconds.** The game's own traffic covers an active table, but a lobby waiting for a second
player sends nothing, and a socket cut there costs a seat for no reason. Whatever keepalive answers it
belongs in the hub, not in nginx — nginx is not the thing timing out.

## Production request path

```
Browser (HTTPS, ohloco.com)     → Cloudflare → Traefik (:443, entrypoint websecure)
Browser (WSS, ws.ohloco.com)    →   DNS-only → Traefik (:443, entrypoint websecure)
  → client nginx (:80, networks: traefik + internal)
    → /ws     → Go server (:8080, network: internal only)   [WebSocket, both hostnames]
    → /       → nginx serves static SPA files directly      [site hostname only;
                                                             ws.* answers 404]

Go server (:8080, internal only)
  → /health, /metrics                                        [operator only, never proxied]
```

- **nginx proxies `/ws` and nothing else.** `/health` used to be proxied and answers with the live
  room count, the connected-player count and `draining`: the counts size the server for anyone
  thinking of loading it, and `draining` announces the window in which new tables are refused.
  Nothing legitimate needed it published, because the container's own healthcheck runs inside it
  against `localhost:8080`, which is also how an operator reads either endpoint:
  `docker compose exec server wget -qO- http://localhost:8080/health`.

- **That chain is why the Go server reads `CF-Connecting-IP`.** Four hops in, `r.RemoteAddr` is the
  nginx container and it is identical for every player, which silently turns `MaxConnsPerNet` (64 per
  network) into a 64-player server and `MaxFailedJoins` (20 per network per minute) into a global
  lockout. `hub.clientNet` takes the header instead, and only from a trusted peer — see
  [`docs/notes/server.md`](notes/server.md). Nothing needs Cloudflare's **Pseudo IPv4**, which exists
  for origins that cannot parse an IPv6 address: this one truncates it to a `/48` and moves on.
- Traefik terminates TLS and routes all traffic to the nginx container on port 80.
- nginx bridges the `traefik` and `internal` Docker networks; the Go server is isolated on `internal` and is never directly reachable by Traefik.
- The Go server container exposes port 8080 internally (`expose`, not `ports`).

## A deploy does not interrupt the matches on the server

A deploy used to end every match in progress, silently. `docker compose up -d`
recreated the `server` container, `main.go` caught no signal, and the process
died mid-turn. The clients retried 250 ms later with the session token they
still held, found the room gone, and were answered `room not found`, which the
client renders as "Aucune table avec ce code": the player lost the match and was
shown a message that reads like they mistyped their own table code.

Two mechanisms replace that, and they are complementary rather than
alternative. Both run on every shutdown.

### 1. The drain

On `SIGTERM` (`server/main.go` → `hub.BeginDrain`, `server/hub/drain.go`):

- Nothing new starts. `create_room`, `start_game`, `rematch`, `find_match` and a
  `join_room` aimed at a table this process does not have are all answered
  `server updating, try again in a moment`. The matchmaking queue is emptied and
  everybody in it is told why.
- **Everything already running is left completely alone**: same turn clock, same
  reaction windows, same bots, same reconnects. A match that started before the
  signal plays out exactly as it would have.
- Tables in progress get one `server_updating` message, which the client renders
  as a quiet line in the top chrome. It is information: nothing is disabled and
  there is no countdown.
- The process exits as soon as the last match ends, or after
  `LOCO_DRAIN_TIMEOUT`, whichever comes first.

**The drain is short on purpose, and it is the same everywhere: 90 s.** It was
15 minutes in production so a best-of-7 could play out, and that made the
duration of a pipeline a function of how long strangers played. Two things are
wrong with that. A deploy job blocked for a quarter of an hour holds a runner
slot nobody else gets, and the job's own ceiling at the time (`timeout: 30m`)
was only ever a few minutes clear of the wait once the image pulls and the
healthchecks were counted, so raising the drain to be kinder to players was one
edit away from turning a deploy into a pipeline that fails on a match rather
than on a fault. 90 s still lets a hand near its end finish. Past that, the
snapshot below is not the fallback, it is the mechanism, and it is covered by a
full restart test rather than by hope.

The three deploy jobs now carry `timeout: 10m`, well clear of the 150 s grace
period plus the two pulls, and **nothing in that arithmetic scales with the
number of tables**. That is the property to preserve: raising
`LOCO_DRAIN_TIMEOUT` again puts the length of a pipeline back in the players'
hands, and `STOP_GRACE_PERIOD` and the job timeouts have to move with it.

The refusal list is chosen so **the drain terminates**. Every entry on it is an
action that would add a match to the set being waited on. Joining a lobby that
already exists is deliberately *not* on it: a lobby cannot deal during a drain,
so sitting down in one costs the deploy nothing. Were `start_game` allowed, two
players could hold a deploy open indefinitely by rematching.

### 2. The snapshot

For the case the drain runs out of time (`server/hub/snapshot.go`): the matches
still in flight are written to `LOCO_SNAPSHOT_PATH` as the process exits, and
the next one reads them back before its listener is up. The clients reconnect
into the restored rooms on their own, with the token they have had in
`sessionStorage` since they joined. From a seat it is the one-second
"Reconnexion" overlay a dropped wifi frame already produces, which is why none
of this needed a new client screen.

Three deliberate limits:

- **Only matches in flight travel.** A lobby has nothing to lose and its players
  are on the table screen, not in a hand.
- **A snapshot is never replayed.** The file is removed as it is read.
- **`SnapshotSchemaVersion` is a hard gate, not a merge.** A room shaped by
  another build is dropped whole, with a `WARN`. So is one older than
  `SnapshotMaxAge` (2 min), by which point the clients have given up anyway.
  That age is what the rollout has to stay inside: the file is written as the
  old container exits and read as the new one boots, seconds apart, and a
  rollout that ever put more than two minutes between the two would be
  discarding the matches it stopped waiting for. With the drain at 90 s this
  path is the ordinary one, not the exception, which is why the restart test in
  `server/hub/snapshot_test.go` goes through real sockets and reclaims both
  hands card for card.

### What the deploy has to get right

| Piece | Why it matters |
|---|---|
| `stop_grace_period` on the `server` service | The single most important line. Docker's default is SIGTERM, wait 10 s, SIGKILL, and a SIGKILL lands in the middle of all of the above. Left at the default, none of this exists. Kept above `LOCO_DRAIN_TIMEOUT` so the snapshot write always fits inside it. |
| `${DATA_DIR}/snapshots:/data` bind mount | Where the snapshot survives the container. A path rather than a named volume so an operator can see, and delete, exactly one file. |
| `rollout()` does **server first, client second** | Recreating the server is the slow half, and for as long as it drains the players in a match are talking to the *old* process. Serving them the new bundle during that window would pair a fresh client with a server one version behind for the whole drain. Doing the client afterwards narrows the mismatch to the seconds between the two commands. |
| One drain policy, in `deploy/app.env` | `90s` / `150s` in both environments, no per-job switch. The wait a deploy can incur is now a constant, not a question about the tables that happen to be up, so `deploy_dev`, `deploy_prod` and `stop_dev` all carry `timeout: 10m` with the ceiling far clear of the wait it bounds. |

`/health` and `/metrics` both report `draining`; `/metrics` also carries
`matches_in_flight`, which is the number the shutdown is waiting to reach zero.
It is only maintained while draining and reads 0 before that.

Coverage is `server/hub/drain_test.go` and `server/hub/snapshot_test.go`,
including a full restart: a match on one hub, snapshot, a second hub loads it,
and both players reconnect with their original tokens and get their hands back
card for card. There is deliberately **no Playwright coverage**: the E2E suite
cannot restart the server underneath itself.

## Production readiness

- The `server` service in `deploy/compose.yml` has a healthcheck (`GET /health`, 10 s interval, 5 s timeout, 3 retries, 5 s start period).
- The `client` service waits for `server` to be `healthy` before starting (`condition: service_healthy`), preventing nginx from routing to a not-yet-listening Go server.
- Compose-interpolation variables (`DEPLOY_ENV`, `APP_HOST`, `IMAGE_TAG`, `CI_REGISTRY_IMAGE`, `STOP_GRACE_PERIOD`) and the server's own `LOCO_DRAIN_TIMEOUT` / `LOCO_SNAPSHOT_PATH` are written to `app.env` by `write_app_env` and loaded via `--env-file app.env`, so a manual `docker compose up` on the server works without CI shell exports.
- Dev hosts (`*-d.<domain>`) serve `robots.txt` with `Disallow: /`; production hosts allow indexing.
- nginx WebSocket timeouts: `proxy_connect_timeout 10s`, `proxy_read_timeout 86400s`, `proxy_send_timeout 86400s`.
- nginx sends security headers on every response (`always`): a closed CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`. The client is built for it — self-hosted fonts, no CDN, no
  remote anything — so the only relaxations are `style-src 'unsafe-inline'` (Astro inlines the
  stylesheets, and the board positions every card with a `style` attribute) and an explicit
  `ws://$host wss://$host` in
  `connect-src`, since a page on `http://` and a socket on `ws://` are different CSP origins.
- The Go server checks the `Origin` header on the WebSocket upgrade. By default the Origin's hostname
  must match the request's (ports ignored, so the dev client on :5173 reaches :8080); set
  `LOCO_ALLOWED_ORIGINS` to an exact comma-separated list to narrow it further.
