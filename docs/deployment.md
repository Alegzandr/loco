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

- `backend_test` (`rust:1.97-bookworm`): `cd server && cargo test --workspace --locked`, the
  `wasm32-unknown-unknown` build of `loco-game` (the domain must keep building for the browser), and
  the static musl `loco-server` that `e2e_test` runs (`server-bin`).
- `frontend_test` (`node:24-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`.
- `e2e_test` (`mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy`): runs the server binary, runs
  Playwright as 4 parallel shards; `needs: [backend_test]` for that binary and nothing else.
- `backend_lint` (`rust:1.97-bookworm`): `cargo fmt --all -- --check`, `cargo clippy --workspace
  --all-targets -- -D warnings` and `cargo deny check` (`server/deny.toml`: permissive licences only,
  no open advisory, crates.io only).
- `protocol_check` (`rust:1.97-bookworm` plus the distribution's `nodejs`): the converter's refusal
  tests, `cargo test -p loco-protocol` (the wire fixtures among them) and `protocolgen --check`,
  which fails if `client/src/types/` has drifted from `server/crates/loco-protocol/`.

Each Cargo job caches `.cargo/registry/` and `server/target/` under its own key prefix, keyed on
`server/Cargo.lock`: two jobs pushing one key race on the upload.

`build` **needs every test job**, lint and `protocol_check` included. `needs` is what actually gates a deploy: naming only `backend_test` and
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
| `server-bin` built once by `backend_test`, handed over by cache | `e2e_test` runs on the Playwright image, which has no Rust: it used to download a toolchain and rebuild the same binary once per shard. Static (musl), so it runs on that image's older glibc as-is. Cache rather than artifact: see below. |
| No `playwright install` | The image ships the browsers, and only the ones its own Playwright needs. `PLAYWRIGHT_VERSION` is declared once, interpolated into the image tag, and asserted against the installed version before the suite runs; `@playwright/test` is pinned exactly. Bump the two together and commit the lockfile. |
| Cargo + npm caches under `$CI_PROJECT_DIR` | GitLab only caches paths inside the project. Keys are per job family; the shards key on `$CI_NODE_INDEX` so four jobs don't race on one cache upload. |
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
passed into a red pipeline. The limitation predates the speed work: `e2e_test` rebuilt the server
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
  Traefik, which is why `deploy/compose.yml` carries one `Host()` for the site and none for `www.`
  (its other `Host()` is the socket's `ws.`). The apex is canonical
  everywhere — `VITE_PUBLIC_ORIGIN`, the sitemap, the `hreflang` sets — and a canonical naming a
  redirect is the failure nothing reports.
- **The site's origin certificate is a Cloudflare Origin Certificate, and it is a file rather than
  an ACME issuance.** Certificates live under `/etc/traefik/certs`, declared as `tls.certificates`
  pairs in the host Traefik's file provider, which watches the directory and reloads without a
  restart. The site's router therefore asks for `tls=true` and names no resolver: behind the proxy,
  Cloudflare is the only thing that validates this certificate and it is issued for exactly that.
  **`ws.*` is the opposite case and names one** — see below.

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
  Cloudflare and by nothing else. **This is the failure that shipped**, and it is worth knowing by
  sight: the zone's Origin Certificate answered on `ws.ohloco.com`, every browser refused the upgrade
  before it happened, and the game fell back to `wss://ohloco.com/ws` at 389 ms for every player.
  Only the machines carrying Cloudflare's Origin CA in their trust store — the ones the origin was
  set up from — ever saw the direct socket, which is what made it look like a browser difference.
  So the socket's router names a `letsencrypt` **certresolver**, HTTP-01 on the `:80` entrypoint:
  `ws.*` is grey-clouded, so the challenge reaches this origin directly. Two things follow. **The
  resolver must exist in the host Traefik's static configuration before the label ships**, because a
  router naming a resolver that does not exist is a router that does not load. And **the record must
  stay grey-clouded**, or the challenge lands on Cloudflare and no certificate is ever issued.
  ACME also renews it, which is what removes the trap this used to carry: nothing in this repo could
  tell you the certificate had expired.

  **Only production carries that label**, and it travels as a whole line: `WS_CERT_LABEL`, written by
  `write_app_env` and interpolated into the `labels:` list. Dev gets an inert Docker label instead of
  an empty string, which would not parse. The reason is that the direct socket is a production
  mechanism — it exists to escape a CDN, and dev has none — so no `ws.` record is ever created for the
  dev host. A dev router naming the resolver would ask Let's Encrypt for a name that resolves nowhere,
  fail, retry, and spend against a quota of five failed validations an hour on the account production
  renews on.
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

To deploy it the first time: create the `A` record grey-clouded, add the `letsencrypt` resolver to
the host Traefik, deploy so the router asks for the certificate, check it, then tag. The client
bundle only dials the hostname when built on a `v*` tag, so the record and the certificate can be in
place well before anything uses them — and should be. What "check it" means, from anywhere:

```
echo | openssl s_client -connect ws.ohloco.com:443 -servername ws.ohloco.com 2>&1 \
  | grep -E 'Verify return code|issuer'
```

`Verify return code: 0 (ok)` and a Let's Encrypt issuer. Anything else and every player is on the
proxied path, quietly.

One caveat this stack has to live with: **Cloudflare closes a proxied WebSocket that has been idle for
about 100 seconds.** The game's own traffic covers an active table, but a lobby waiting for a second
player sends nothing, and a socket cut there costs a seat for no reason. Whatever keepalive answers it
belongs in the hub, not in nginx — nginx is not the thing timing out.

## Production request path

```
Browser (HTTPS, ohloco.com)     → Cloudflare → Traefik (:443, entrypoint websecure)
Browser (WSS, ws.ohloco.com)    →   DNS-only → Traefik (:443, entrypoint websecure)
  → client nginx (:80, networks: traefik + internal)
    → /ws          → loco-server (:8080, internal only)     [WebSocket, both hostnames]
    → /live.json   → loco-server                            [the live-streams list]
    → /live-thumb/ → loco-server                            [previews, from its memory]
    → /            → nginx serves static SPA files directly [site hostname only;
                                                             ws.* answers 404]

loco-server (:8080, internal only)
  → /health, /metrics                                        [operator only, never proxied]
```

- **nginx proxies `/ws`, `/live.json` and `/live-thumb/`, and nothing else**, and `csp.test.ts` pins
  that list so a fourth path is a decision somebody takes deliberately. The two live-streams paths
  answer from the server's memory: it asks Twitch, through the Janus gateway, roughly once a
  minute and fetches the previews itself, so a player's browser never makes a request to Twitch. That
  is what leaves the CSP untouched and the privacy page's promise true — see
  [`notes/live.md`](notes/live.md). Neither block declares an `add_header`, so both inherit the five
  security headers rather than needing the include repeated.
- **The gateway credentials reach production only.** `write_app_env` passes `JANUS_URL`,
  `JANUS_APPLICATION_ID`, `JANUS_API_KEY`, `LOCO_TWITCH_GAME_ID` and `LOCO_TWITCH_CDN_SLUG` on the
  prod branch and empty strings everywhere else: two stacks on one key is two sets of requests
  against one quota, for a list nobody reads on the dev host. An empty key switches the feature off
  entirely, server-side. That file now carries a real secret, so the pipeline `chmod 600`s it.
  **And `deploy/app.env` must never declare any of those five keys**, which is checked before the
  deploy sources it: the job reads that file under `set -a`, so a committed empty value is exported
  over the masked GitLab variable of the same name and `write_app_env` then writes the empty one.
  The five shipped declared and empty, and the live strip was off in production for as long as they
  were there — silently, because an empty key means exactly that.
- **`/health` and `/metrics` are not on that list, and that is the point.** `/health` used to be
  proxied and answers with the live room count, the connected-player count and `draining`: the counts size the server for anyone
  thinking of loading it, and `draining` announces the window in which new tables are refused.
  Nothing legitimate needed it published, because the container's own healthcheck runs inside it
  (`loco-server healthcheck`, a `GET /health` on loopback). The image has no shell, so an operator
  reads either endpoint from the nginx container on the same network:
  `docker compose exec client wget -qO- http://server:8080/health`.

- **That chain is why the server reads `CF-Connecting-IP`.** Four hops in, the peer address is the
  nginx container and it is identical for every player, which silently turns `max_conns_per_net` (64
  per network) into a 64-player server and `max_failed_joins` (20 per network per minute) into a global
  lockout. `hub.clientNet` takes the header instead, and only from a trusted peer — see
  [`docs/notes/server.md`](notes/server.md). Nothing needs Cloudflare's **Pseudo IPv4**, which exists
  for origins that cannot parse an IPv6 address: this one truncates it to a `/48` and moves on.
- Traefik terminates TLS and routes all traffic to the nginx container on port 80.
- nginx bridges the `traefik` and `internal` Docker networks; the server is isolated on `internal` and is never directly reachable by Traefik.
- The server container exposes port 8080 internally (`expose`, not `ports`).

## A deploy does not interrupt the matches on the server

A deploy used to end every match in progress, silently. `docker compose up -d`
recreated the `server` container, the server caught no signal, and the process
died mid-turn. The clients retried 250 ms later with the session token they
still held, found the room gone, and were answered `room not found`, which the
client renders as "Aucune table avec ce code": the player lost the match and was
shown a message that reads like they mistyped their own table code.

Two mechanisms replace that, and they are complementary rather than
alternative. Both run on every shutdown.

### 1. The drain

On `SIGTERM` (`loco-server/src/main.rs` → `Hub::begin_drain`, `loco-hub/src/drain.rs`):

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

For the case the drain runs out of time (`loco-hub/src/snapshot.rs`): the matches
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
- **`SNAPSHOT_SCHEMA_VERSION` (5) is a hard gate, not a merge.** A room shaped by
  another build is dropped whole, with a `WARN`. So is one older than
  `snapshot_max_age` (2 min), by which point the clients have given up anyway.
  That age is what the rollout has to stay inside: the file is written as the
  old container exits and read as the new one boots, seconds apart, and a
  rollout that ever put more than two minutes between the two would be
  discarding the matches it stopped waiting for. With the drain at 90 s this
  path is the ordinary one, not the exception, which is why the restart test in
  `loco-hub/tests/snapshot.rs` goes through real sockets and reclaims both
  hands card for card.

### What the deploy has to get right

| Piece | Why it matters |
|---|---|
| `stop_grace_period` on the `server` service | The single most important line. Docker's default is SIGTERM, wait 10 s, SIGKILL, and a SIGKILL lands in the middle of all of the above. Left at the default, none of this exists. Kept above `LOCO_DRAIN_TIMEOUT` so the snapshot write always fits inside it. |
| `${DATA_DIR}/snapshots/${DEPLOY_ENV}:/data` bind mount | Where the snapshot survives the container. A path rather than a named volume so an operator can see, and delete, exactly one file; one directory per environment, because dev and prod share `DATA_DIR`. |
| `rollout()` does **server first, client second** | Recreating the server is the slow half, and for as long as it drains the players in a match are talking to the *old* process. Serving them the new bundle during that window would pair a fresh client with a server one version behind for the whole drain. Doing the client afterwards narrows the mismatch to the seconds between the two commands. |
| One drain policy, in `deploy/app.env` | `90s` / `150s` in both environments, no per-job switch. The wait a deploy can incur is now a constant, not a question about the tables that happen to be up, so `deploy_dev`, `deploy_prod` and `stop_dev` all carry `timeout: 10m` with the ceiling far clear of the wait it bounds. |

`/health` and `/metrics` both report `draining`; `/metrics` also carries
`matches_in_flight`, which is the number the shutdown is waiting to reach zero.
It is only maintained while draining and reads 0 before that.

Coverage is `loco-hub/tests/drain.rs` and `loco-hub/tests/snapshot.rs`,
including a full restart: a match on one hub, snapshot, a second hub loads it,
and both players reconnect with their original tokens and get their hands back
card for card. There is deliberately **no Playwright coverage**: the E2E suite
cannot restart the server underneath itself.

### The server image, and who owns `/data`

`server/Dockerfile` is a static musl binary on `gcr.io/distroless/static:nonroot`: no shell, no
package manager, no `wget`. Three things follow from it:

- **The runtime uid is 65532** (distroless `nonroot`; the old server ran as 10001). The `/data` bind
  mount has to be writable by it, and a mount overrides whatever the image chowned.
- **The healthcheck is the binary**: `["CMD", "/loco-server", "healthcheck"]` (a `GET /health` on
  loopback, exit 0 on a 200). `wget -qO- …/health` does not exist in the image.
- **`/metrics` is Prometheus text**, under the names the JSON version used; `/health` is JSON. The
  E2E helpers read it as text (`e2e/helpers/metrics.ts`).

**Ownership is the deploy's job, and it is done in `rollout()`, between the two halves of the
swap**: `docker compose stop server`, then `chown -R 65532:65532 ${DATA_DIR}/snapshots/${DEPLOY_ENV}`
and `chmod 700`, then `up -d --wait server`. **The chown runs in a throwaway container
(`docker run -v ${DATA_DIR}/snapshots:/s docker:29 …`), never in the job's own shell**: the bind
mount is resolved on the host, and a chown run in the job lands on the job container's copy of the
path. That is how the first Rust deploys to loco-d found a root-owned directory dockerd had made for
the mount and logged `snapshot write failed … Permission denied`. The deploy log prints the old
server's last lines after the stop and the new one's `snapshot` lines after the start, so the
outcome of every drain is on the job.

**Each environment has its own snapshot directory** (`${DATA_DIR}/snapshots/dev`, `…/prod`). Dev and
prod share `DATA_DIR`, and with one directory they shared one file: a dev deploy could restore
prod's matches into the dev server and delete the file doing it. The server that preceded the split
wrote at the top level, so the first deploy of each environment after it moves the `snapshot.json`
its old server just wrote into that environment's directory before the new server starts, and only
that directory changes owner — the top level stays writable by an old server still running in the
other environment. The order is the point. The process being replaced writes
its snapshot while it stops, as *its* user: a chown before the stop locks it out of a 0700
directory, and a chown that is not recursive leaves the file it wrote unreadable to the next
process. Either way the matches in flight are lost, and the deploy that replaced the old image was
exactly the one where they would have been. `.defaults` only creates the directory now.

**No manual action is needed on the host** as long as the deploy job can reach the Docker
daemon, which it needs anyway to deploy. If a host is ever brought up by hand instead, the one-time
equivalent is:

```sh
sudo mkdir -p /home/kisuke/data-loco/snapshots/prod
sudo chown -R 65532:65532 /home/kisuke/data-loco/snapshots/prod && sudo chmod 700 /home/kisuke/data-loco/snapshots/prod
```

`read_only`, `cap_drop: ALL`, `no-new-privileges`, the tmpfs `/tmp` and the `/data` bind mount are
unchanged. The shutdown listens for SIGTERM through `tokio::signal::unix` (and Ctrl-C), which is
what `docker compose stop` sends PID 1; it has been exercised on Windows with Ctrl-Break, so the
first deploy to loco-d is where the Linux path is seen for real: check the server's log for
`shutdown signal received, draining` and, past the drain, `snapshot written`.

## Production readiness

- The `server` service in `deploy/compose.yml` has a healthcheck (`loco-server healthcheck`, a `GET /health` on loopback; 10 s interval, 5 s timeout, 3 retries, 5 s start period).
- The `client` service waits for `server` to be `healthy` before starting (`condition: service_healthy`), preventing nginx from routing to a not-yet-listening server.
- Compose-interpolation variables (`DEPLOY_ENV`, `APP_HOST`, `IMAGE_TAG`, `CI_REGISTRY_IMAGE`, `STOP_GRACE_PERIOD`) and the server's own `LOCO_DRAIN_TIMEOUT` / `LOCO_SNAPSHOT_PATH` are written to `app.env` by `write_app_env` and loaded via `--env-file app.env`, so a manual `docker compose up` on the server works without CI shell exports.
- Dev hosts (`*-d.<domain>`) serve `robots.txt` with `Disallow: /`; production hosts allow indexing.
- nginx WebSocket timeouts: `proxy_connect_timeout 10s`, `proxy_read_timeout 86400s`, `proxy_send_timeout 86400s`.
- nginx sends security headers on every response (`always`): a closed CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`. The client is built for it — self-hosted fonts, no CDN, no
  remote anything — so the only relaxations are `style-src 'unsafe-inline'` (SvelteKit inlines the
  small stylesheets, and the board positions every card with a `style` attribute) and an explicit
  `ws://$host wss://$host` in
  `connect-src`, since a page on `http://` and a socket on `ws://` are different CSP origins.
- The server checks the `Origin` header on the WebSocket upgrade (`serve::origin_allowed`). By default the Origin's hostname
  must match the request's (ports ignored, so the dev client on :5173 reaches :8080); set
  `LOCO_ALLOWED_ORIGINS` to an exact comma-separated list to narrow it further.
