# Loco – Real-time Multiplayer Card Game

A premium-quality real-time browser-based card game inspired by UNO. Play with friends in seconds using only a nickname — no accounts required.

---

## Product Goals

- Real-time, low-latency multiplayer gameplay via WebSockets
- Nickname-only access (no accounts, no passwords)
- Server-authoritative anti-cheat architecture
- Smooth, polished visuals powered by React + Framer Motion
- A look worth streaming: chunky cartoon art direction (Nintendo × Gartic Phone), readable at 720p over someone's commentary
- Fully synthesised audio — sound effects and a shuffled playlist of three adaptive soundtracks, zero audio assets shipped
- Reaction mechanics with server-side timing windows (UNO catch, interception slam)
- Full Docker-based local development and deployment

---

## Stack

| Layer     | Technology              | Reason                                                                |
|-----------|-------------------------|-----------------------------------------------------------------------|
| Backend   | **Go**                  | Low latency, native concurrency, small binary, excellent stdlib       |
| Realtime  | **WebSockets** (gorilla)| Persistent bidirectional connection; lowest latency for game events   |
| Frontend  | **React + TypeScript**  | Component model, type safety, wide ecosystem                          |
| Site      | **Astro** (static output) | Builds the game page and the content pages from one project. The game is *not* server-rendered: it mounts client-side exactly as before, so nothing about theme, language, session or board geometry has to be guessed on a server. Output stays static files behind nginx, no Node runtime in production |
| Bundler   | **Vite** (via Astro)    | Near-instant dev server, fast HMR                                     |
| Rendering | **React + Framer Motion** | DOM-based card rendering with declarative motion-driven animations    |
| State     | **Zustand**             | Minimal, fast React global state without boilerplate                  |
| Validation| **Zod**                 | Runtime schema for inbound `ServerMsg`; static types are inferred from it (no Go↔TS type drift) |
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
├── server/                # Go game server
│   ├── game/              # Authoritative domain logic (cards, deck, hand, room, rules, bot)
│   ├── hub/               # WebSocket event loop, rate limiting, session tokens, room cleanup
│   ├── protocol/          # Wire message schema (client ↔ server)
│   ├── main.go
│   └── Dockerfile
├── client/                # Astro site + React/TypeScript game
│   ├── astro.config.mjs   # Integrations, dev server, dev-toolbar off, React fast-refresh preamble
│   ├── src/
│   │   ├── pages/         # One .astro per URL: /, rules, cards, tables, play-with-friends, faq, /fr/…
│   │   ├── layouts/       # Base.astro (<head>), GamePage.astro, ContentPage.astro
│   │   ├── content/       # Prose + data behind the content pages; never imported by the app
│   │   ├── entry.tsx      # Mounts React into #root (a bundled module script, never an island)
│   │   ├── theme.ts       # The theme, React-free, so a content page can apply it too
│   │   ├── seo/           # meta.ts: the page registry + link-preview tags, as data
│   │   ├── components/    # UI screens (Lobby, WaitingRoom, GameView, GameOver, RulesModal, …)
│   │   ├── components/cards/  # React + Framer Motion card renderer (GameBoard, Hand, Card, AnimationLayer, …)
│   │   ├── audio/         # Synthesised SFX, music engine, tracks/ (music as data), store bridge
│   │   ├── dev/           # Dev-only visual showcase (scene registry, tree-shaken in prod)
│   │   ├── hooks/         # WebSocket transport + Zustand store + held-key hook + preferences (theme, streamer mode)
│   │   ├── i18n/          # I18nProvider + en/fr translations + server-error copy
│   │   ├── styles/        # Design tokens (single source of truth for colour/type/shape)
│   │   ├── types/         # Protocol TypeScript types
│   │   └── test/          # Vitest unit tests
│   ├── public/maps/       # Map art: <id>/room.webp + table.webp, see "Map art"
│   ├── nginx.conf         # Production reverse proxy
│   └── Dockerfile
├── e2e/                   # Playwright suite (separate package.json)
├── tools/visual/          # Screenshot harness (shoot.mjs) — see "Visual QA"
├── tools/og/              # Link-preview generator (shoot.mjs → client/public/og.png, og.fr.png)
├── tools/icons/           # favicon.svg → manifest icons + favicon.ico (shoot.mjs)
├── tools/maps/            # Map art cropper/encoder (prepare.mjs), see "Map art"
├── docs/                  # Rules spec and supplemental docs
│   └── notes/             # Engineering notes: the reasoning behind CLAUDE.md's rules
├── deploy/                # Production compose + traefik config
├── docker-compose.yml     # Production-style full-stack compose
├── docker-compose.dev.yml # Development compose (bind mounts, hot reload)
├── .env.example
├── CLAUDE.md
└── README.md
```

---

## Architecture

### Authority Model

The **server** owns all authoritative state:
- Room lifecycle (lobby → playing → finished)
- Player hands (hidden from other clients)
- Deck and discard pile
- Turn order and direction
- Legal move validation
- Draw penalties and counter resolution
- UNO declaration and catch timing windows
- Winner determination

The **client** owns only presentation:
- Rendering the player's own hand (received from server)
- Animations and visual state
- Sending intents (play card, draw, declare UNO, catch)

### Realtime Model

- One persistent WebSocket per player
- The Hub runs a single-goroutine event loop (no locks needed on room state)
- All game mutations happen in the hub's event loop
- Each client gets a personalized view of game state (own hand visible; others' hand size only)
- Timing for UNO catch is enforced server-side using `time.Now()` at message receipt
- All deferred async work (bot moves, reconnect expiry, room cleanup) uses `time.AfterFunc` — no long-lived sleeping goroutines; goroutine count remains O(connections), not O(rooms × events)
- Critical timer callbacks (botMove, expire, cleanup) retry once on channel-full before logging `WARN`; per-client output drops are tolerated with client notification

**Latency budget.** Interrupts are resolved by arrival order at the server, so every hop is tuned
for the smallest possible delay rather than the fewest bytes:

- nginx forwards the WebSocket tunnel with `tcp_nodelay on` and `proxy_buffering off`. Gameplay
  messages are a few hundred bytes, the exact size Nagle holds back waiting for a fuller segment,
  which would add up to 40 ms to a card play on a hop the app cannot see.
- WebSocket compression is deliberately disabled: no useful saving at these payload sizes, and it
  would put a deflate pass plus a flush on both ends of every play.
- The client sends the play before it animates it, and animates nothing for a tap it refuses or a
  tap that only opens the colour/target prompt.
- The reconnect backoff starts at 250 ms (250 / 500 / 1000 / 2000 / 4000). Most drops come straight
  back, and a dead board costs a whole interrupt window.
- A **reload survives too**: room, nickname and session token are mirrored into `sessionStorage`, so
  a refreshed or crashed tab boots onto a reconnect screen and reclaims its seat instead of landing
  back on the lobby with the match still running. `sessionStorage` rather than `localStorage` on
  purpose: it is per tab, so two seats played from one browser cannot overwrite each other's token,
  and it dies with the tab rather than handing the next person a live seat.
- The **last nickname is remembered across visits** (`localStorage`, written when a room is created or
  joined) and prefills the lobby field, so a returning player types a room code and nothing else. It
  is only a suggestion: the field stays editable and an empty one still refuses to send. It is also
  what lets a **shared table link** seat somebody in one tap: the link carries the table, the browser
  already has the name, and only a browser with neither is asked for one.

### Anti-Cheat

- Card legality validated server-side on every `play_card`
- Cards verified to be in the player's hand before play
- Turn enforcement: out-of-turn actions are rejected
- Client timestamps are never trusted; only server receipt time is used for catch windows
- Hidden state (other players' hands) never sent to wrong client
- Session tokens: cryptographically random token issued on join/create, required to re-claim a slot on reconnect — prevents slot hijacking. Compared in constant time, and **rotated on every reclaim**: the spent token stops working the moment it is used
- Per-client rate limiting: token bucket (10 msg/s, burst 20) — rejects flood attacks at the connection layer
- Gameplay is refused while the room is still loading its map: the fairness of the loading gate cannot rest on every client honouring its own loading screen
- Gameplay messages are refused outright at a table that has not dealt, and `dispatch` recovers from any handler panic. One message can cost one message: every inbound message is handled on a single goroutine, so an unhandled panic used to be the whole process and every match on it
- Connection and table ceilings, refused before the WebSocket upgrade (`MaxClients`, `MaxConnsPerNet`) and at `create_room` (`MaxRooms`). A table outlives the socket that opened it by five minutes, so creating them in a loop was unbounded growth for the price of a handshake
- A wrong table code is budgeted: 20 misses per network per minute, then `join_room` is refused for the rest of the window. Table codes are read out loud on stream, so the code is not a strong secret; what this stops is a script sweeping for open tables
- A refused reclaim never names the roster: a stranger and a returning player with a stale token get the same answer, so a table code cannot be used to test which nicknames are seated

### Message Protocol

JSON over WebSocket. Full message catalogue and DTO shapes: [`docs/protocol.md`](docs/protocol.md).

---

## Game Rules

See [`docs/rules.md`](docs/rules.md) for the full, canonical rules specification.

---

## Local Setup (Without Docker)

### Prerequisites
- Go 1.22+
- Node.js 22.12+ (Astro 7 declares it in `engines`; `npm ci` fails on 20). The Docker images build on the current LTS, 24.

### Backend

```bash
cd server
go mod download
go run .
# Server listens on :8080
```

### Frontend

```bash
cd client
npm install
npm run dev
# Dev server at http://localhost:3000 (proxies /ws → :8080)
```

---

## Docker Usage

### Production-style (pre-built images, nginx)

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000

The Go server itself is **not published on a host port** here, so this stack matches the
deployed one: nginx is the only way in, and it proxies `/ws` and nothing else. Both
`/health` and `/metrics` are operator surfaces and neither is reachable from outside:
`/health` answers with the live room and player counts and with `draining`, which sizes
the server for anyone thinking of loading it and announces the window in which new tables
are refused. Docker's own healthcheck reads it from inside the container, which is also
how you read either of them:

```bash
docker compose exec server wget -qO- http://localhost:8080/health
docker compose exec server wget -qO- http://localhost:8080/metrics
```

`/metrics` returns JSON: room and player counts, `goroutine_count` for runtime health, and
the abuse/pressure counters (`messages_rate_limited`, `messages_dropped_busy`,
`slow_clients_closed`, `suspected_cheats`, `conns_refused`, `joins_throttled`).
`handler_panics` is the one to alert on: the event loop recovers rather than dying, so any
value above zero is a bug that nothing else surfaces. `debug_mode_active` must read
`false` in production.

The server container runs as an unprivileged user with no capabilities and a read-only
root filesystem, so it can write nothing but the shutdown snapshot on its `/data` mount.

### Development compose (hot reload, no host toolchain needed)

Use `docker-compose.dev.yml` during active development. Go and Node run inside containers; source files are bind-mounted so changes are picked up without rebuilding images.

```bash
docker compose -f docker-compose.dev.yml up --build
```

- Frontend (Astro dev): http://localhost:5173
- Backend (go run): http://localhost:8080
- WebSocket: `ws://localhost:8080/ws` (browser connects directly — no dev-server proxy)

Go module downloads are cached in a named volume (`go-mod-cache`) and `node_modules` are isolated inside the container (`client-node-modules`), so restarts are fast.

### Stop

```bash
docker compose down                              # production
docker compose -f docker-compose.dev.yml down    # dev
```

---

## Environment Variables

| Variable          | Default               | Description                                              |
|-------------------|-----------------------|----------------------------------------------------------|
| `PORT`            | `8080`                | Go server listen port                                    |
| `CLIENT_PORT`     | `3000`                | Nginx (frontend) listen port (production compose)        |
| `VITE_WS_PORT`    | `8080`                | Go backend port for direct WS connections in dev (`ws://<host>:<port>/ws`) |
| `LOCO_ALLOWED_ORIGINS` | *(unset)*        | Comma-separated exact browser origins allowed to open a WebSocket. Unset means "same hostname as the request", port-insensitive, which already covers production and dev. |
| `LOCO_E2E`        | *(unset)*             | `1` enables `debug_set_state`, used by the Playwright suite. **Never set in production** — the server logs a startup `WARN` and `/metrics` reports `debug_mode_active`. |
| `LOCO_BOT_THINK_MS` | `1200`              | Bot thinking time before playing a card. Read **only** when `LOCO_E2E=1`; ignored (with a `WARN`) if malformed or negative. Shortened in CI to cut dead time out of the E2E suite. |
| `LOCO_BOT_JITTER_MS` | `1000`             | Random jitter added to `LOCO_BOT_THINK_MS`. Same gate and same validation. Bot *reaction* windows (catch, LOCO! declaration, interrupt) are deliberately not tunable. |
| `LOCO_DRAIN_TIMEOUT` | `15m`              | On `SIGTERM`, how long the server waits for the matches already running to finish before it snapshots them and exits. A Go duration (`90s`, `15m`) or bare seconds. Malformed values fall back to the default with a `WARN`, never to zero. Prod `15m`, dev `90s`, local compose `5s`. |
| `LOCO_SNAPSHOT_PATH` | *(unset)*          | Where matches in flight are parked across a restart, so the players reconnect into them instead of losing the match. Unset disables the mechanism entirely, which is what local dev and the E2E suite run with. Production: `/data/snapshot.json`, bind-mounted from `${DATA_DIR}/snapshots`. |

Copy `.env.example` to `.env` and adjust as needed.

---

## Test Commands

> Shortcut: `make test` runs server + client tests, `make lint` runs both linters, `make help` lists all targets. Targets are docker-first so a host Go install isn't required.

### Backend (Go)

```bash
cd server
go test ./...           # all tests
go test ./game/... -v   # domain tests with verbose output
golangci-lint run ./... # static analysis (or: make lint-server, runs in docker)
```

### Frontend (Vitest + ESLint)

```bash
cd client
npm test               # single run
npm run test:watch     # watch mode
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
```

### Visual QA (screenshot harness)

Every screen and every meaningful state is registered as a *scene* in
`client/src/dev/scenes.ts` and can be rendered with no server, no WebSocket and
no second player:

```bash
cd client && npm run dev
# then open http://localhost:3000/?showcase          → scene index
#            http://localhost:3000/?showcase=game-uno → one scene, full-screen
```

`make visual` drives the same scenes through Playwright and writes PNGs plus one
contact sheet per viewport/theme into `.visual/` (git-ignored):

```bash
make visual                                              # everything
make visual ARGS="--scenes=game-my-turn --viewports=mobile"
make visual ARGS="--viewports=wide"                      # 1920×1080, board scaled up
make visual ARGS="--viewports=small"                     # 360×640, board scaled down
make visual ARGS="--viewports=notch"                     # phone with a notch + home indicator
make visual ARGS="--themes=dark --motion"                # keep animations running
```

Use it whenever you touch layout, colour or motion: reviewing 24 scenes × 2
themes × 2 viewports as four images catches regressions (a clipped heading, a
theme that never applied) that no assertion was ever going to describe.

The showcase is gated behind `import.meta.env.DEV`, so Rollup drops it — and its
chunk — from production builds.

### Being findable (SEO)

Full reasoning in [`docs/notes/seo.md`](docs/notes/seo.md). The short version:

- **`client/src/seo/meta.ts` is the single source.** A page appears once in `PAGES`, with its path,
  title and description per language; the sitemap, the `hreflang` sets, the canonical and
  `src/test/seo.test.ts` all read it. The test refuses a page declared there with no source file
  behind it — the sitemap would otherwise hand Google a URL that 404s.
- **English at `/`, French under `/fr/`**, generated by Astro's `i18n` with
  `prefixDefaultLocale: false` so the game's own URL stays `/`. A French URL opens in French even
  for an English browser, via `data-served-lang` on `<html>`.
- **Twelve indexable pages**: the game, the rules, the cards, the tables, playing with friends and
  the FAQ, each in both languages. All are readable with JavaScript disabled, which
  `e2e/tests/seo.spec.ts` checks by turning it off.
- **`VITE_PUBLIC_ORIGIN` must reach the build.** Canonical, `hreflang` and `og:` are absolute and
  cannot be filled in at runtime. `client/Dockerfile` takes it as an `ARG`; `.gitlab-ci.yml` passes
  `https://${APP_HOST}`, already `-d.` on `develop` and the bare host on a `v*` tag.
- **nginx answers a missing page with a real 404**, advertises `sitemap-index.xml` on production
  hosts only, gzips text and caches `/_astro/` for a year.
- `make icons` rasterises `favicon.svg` into the manifest sizes and `favicon.ico`. Committed, like
  `og.png`, because CI has no browser.

### Link preview (Discord / X)

The game is meant to be shared as a link, so the preview card is a product
surface, not metadata. `client/public/og.png` (1200×630) is rendered from the
`og-card` scene — the **real** `<LocoLogo />` and the **real** `<Card />`, so the
duck on the preview is the duck on the cards is the duck in the tab:

```bash
make og                                     # → client/public/og.png (English)
make og ARGS="--lang=fr --out=client/public/og.fr.png"
```

The PNG is **committed**: the client image is built by `npm run build` in CI,
which has no browser, and a preview that 404s is worse than no preview.

- Absolute URLs are required — crawlers resolve `og:image` against nothing.
  `client/src/seo/meta.ts` holds the origin (`ORIGIN`, defaulting to production,
  overridable with `VITE_PUBLIC_ORIGIN`) and builds every tag through
  `absolute()`. `src/layouts/Base.astro` renders them.
- Discord and X **cache a preview by URL** for days. Bump `OG_VERSION` in
  `client/src/seo/meta.ts` whenever the art changes, then re-scrape from X's
  Card Validator or by re-posting the link.
- `twitter:card` is `summary_large_image`; without it X renders a 120px
  thumbnail instead of the card.
- Previews will **not** render on the `-d.` dev host: nginx serves
  `robots.txt: Disallow: /` there and X's crawler honours it. That is deliberate.
- `client/src/test/ogCard.test.ts` asserts the tags exist, point at absolute
  URLs, and declare the dimensions the committed PNG actually has — nothing else
  in the suite would notice the preview breaking.

### Map art

The four rooms ship as `client/public/maps/<id>/room.webp` (the space) and
`table.webp` (the table, cut out against transparency), about 1.75 MB in total.
They are **committed**, for the same reason `og.png` is: the client image is
built in CI, which has no browser to render anything.

```bash
make maps ARGS="--src=/path/to/Maps"        # one folder per map, two images each
```

`tools/maps/prepare.mjs` crops each table to its alpha bounding box and
re-encodes both files to WebP. Two things about it are worth knowing:

- **Which source file is the table is read off the alpha channel, never the
  filename.** The renders arrive named after their timestamp; an earlier version
  guessed by frame brightness, on the assumption that the tables sat on a grey
  backdrop, and got all four maps backwards. That grey was the image viewer
  showing through the transparency.
- The crop is what makes the placement numbers honest. `maps.ts` positions each
  table by a `playfield` rectangle expressed as fractions of the file, so any
  dead margin left in the file would be a constant every one of those numbers
  had to carry.

Those `playfield` numbers are measured **by eye** off the art, and nothing but a
screenshot will catch a drifted one: the cards simply stop sitting on the
table. Review any change to the art with:

```bash
make visual ARGS="--scenes=game-map-neon,game-map-rune,game-map-velvet,game-map-orbit,game-map-loading"
```

### Audio verification

Sounds are synthesised, so a broken envelope produces silence rather than an error — nothing fails
and nothing logs. `make audio-verify` plays every voice through a real `AudioContext` in a browser
and measures the peak amplitude on the bus:

```bash
make audio-verify
# ✓ cardPlay     peak=0.1179
# ✓ interrupt    peak=0.4444
# ✓ adaptivity   calm=0.0369 tense=0.0715 (×1.94)
# ✓ slew         reached calm=0.08 tense=1.00
# ✓ duck         before=0.0709 during=0.0152
# ✓ mute         peak=0.0000 (want ~0)
```

It also checks the claims the music bed makes about itself — that tension is audible, that the
intensity ramp reaches its targets, and that ducking attenuates.

It is deliberately **not** part of CI: audio devices in CI containers are unreliable, and a flaky
sound assertion only teaches people to ignore a red pipeline. Run it after touching
`client/src/audio/`.

### Content-Security-Policy

The CSP lives in `client/nginx.conf`, and nothing in the normal loop ever meets it: unit tests read
files, and the E2E suite runs against the dev server, which sends no such header. A wrong
policy therefore passes every build and fails only the served page.

This is also why **the game is mounted by a bundled module script and never by an Astro island**:
a `client:*` directive makes Astro emit its hydration runtime as two *inline* `<script>` blocks,
which `script-src 'self'` refuses. Astro's own `security.csp` answers that with hashes in a
`<meta>`, which does not help — a meta policy and this header are both enforced, so the header
still blocks them and the page renders blank in production alone. `csp.test.ts` fails on any
`client:*` directive for exactly this reason.

`client/src/test/csp.test.ts` pins the policy to the app it protects (no inline script, no remote
origin, no `eval`, `$http_host` rather than `$host`). `make csp` answers the other half, whether the
built client actually runs behind the header nginx sends:

```bash
make csp                                    # up --build, check in a real browser, down
make csp ARGS="--url=http://localhost:3000/"   # check a stack that is already running
```

```
"csp": "default-src 'self'; script-src 'self'; … connect-src 'self' ws://localhost:3000 …",
"sockets": ["ws://localhost:3000/ws"], "reachedWaitingRoom": true,
"fontsLoaded": 8, "problems": []
✓ clean under the served CSP
```

Reaching the waiting room is the verdict: it only appears after a WebSocket round trip, so it proves
`connect-src` lets the one connection the game is made of through. Also outside CI, and worth
running after any change to `nginx.conf`.

### End-to-End (Playwright)

Playwright starts its own isolated dev server on `http://localhost:4173`.
Only the Go server must be available on `:8080`.

It passes `--ignore-lock`: `astro dev` is a singleton, and without that flag a second invocation
prints "dev server already running" and exits without binding 4173, so the whole suite times out
for the sole reason that `make dev` is up in another terminal.

**Quickest local setup — use Docker Compose:**

```bash
# Terminal 1: start all services
docker compose -f docker-compose.dev.yml up --build

# Terminal 2: install browsers (first time only) and run tests
cd e2e
npm ci
npx playwright install chromium
npm test                          # headless
npm run test:headed               # watch browsers
npm run test:ui                   # interactive Playwright UI
```

**Without Docker (Go + Node installed locally):**

```bash
# Terminal 1
cd server && go run .

# Terminal 2
cd e2e && npm ci && npx playwright install chromium && npm test
```

**Test projects included:**

| Project         | Tests                                                                                     | Viewport     |
|-----------------|-------------------------------------------------------------------------------------------|--------------|
| `chromium`      | `game-flow`, `multi-client`, `penalties`, `round-progression`, `reconnect`, `rematch`, `rules-coverage`, `special-cards` | Desktop   |
| `mobile-chrome` | `mobile`                                                                                  | Pixel 5 (360×800) |

**Coverage areas:**
- Lobby, waiting room, and game-start flow
- Draw, pass, and play-card actions (BO1 + BO3)
- Turn timer bar visibility
- Error toast on invalid play
- Last-card catch window ("LOCO!" declaration button, Catch! button, timer), including the seat a Swap hands its last card to
- Missed Contre-LOCO! penalty (+1 card to the caller, button spent on press)
- Pending-draw counter on Draw button
- Penalty absorption (pendingDraw clears, turn advances)
- BO3 multi-round progression (round 2, auto-dismiss, game over)
- Spectating banner (local player finishes before round ends)
- WebSocket reconnect (offline/online cycle, reconnect overlay, two-client disconnect)
- Session restore across a page reload: the seat and hand come back mid-match, the waiting room is
  rejoined, and a session naming a dead room falls back to the lobby instead of hanging
- Swap card PlayerPicker UI, Swap E2E hand change, GlobalSwitch colour prompt + discard update
- Swap / Global Switch on-screen notification banner + Framer Motion card-back trail animation between affected seats
- counter_draw stacking, interrupt_play_card lead-taking (single + batch, wilds included), interrupt window open/closed
- Rematch: one ask deals nothing, everybody's asks reopen the finished room and play a full new match, a player leaving retires their ask and completes what is left of the agreement
- Mobile touch targets (44px+), color picker, rules modal, canvas size

---

## Implemented Features

- **Lobby**: nickname-only rooms (the last nickname is remembered and prefilled), 6-char codes, host-only start, BO1/BO3/BO5/BO7 selection, max-players 2–10, AI bots.
- **A table is shared as a link.** Pressing the code in the waiting room copies a URL that opens the game already pointed at that table (`/?t=CODE`), so the person receiving it has nothing to read out, nothing to retype and no screen to find first. The code itself stays on screen: it is what a stream reads out loud and what somebody already sitting at the join form types. The link carries no language, because it gets forwarded and the sender does not know who ends up pressing it. A link carries a table and never a player, so the arrival is asked for a name — unless this browser already remembers one, in which case they are seated on the spot. The code comes straight back out of the address bar on arrival: a reload then reclaims the seat instead of re-joining, a code never sits in the URL bar where streamer mode cannot blur it, and a URL copied later stops naming a table that has since closed.
- **The host owns their table before the deal**: any seat but their own can be freed from the roster with one press, bots included — that is the only way to take a bot's seat back. The table sees an ordinary departure and the removed player is told why, on the screen they land on. It is deliberately **not** a ban: the code is still in their hands and they can sit back down. There is no identity in this game to refuse somebody by, and the one handle that would remain is an address, which is exactly what is never kept. Refused once the cards are out, and in a matchmade room, which has no host at all.
- **Nickname validation**, server-authoritative (`server/game/nickname.go`), because the nickname is the one string a player authors and it ends up on a seat, in the score table and in somebody's clip. Up to 20 *characters* (not bytes), written in Latin, Greek or Cyrillic letters, digits, single spaces and `-_.'`; that allowlist is what keeps out the zero-width characters, the right-to-left overrides that reverse a seat label, emoji, and stacked combining marks. Insults and hate terms are filtered on a normalised form (case, diacritics, leetspeak, separators and repeated letters all folded), against Shutterstock's [LDNOOBW lists](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) in 19 languages, embedded in the binary — no service, no key, no request. Short terms only match a whole word so that Constance, Dominique, Cassandra and Scunthorpe still get to play. **Every refusal is the same one line**, in both languages, whichever rule fired: a message that names the rule is a hint for the next attempt. The client (`client/src/components/nicknameRules.ts`) checks the shape as you type so the answer is instant, and ships none of the word list.
- **Gameplay**: full 112-card deck, 8-card deal, all action cards (Skip, Reverse, +2, Wild, +4, Swap, Global Switch), +2/+4 stacking (eating a stack costs cards, not the turn — `docs/rules.md` §14.5), identical-card interrupt with no time limit — any card kind, any player, including the one who just played (single + batch), batch turn play, last-card declaration (the "LOCO!" button; wire type stays `declare_uno`; one call per single card, and the button is spent once the server confirms it) + a per-seat 5 s catch window that also covers the players a Swap or a Global Switch leaves holding a single card (Contre-LOCO! is a wager: a call that arrives after the declaration, after the hand grew, or after the window closed costs the caller 1 card — `docs/rules.md` §14.6), single-finisher round scoring, multi-round matches with tiebreakers and sudden-death.
- **1v1 matchmaking**: one button on the home screen puts a player in a queue and pairs them with whoever else is looking. There is no host, no code to share and no lobby: two searchers get a versus reveal naming their opponent, and the match deals itself two and a half seconds later, in a single round. At the end either player can ask for another: a matchmade rematch is an **agreement**, so both offers are public and the same two are dealt in again only once both are in. Whoever wants a different opponent instead goes straight back into the queue from the same screen. **The queue's size is never on the wire**: not as a count, not as a position, not as an estimate. So the searching screen times its own wait instead and says, at fifteen and at forty-five seconds, that it is still looking and that this can take a while; past that it also offers to open a private table. A number that reads "1 player searching" is an instruction to give up, and every player who leaves on it is the opponent the next one was about to get. The mode carries no rank and does not call itself unranked: there is one queue today, and a ranked ladder would introduce itself.
- **Nobody waits for somebody who is not there**: a matchmade match holds a dropped seat for **15 s** rather than 60, and the player still at the table watches that countdown on the board. Two consecutive turn timeouts (instead of four) end it the same way. Either way the match is **forfeited** to whoever stayed: named as a forfeit on the game-over screen, with no confetti and no points invented for a round nobody finished. Quitting on purpose does the same thing immediately. Ordinary rooms are untouched: they are people who came in together, and the 60 s hold is there so a drop is not the end.
- **Preferences** (the gear in the top bar of every screen, board included): language, theme, and three switches.
  - **Streamer mode** blurs the table code everywhere it is drawn, the waiting room and the reconnect splash. A code read off a stream is an open table, and the waiting room is the one screen a streamer is guaranteed to sit on. The code itself is untouched: the press still copies a working link to the table, and hovering or focusing the value clears the blur so the owner can read it out loud.
  - **Colour shapes** give each suit a silhouette (triangle, circle, square, diamond) on the card, on every colour picker and on the active-colour chip, so hue is never the only thing telling two cards apart. Colour is a rule in this game, not decoration.
  - **Reduced motion** stops the card flights and the confetti. It follows the system setting until it is set here, and then wins over it in both directions.
  All of them live in `localStorage` and none is ever sent to the server.
- **Rematch**: after a match, another one is an agreement rather than a decision. Every seat gets the same button, every ask is public, and the room reopens (same code, same roster, cleared scores) once everybody still at the table has asked; absent seats are pruned and everyone else is pulled back to the waiting room. A player leaving takes their ask with them and stops being waited on, so a table that was only waiting on them reopens right there. Bots are not asked, so a solo table with bots reopens on one press.
- **UI**: React + Framer Motion animations (transform-only card movement, seat→pile card flights, spring hand reflow, staggered deal, `prefers-reduced-motion` support), round summary overlay, match-end screen with confetti, mobile support (44 px+ targets), rules modal, EN/FR i18n (including every refused action, which is translated into player-facing
  copy rather than showing the server's own English string), light + dark themes. On a phone with a notch the page runs edge to edge (`viewport-fit=cover`) so the
  room's picture reaches every edge of the screen, while the board, the action bar and the top cluster
  keep clear of the notch and the home indicator: without the first half iOS paints those bands with the
  page's own colour, which laid two bright strips across a dark room.
- **Card feel**: cards are tiered by scarcity for presentation only — a number lands clean and quick, a coloured action spins once flat, a wild spins twice, arriving bigger, ringed by a shockwave and kicking the board. Special cards carry a trading-card foil (masked to the frame so suit colour survives stream compression) with a travelling highlight desynchronised per card. The discard pile reveals its new top **on impact**, so the throw is the reveal.
- **Art direction**: chunky cartoon system — ink outlines, solid press-down shadows, a dark table with a real rim. Seats resize and wrap so a nine-player table stays readable on a phone. Design tokens live in `client/src/styles/tokens.css`.
- **The deck has its own identity**: each face is a full-bleed suit gradient with the LOCO mark — a geometric wireframe duck, straight from the brand's source file — behind it in the *same gradient reversed*, drawn as one SVG (`client/src/components/cards/CardArt.tsx`, `cardArtSpace.ts`, `locoMark.ts`). On a card the mark is deliberately **cropped and tilted** so the artwork runs off all four edges and under the value; the logo (`LocoLogo.tsx`), the favicon and the table watermark show it **whole**. Card faces do not follow the light/dark theme — a card is an object, not a control. Every glyph is ink-outlined: off-white on the green suit is 1.2:1, and outlined it clears 14:1 on every face.
- Review the whole deck on one screen with `make visual ARGS="--scenes=card-sheet"`.
- **Score table**: hold `TAB` during a match (or tap the **Scores** button, which is how it opens on a phone) for the standings: seat colour, nickname, one column per finished round, cumulative total, rounds won, and a live ping per player coloured by how much it costs in a race (green under 60 ms, red past 220 ms). Both the per-round history and the ping are measured and broadcast by the server, so they survive a reconnect and cannot be self-reported.
- **Maps**: every match is dealt into one of four rooms: **Neon** (a rooftop club above the skyline), **Rune** (the back room of an arcane tavern), **Velvet** (an art-deco lounge) and **Orbit** (a starship hangar). A map is a backdrop, a table and an accent colour; it changes no rule and no card. The **server** draws it once per match and tells every seat, so the whole table plays in one room and a clip cut between two players does not jump between two rooms. A rematch draws a new one. The accent tints the light the table casts and the direction ring, never the brand red, the active seat's gold or a card face, because those are how a viewer reads the game, and a state cue that changes colour with the scenery has to be re-learned four times.
- **Synchronised loading**: between "hands dealt" and "clock running" the table stays shut while every client downloads and decodes the map, on a screen that names the room, describes it in a line, and shows who is still loading. The turn clock starts when the last player is in, not before. A map is around 600 kB, and in a game decided by arrival order, starting the first turn while somebody's table is still a grey rectangle is a head start rather than a slow paint. Gameplay messages are refused server-side until then, so skipping the screen buys nothing, and a 20 s deadline means one backgrounded tab cannot hold the room hostage.
- **Streamable moments**: interception slam (banner + screen shake + sting) on a successful out-of-turn steal, Contre-LOCO! verdict stamp (with the two penalty cards flying to the caught seat), UNO punch-in banner, floating SKIP/REVERSE/+N callouts, per-seat identity colours, exact card counts on every opponent.
- **Play direction on the table**: a ring of chevrons runs around the felt showing which way play is moving, chasing slowly in that direction and flipping over when a Reverse lands. The callout lasts a second; the heading lasts the rest of the round, so a player who looked away — or a viewer who just opened the stream — can still read whose turn comes next.
- **Audio**: runtime-synthesised effects for every action and rule outcome, plus **three adaptive soundtracks** — *Neon Horizon* (uplifting trance, 138 BPM), *Pixel Rush* (electro house, 128) and *Voltage* (dark electro, 145) — each written as parts (intro, verse, chorus, bridge, break) rather than a loop. They play as a **shuffled playlist**: a track runs about two minutes, then hands over on its own, and the only control is a ⏭ next button. Two things drive what you hear: the **song form** advances by itself, so around forty bars pass before a part returns, and the **table's tension** picks how thickly it is played *and* which part comes next — a breakdown between rounds, a build-up in the lobby, a groove during play, the full drop when someone is one card from winning. Risers and crashes announce a chorus, fills close every part, and the bed ducks under the win/lose fanfares. Per-bus mixer (overall / effects / music) with mute, persisted across sessions. Nothing plays before the first user gesture.
- **Bots that play the whole game**: they take turns, counter a draw stack, declare LOCO! and call Contre-LOCO! — and they **interject**, slamming an identical card into an open window like anybody else. Until they did, the game's signature mechanic ran one way only, which made the hardest reaction in the game also the one nobody had to defend against. They are deliberately fallible: they take about a second to react and use the window they see roughly two times in five.
- **Server / infra**: per-player personalized state, 60 s reconnect window with visual recovery (a page reload reclaims the seat too, not just a dropped socket), session tokens, per-client rate limiting (10 msg/s, burst 20), `Origin` checking on the WebSocket upgrade (same host by default, `LOCO_ALLOWED_ORIGINS` to narrow), a closed CSP and the usual security headers from nginx, AFK auto-kick (a forfeit rather than a kick in a matchmade 1v1), a 1v1 matchmaking queue whose size is exposed only on `/metrics`, append-only event log, `GET /health` + `GET /metrics`, structured logging, empty-room cleanup, **a graceful shutdown that lets the matches in progress finish and carries across a restart whatever they do not** (see below), Docker dev + prod compose.

Full grouped list: [`docs/features.md`](docs/features.md).

---

## Known Limitations

- No persistence: rooms and game state are in-memory only. A *graceful* restart is covered (see "Deploying without interrupting a match" below), but a crash or a `SIGKILL` still clears everything
- Reconnect window is 60 seconds in an ordinary room (15 in a matchmade 1v1); longer disconnects permanently drop the player
- Matchmaking is a single first-come queue: no rating and no region. A ranked ladder would be a second queue beside it
- No spectator mode
- No chat
- The resource ceilings are compile-time defaults (`MaxRooms`, `MaxClients`, `MaxConnsPerNet`, `MaxFailedJoins` in `server/hub/hub.go`), not environment variables. They are set generously enough that an operator should not need to reach for them; changing one is a rebuild
- `MaxConnsPerNet` counts per `/24` (or `/48`), which is the same truncation the logs use. On a carrier-grade NAT that groups unrelated players, so the limit is deliberately high rather than tight
- Maps are drawn at random and cannot be chosen; the four that ship are cosmetic only and have no effect on play
- Wild Draw Four legality (should only be legal when no matching color) not yet enforced
- Only English and French are currently translated; adding a language requires a new file in `client/src/i18n/` and an entry in the `translations` map
- Audio is synthesised, not recorded: the result is deliberately arcade-like rather than orchestral
- The visual showcase and its screenshot harness are development tooling; they are excluded from production builds

---

## Privacy and legal

The game is free, non-commercial and account-free, and its compliance position is simply that it holds almost nothing.

- **No account, no password, no email.** A nickname, typed at the door.
- **No cookie, no banner.** Browser storage carries only the session token (strictly necessary for reclaiming a seat) and preferences the player set themselves. Both are exempt from consent under ePrivacy. There is no analytics, no tracker and no third-party request of any kind; the CSP in `client/nginx.conf` enforces that, and `client/src/test/csp.test.ts` asserts it.
- **No address is ever logged in full.** `hub.truncateAddr` and the `anonymised` `log_format` in `client/nginx.conf` cut every address down to a `/24` or `/48` prefix at the point of writing.
- **Nothing is persisted** but a match in flight across a deploy, which is dropped as soon as it is reclaimed. A nickname lives in the room for the length of the match: there is no scoreboard that outlives it and no profile behind it, so there is no stored entry to erase.
- **Privacy, terms and credits** are one content page (`/privacy/`, `/fr/confidentialite/`), linked at the right-hand end of every footer, in English and French. The copy is `client/src/content/legal.ts`, read at build time, so it ships in no bundle; `client/src/test/legal.test.tsx` pins the disclosures that are legal obligations rather than prose.
- **LOCO is not UNO.** It is an independent game with no connection to Mattel, Inc.; the mark appears in this repository's documentation descriptively and in the disclaimer that names it in order to disclaim it, and nowhere else. See [`NOTICE.md`](NOTICE.md).

Code is MIT ([`LICENSE`](LICENSE)); the map art is AI-generated and deliberately outside it. The reasoning, the data inventory and what is still open: [`docs/notes/legal.md`](docs/notes/legal.md).

---

## CI/CD & Deployment

GitLab CI pipeline (`.gitlab-ci.yml`) runs `test → build → deploy`; production traffic flows `Traefik → nginx → Go server`. Full pipeline breakdown, request path, and readiness checks: [`docs/deployment.md`](docs/deployment.md).

`build` depends on **every** test job — Go tests, `golangci-lint`, the client suite and the full Playwright run. Listing only a subset is what actually gates a deploy: with `needs: [backend_test, frontend_test]` the build started as soon as those two finished, so the lint and the E2E suite were advisory and a red `develop` still shipped.

GitLab is the only CI. The GitHub remote is a plain mirror with no pipeline of its own, so `.gitlab-ci.yml` is the single definition and there is nothing to keep in sync.

### Deploying without interrupting a match

A deploy used to end every match in progress, silently: nothing caught `SIGTERM`, so the process died mid-turn and the clients that reconnected a moment later were told "no table with that code". Two mechanisms replace that, and both run on every shutdown.

- **Drain.** On `SIGTERM` the server stops accepting anything that would start a new match (`create_room`, `start_game`, `rematch`, `find_match`, and joining a table it does not have) and empties the matchmaking queue with an explanation. Everything already running is left completely alone: same turn clock, same reaction windows, same bots, same reconnects. Tables in progress get one `server_updating`, which the client shows as a quiet line in the top chrome. The process exits as soon as the last match ends, or after `LOCO_DRAIN_TIMEOUT`.
- **Snapshot.** Whatever the drain did not finish is written to `LOCO_SNAPSHOT_PATH` on the way out and read back by the next process before its listener is up. Clients reconnect into the restored rooms on their own with the token they already hold, so from a seat it is the one-second reconnect overlay a dropped wifi frame produces. Only matches in flight travel; a snapshot is never replayed, and one from another build or older than two minutes is discarded whole.

`deploy/compose.yml` sets `stop_grace_period` above `LOCO_DRAIN_TIMEOUT` (without it Docker `SIGKILL`s after 10 s and none of the above exists) and bind-mounts `${DATA_DIR}/snapshots`. The rollout recreates the **server first, the client second**, so a fresh bundle is never served against a server that is still draining on the old version. Full detail: [`docs/deployment.md`](docs/deployment.md).

### Pipeline speed

E2E dominates the wall clock. Everything done to shorten it spends dead time, never coverage: no test is skipped, no gate is loosened, and no reaction window is shortened.

- **`e2e_test` runs as 4 parallel shards** (`--shard=$CI_NODE_INDEX/$CI_NODE_TOTAL`). This needs a GitLab runner that accepts concurrent jobs (`concurrent > 1` in its `config.toml`); at `concurrent = 1` the shards queue and pay four setups for one suite.
- **`server-bin` is built once** by `backend_test` and handed to `e2e_test` through the cache, instead of downloading a 70 MB Go toolchain onto the Playwright image and rebuilding it once per shard.
- **No `playwright install` in CI** (it stays in the local setup above). The image already ships the browsers, and only the ones its own Playwright needs. `PLAYWRIGHT_VERSION` is declared once in `e2e_test`, interpolated into the image tag and asserted against the installed version before the suite runs, and `@playwright/test` is pinned exactly rather than by caret: the runtime here is a docker image, not a version range. Bump the two together and commit the lockfile.
- **Go and npm caches** are redirected under `$CI_PROJECT_DIR` (GitLab can only cache paths inside the project) and keyed per job family.
- **Bots think faster in CI only**: `LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS`, applied by the server at startup and gated on `LOCO_E2E=1`. The think delay is the one bot timing nothing races. Catch, declaration and interrupt delays keep their shipped values — those are reaction windows tests are meant to be able to win.

### The runner cannot upload artifacts

`.gitlab-ci.yml` deliberately contains no `artifacts:` block. The runner's upload helper resolves the GitLab API host (`http://gitlab`) against the LAN DNS, which does not know that name, and a failed upload fails the job, so one `artifacts:` line turns a fully green suite into a red pipeline. That is why `server-bin` travels by cache (local to the runner, no API call) with a `server-bin.sha` stamp so a shard never runs a binary built from another commit.

The cost is the JUnit report and Playwright's traces: they are still written, just not collected. Fixing the runner (`extra_hosts`, joining GitLab's Docker network, or registering it against the FQDN) is what restores them. The block is commented out in `e2e_test`, ready to uncomment.

---

## Development Workflow

```
feature branch → tests → implementation → all tests green → update docs → commit
```

See `CLAUDE.md` for the engineering rules and conventions, and `docs/notes/` for the reasoning behind
each one: the bug that produced it, the alternative that was measured and rejected, and the edge
cases a one-line rule cannot express.
