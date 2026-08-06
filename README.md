# LOCO! – Real-time Multiplayer Card Game

A premium-quality real-time browser-based card game inspired by UNO. Play with friends in seconds
using only a nickname — no accounts required.

Built to be streamed: every state has to be readable at 720p by a viewer who is not playing, and the
big moments (interception, LOCO!, victory) have to land in a muted clip.

| | |
| --- | --- |
| What ships | [`docs/features.md`](docs/features.md) |
| The rules of the game | [`docs/rules.md`](docs/rules.md) |
| Engineering rules and conventions | [`CLAUDE.md`](CLAUDE.md) |
| The reasoning behind each one | [`docs/notes/`](docs/notes/) |
| The written design system | [`DESIGN.md`](DESIGN.md) · the product's audiences and register: [`PRODUCT.md`](PRODUCT.md) |
| Wire protocol | [`docs/protocol.md`](docs/protocol.md) |
| Pipeline and deployment | [`docs/deployment.md`](docs/deployment.md) |

---

## Stack

| Layer     | Technology              | Reason                                                                |
|-----------|-------------------------|-----------------------------------------------------------------------|
| Backend   | **Go**                  | Low latency, native concurrency, small binary, excellent stdlib       |
| Realtime  | **WebSockets** (gorilla)| Persistent bidirectional connection; lowest latency for game events   |
| Frontend  | **Svelte 5 + TypeScript** | Component model, type safety, and a compiler rather than a runtime: a card that moves does not re-render a tree to do it |
| Site      | **Astro** (static output) | Builds the game page and the content pages from one project. The game is *not* server-rendered: it mounts client-side, so nothing about theme, language, session or board geometry has to be guessed on a server. Output stays static files behind nginx, no Node runtime in production |
| Bundler   | **Vite** (via Astro)    | Near-instant dev server, fast HMR                                     |
| Rendering | **Svelte + CSS + WAAPI** | DOM-based card rendering, no animation library: the fan and the seats reflow on CSS transitions, and a card in flight is one `element.animate` call handed straight to the browser |
| State     | **`hooks/store/createStore.ts`** (~40 lines) | `getState`/`setState`/`subscribe` plus a middleware slot, with no framework in it, because the board is read by three modules that render nothing (`hooks/appEffects.svelte.ts`, `hooks/sessionRestore.ts`, the E2E bridge) and by no framework in particular; `src/test/storeCore.test.ts` states every semantic the app depends on |
| Validation| **Valibot**             | Runtime schema for inbound `ServerMsg`. Both it and the TypeScript types are **generated from `server/protocol/`** by `make protocol`, so Go↔TS drift is not caught late, it is not possible: CI regenerates and fails on any difference. Valibot because it interprets its schemas: a validator that JIT-compiles them with `Function()` is refused by the production CSP, and the failure only ever appears on the served page |
| Audio     | **Web Audio API** (hand-rolled) | Every sound is synthesised at runtime: no files to download, no licences, no cache-miss silence |
| Type      | **Fredoka + Nunito** (self-hosted, `@fontsource`) | Rounded display faces that match the art direction; self-hosted so the CSP stays closed |
| Testing   | **Go test** + **Vitest**| Standard Go testing; Vitest runs on Astro's own Vite config (`getViteConfig`), so tests resolve modules exactly as the build does |
| Visual QA | **Playwright** screenshot harness | Renders every screen/state without a server and contact-sheets them (`make visual`) |
| Lint      | **ESLint** + **golangci-lint** | Catches dead code / unchecked errors before CI                 |
| Infra     | **Docker + Compose**    | Reproducible builds, simple one-command local run                     |

---

## Repository Structure

```
loco/
├── server/                # Go game server: game/ (domain), hub/ (sockets, tables), protocol/ (wire)
├── client/                # Astro site + Svelte/TypeScript game
├── e2e/                   # Playwright suite (separate package.json)
├── tools/                 # visual/ og/ icons/ maps/ audio/ csp/ — one harness per make target
├── docs/                  # Rules spec, protocol, deployment + notes/ (the reasoning)
├── deploy/                # Production compose + traefik config
├── docker-compose.yml     # Production-style full-stack compose
└── docker-compose.dev.yml # Development compose (bind mounts, hot reload)
```

`CLAUDE.md` carries the same tree file by file, down to what each module owns and may not do. It is
the version kept current; this one is here to get you to the right directory.

---

## Architecture

The **server** owns every piece of authoritative state: room lifecycle, hands (hidden from other
clients), deck and discard, turn order and direction, legality, draw penalties and counter
resolution, LOCO! declaration and catch timing, the winner. The **client** owns presentation only:
rendering its own hand, animation, and sending intents.

- One persistent WebSocket per player. **One goroutine per table**: the hub's loop owns what is
  between tables (the map of them, the matchmaking queue, the sockets, the drain) and routes each
  message to the table it is for. No locks on room state either way — a table's fields are touched
  by exactly one goroutine.
- It is not a throughput change. A whole card play costs 8.6 µs and the rate limiter admits far less
  than one goroutine absorbed; what the split buys is **isolation**, in a game whose reaction windows
  are decided by arrival order.
- Timing is enforced server-side at message receipt. Client timestamps decide nothing.
- Deferred async work (bot moves, reconnect expiry, room cleanup) is `time.AfterFunc`, so the
  goroutine count is O(connections + tables) rather than O(rooms × events).

**Latency budget.** Interrupts are resolved by arrival order, so every hop is tuned for the smallest
delay rather than the fewest bytes: nginx forwards the tunnel with `tcp_nodelay on` and
`proxy_buffering off` (Nagle would hold a few-hundred-byte play for up to 40 ms), WebSocket
compression is deliberately off, the client sends the play before it animates it, and the reconnect
backoff starts at 250 ms because a dead board costs a whole interrupt window. A **reload** survives
too: room, nickname and session token are mirrored into `sessionStorage` — per tab, so two seats
played from one browser cannot overwrite each other's token, and it dies with the tab rather than
handing the next person a live seat.

**Anti-cheat.** Legality, hand membership and turn are checked server-side on every action; hidden
state never reaches the wrong client; session tokens are `crypto/rand`, compared in constant time and
rotated on every reclaim; a refused reclaim never names the roster; gameplay is refused while the
table is still loading its map or has not dealt; a handler panic is recovered on both sides of the
routing hand-off. Connection, table and wrong-code ceilings are refused before the work they would
cost.

Measurements, the alternatives that were rejected, and what those numbers rule out:
[`docs/notes/server.md`](docs/notes/server.md). Message catalogue and DTO shapes:
[`docs/protocol.md`](docs/protocol.md).

---

## Running it

`make help` lists every target. They are docker-first, so a host Go install is not required; the
client and E2E targets do need Node (22.12+ — Astro 7 declares it in `engines` and `npm ci` fails on
20).

| Task | Command |
| --- | --- |
| Dev stack, hot reload | `make dev` → client :5173, server :8080, then `make down` |
| All unit tests | `make test` (server + client) |
| Full E2E | `make test-e2e` (needs the Go server on :8080; Playwright boots its own Vite on :4173) |
| Lint | `make lint` |
| Type-check | `make build-client` (`astro check && svelte-check && astro build`) |
| Regenerate the protocol | `make protocol` after any change to `server/protocol/` |
| Visual review | `make visual ARGS="--scenes=... --viewports=wide,small,notch"` |
| Deliberately outside CI | `make audio-verify`, `make csp`, `make og`, `make icons`, `make maps`, `make bench-server` |

Without Docker: `cd server && go run .` (listens on :8080) and `cd client && npm install && npm run
dev`. Test-by-test invocations, what each harness catches that no assertion would, and why four of
those targets are outside CI: [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md).

### Docker

```bash
cp .env.example .env
docker compose up --build                        # production-style, frontend on :3000
docker compose -f docker-compose.dev.yml up --build   # dev: bind mounts, hot reload
docker compose down
```

The production-style stack does **not** publish the Go server on a host port, so it matches the
deployed one: nginx is the only way in and it proxies `/ws` and nothing else. `/health` and
`/metrics` are operator surfaces, reachable from inside the container only:

```bash
docker compose exec server wget -qO- http://localhost:8080/health
docker compose exec server wget -qO- http://localhost:8080/metrics
```

`handler_panics` is the one to alert on: the loop recovers rather than dying, so any value above zero
is a bug nothing else surfaces. `log_lines_dropped` above zero means the log you are reading has
holes in it. `debug_mode_active` must read `false` in production. The server container runs as an
unprivileged user with no capabilities and a read-only root filesystem, so it can write nothing but
the shutdown snapshot on its `/data` mount.

### Environment Variables

| Variable          | Default               | Description                                              |
|-------------------|-----------------------|----------------------------------------------------------|
| `PORT`            | `8080`                | Go server listen port                                    |
| `CLIENT_PORT`     | `3000`                | Nginx (frontend) listen port (production compose)        |
| `VITE_WS_PORT`    | `8080`                | Go backend port for direct WS connections in dev (`ws://<host>:<port>/ws`) |
| `VITE_PUBLIC_ORIGIN` | `https://ohloco.com` | **Build-time.** The origin the canonical, `hreflang` and `og:` tags are made absolute against — crawlers do not run JS and never fetch a relative `og:image`, so it cannot be filled in at runtime. Always the apex, never `www.`, which only 301s to it. `client/Dockerfile` takes it as an `ARG`; `.gitlab-ci.yml` passes `https://${APP_HOST}` (`ohloco.com` on a `v*` tag, `loco-d.kisukesaama.com` on `develop`). |
| `LOCO_ALLOWED_ORIGINS` | *(unset)*        | Comma-separated exact browser origins allowed to open a WebSocket. Unset means "same hostname as the request", port-insensitive, which already covers production and dev. |
| `LOCO_CLIENT_IP_HEADERS` | `CF-Connecting-IP,X-Real-IP` | Ordered list of headers carrying the address of the browser that opened the socket; first one that parses wins. Behind a proxy every socket arrives from the nginx container, so without this the per-network ceilings below collapse onto one bucket. Two of them because production has two paths: the CDN sets the first, Traefik overwrites the second on the direct socket host. The order matters — a client can put its own `X-Real-IP` on a proxied request. Read **only** from a trusted peer, and a multi-value one is refused: `X-Forwarded-For` is not a safe substitute, Cloudflare appends to it and its leftmost entry is the client's to invent. |
| `VITE_WS_ORIGIN` | *(empty)* | **Build-time.** The hostname the WebSocket dials to bypass the CDN, e.g. `wss://ws.ohloco.com`. A proxied socket measured 389 ms per round trip against 8.5 ms direct, Paris to Paris, on an established connection — every card, not a page-load cost. Empty means the socket stays on the page's own origin, which is dev, a local build and the dev deployment. `client/Dockerfile` takes it as an `ARG` and uses it twice: the bundle, and the CSP's `connect-src`. `.gitlab-ci.yml` passes it on a `v*` tag only. The scheme is taken from the page, so it may be given with or without one. |
| `LOCO_TRUSTED_PROXIES` | *(unset)*        | Comma-separated CIDRs whose `LOCO_CLIENT_IP_HEADERS` are believed. Unset means loopback plus the private ranges, which is the whole set of peers that can reach the Go server: it publishes `8080` on the `internal` Docker network only. Setting this **replaces** that default rather than adding to it. |
| `LOCO_E2E`        | *(unset)*             | `1` enables `debug_set_state`, used by the Playwright suite. **Never set in production** — the server logs a startup `WARN` and `/metrics` reports `debug_mode_active`. |
| `LOCO_BOT_THINK_MS` | `1200`              | Bot thinking time before playing a card. Read **only** when `LOCO_E2E=1`; ignored (with a `WARN`) if malformed or negative. Shortened in CI to cut dead time out of the E2E suite. |
| `LOCO_BOT_JITTER_MS` | `1000`             | Random jitter added to `LOCO_BOT_THINK_MS`. Same gate and same validation. Bot *reaction* windows (catch, LOCO! declaration, interrupt) are deliberately not tunable. |
| `LOCO_DRAIN_TIMEOUT` | `90s`              | On `SIGTERM`, how long the server waits for the matches already running to finish before it snapshots them and exits. A Go duration (`90s`, `15m`) or bare seconds. Malformed values fall back to the default with a `WARN`, never to zero. Deliberately short and the same in both deployed environments (grace `150s`); local compose `5s`. |
| `LOCO_SNAPSHOT_PATH` | *(unset)*          | Where matches in flight are parked across a restart, so the players reconnect into them instead of losing the match. Unset disables the mechanism entirely, which is what local dev and the E2E suite run with. Production: `/data/snapshot.json`, bind-mounted from `${DATA_DIR}/snapshots`. |

---

## Features

Full grouped list: [`docs/features.md`](docs/features.md) — the lobby and the 1v1 queue, the whole
112-card deck and every rule on it, the interrupt and catch windows, bots that play the entire game,
the four maps and the synchronised load into them, three adaptive soundtracks synthesised at runtime,
and the server surfaces underneath all of it.

### Known Limitations

- No persistence: rooms and game state are in-memory only. A *graceful* restart is covered by the
  drain and the snapshot; a crash or a `SIGKILL` still clears everything
- Reconnect window is 60 seconds in an ordinary room (15 in a matchmade 1v1); longer disconnects
  permanently drop the player
- Matchmaking is a single first-come queue: no rating and no region. A ranked ladder would be a
  second queue beside it
- No spectator mode, no chat
- The resource ceilings are compile-time defaults (`MaxRooms`, `MaxClients`, `MaxConnsPerNet`,
  `MaxFailedJoins` in `server/hub/hub.go`), not environment variables. They are set generously enough
  that an operator should not need to reach for them; changing one is a rebuild
- `MaxConnsPerNet` counts per `/24` (or `/48`), the same truncation the logs use. On a
  carrier-grade NAT that groups unrelated players, so the limit is deliberately high rather than tight.
  The network comes from `LOCO_CLIENT_IP_HEADER` when the peer is a trusted proxy and from the peer
  otherwise: behind a reverse proxy that forwards nothing, every player counts as one network
- Maps are drawn at random and cannot be chosen; the four that ship are cosmetic only
- Wild Draw Four legality (should only be legal when no matching colour) not yet enforced
- Only English and French are translated; adding a language is a new file in `client/src/i18n/` and an
  entry in the `translations` map
- Audio is synthesised, not recorded: the result is deliberately arcade-like rather than orchestral
- The visual showcase and its screenshot harness are development tooling, excluded from production
  builds

---

## Privacy and legal

The game is free, non-commercial and account-free, and its compliance position is that it holds
almost nothing.

- **No account, no password, no email.** A nickname, typed at the door.
- **No cookie, no banner.** Browser storage carries only the session token (strictly necessary for
  reclaiming a seat) and preferences the player set themselves; both are exempt from consent under
  ePrivacy. No analytics, no tracker, no third-party request of any kind — the CSP in
  `client/nginx.conf` enforces it and `client/src/test/csp.test.ts` asserts it.
- **No address is ever logged in full**: every address is cut to a `/24` or `/48` prefix at the point
  of writing, in the server and in nginx alike.
- **Nothing is persisted** but a match in flight across a deploy, dropped as soon as it is reclaimed.
  A nickname lives in the room for the length of the match; there is no profile behind it and no
  stored entry to erase.
- **Privacy, terms and credits** are one content page (`/privacy/`, `/fr/confidentialite/`), linked
  from every footer in both languages. `client/src/test/legal.test.ts` pins the disclosures that are
  legal obligations rather than prose.
- **LOCO is not UNO.** It is an independent game with no connection to Mattel, Inc.; the mark appears
  in this repository's documentation descriptively and in the disclaimer that names it in order to
  disclaim it, and nowhere else. See [`NOTICE.md`](NOTICE.md).

Code is MIT ([`LICENSE`](LICENSE)); the map art is AI-generated and deliberately outside it. The
reasoning and the data inventory: [`docs/notes/legal.md`](docs/notes/legal.md).

---

## CI/CD & Deployment

GitLab CI (`.gitlab-ci.yml`) runs `test → build → deploy`; production traffic flows `Traefik → nginx
→ Go server`. GitLab is the only CI — the GitHub remote is a plain mirror with no pipeline, so there
is nothing to keep in sync.

Two things are worth knowing before touching it, and both are load-bearing:

- **`build` depends on *every* test job**, lint and the full Playwright run included. Listing a
  subset is what actually gates a deploy: with `needs: [backend_test, frontend_test]` the build
  started as soon as those two finished, so a red `develop` still shipped.
- **Nothing may use `artifacts:`** until the runner is fixed — its upload helper cannot resolve the
  GitLab API host, and a failed upload fails the job. `server-bin` travels by cache instead, with a
  `server-bin.sha` stamp so a shard never runs a binary built from another commit.

Pipeline breakdown, sharding, the `DEPLOY_DEV` switch, the drain-and-snapshot rollout and the
readiness checks: [`docs/deployment.md`](docs/deployment.md).

---

## Development Workflow

```
feature branch → tests → implementation → all tests green → update docs → commit
```

`CLAUDE.md` holds the engineering rules; `docs/notes/` holds the reasoning behind each one — the bug
that produced it, the alternative that was measured and rejected, and the edge cases a one-line rule
cannot express. Update the rule and its note in the same change set.
