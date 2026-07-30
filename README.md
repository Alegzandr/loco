# Loco – Real-time Multiplayer Card Game

A premium-quality real-time browser-based card game inspired by UNO. Play with friends in seconds using only a nickname — no accounts required.

---

## Product Goals

- Real-time, low-latency multiplayer gameplay via WebSockets
- Nickname-only access (no accounts, no passwords)
- Server-authoritative anti-cheat architecture
- Smooth, polished visuals powered by React + Framer Motion
- A look worth streaming: chunky cartoon art direction (Nintendo × Gartic Phone), readable at 720p over someone's commentary
- Fully synthesised audio — sound effects and an adaptive music bed, zero audio assets shipped
- Reaction mechanics with server-side timing windows (UNO catch, interception slam)
- Full Docker-based local development and deployment

---

## Stack

| Layer     | Technology              | Reason                                                                |
|-----------|-------------------------|-----------------------------------------------------------------------|
| Backend   | **Go**                  | Low latency, native concurrency, small binary, excellent stdlib       |
| Realtime  | **WebSockets** (gorilla)| Persistent bidirectional connection; lowest latency for game events   |
| Frontend  | **React + TypeScript**  | Component model, type safety, wide ecosystem                          |
| Bundler   | **Vite**                | Near-instant dev server, fast HMR                                     |
| Rendering | **React + Framer Motion** | DOM-based card rendering with declarative motion-driven animations    |
| State     | **Zustand**             | Minimal, fast React global state without boilerplate                  |
| Validation| **Zod**                 | Runtime schema for inbound `ServerMsg`; static types are inferred from it (no Go↔TS type drift) |
| Audio     | **Web Audio API** (hand-rolled) | Every sound is synthesised at runtime: no files to download, no licences, no cache-miss silence |
| Type      | **Fredoka + Nunito** (self-hosted, `@fontsource`) | Rounded display faces that match the art direction; self-hosted so the CSP stays closed |
| Testing   | **Go test** + **Vitest**| Standard Go testing; Vitest integrates natively with Vite             |
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
├── client/                # React + TypeScript + Vite frontend
│   ├── src/
│   │   ├── components/    # UI screens (Lobby, WaitingRoom, GameView, GameOver, RulesModal, …)
│   │   ├── components/cards/  # React + Framer Motion card renderer (GameBoard, Hand, Card, AnimationLayer, …)
│   │   ├── audio/         # Synthesised SFX, adaptive music bed, engine + store bridge
│   │   ├── dev/           # Dev-only visual showcase (scene registry, tree-shaken in prod)
│   │   ├── hooks/         # WebSocket transport + Zustand store
│   │   ├── i18n/          # I18nProvider + en/fr translations
│   │   ├── styles/        # Design tokens (single source of truth for colour/type/shape)
│   │   ├── types/         # Protocol TypeScript types
│   │   └── test/          # Vitest unit tests
│   ├── nginx.conf         # Production reverse proxy
│   └── Dockerfile
├── e2e/                   # Playwright suite (separate package.json)
├── tools/visual/          # Screenshot harness (shoot.mjs) — see "Visual QA"
├── docs/                  # Rules spec and supplemental docs
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

### Anti-Cheat

- Card legality validated server-side on every `play_card`
- Cards verified to be in the player's hand before play
- Turn enforcement: out-of-turn actions are rejected
- Client timestamps are never trusted; only server receipt time is used for catch windows
- Hidden state (other players' hands) never sent to wrong client
- Session tokens: cryptographically random token issued on join/create, required to re-claim a slot on reconnect — prevents slot hijacking
- Per-client rate limiting: token bucket (10 msg/s, burst 20) — rejects flood attacks at the connection layer

### Message Protocol

JSON over WebSocket. Full message catalogue and DTO shapes: [`docs/protocol.md`](docs/protocol.md).

---

## Game Rules

See [`docs/rules.md`](docs/rules.md) for the full, canonical rules specification.

---

## Local Setup (Without Docker)

### Prerequisites
- Go 1.22+
- Node.js 20+

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
- Backend health: http://localhost:8080/health
- Metrics: http://localhost:8080/metrics (includes `goroutine_count` for runtime health monitoring)

### Development compose (hot reload, no host toolchain needed)

Use `docker-compose.dev.yml` during active development. Go and Node run inside containers; source files are bind-mounted so changes are picked up without rebuilding images.

```bash
docker compose -f docker-compose.dev.yml up --build
```

- Frontend (Vite): http://localhost:5173
- Backend (go run): http://localhost:8080
- WebSocket: `ws://localhost:8080/ws` (browser connects directly — no Vite proxy)

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
make visual ARGS="--viewports=wide"                      # 1920×1080, board at full scale
make visual ARGS="--themes=dark --motion"                # keep animations running
```

Use it whenever you touch layout, colour or motion: reviewing 24 scenes × 2
themes × 2 viewports as four images catches regressions (a clipped heading, a
theme that never applied) that no assertion was ever going to describe.

The showcase is gated behind `import.meta.env.DEV`, so Rollup drops it — and its
chunk — from production builds.

### Audio verification

Sounds are synthesised, so a broken envelope produces silence rather than an error — nothing fails
and nothing logs. `make audio-verify` plays every voice through a real `AudioContext` in a browser
and measures the peak amplitude on the bus:

```bash
make audio-verify
# ✓ cardPlay     peak=0.1179
# ✓ interrupt    peak=0.4444
# ✓ music bed    peak=0.3052
# ✓ mute         peak=0.0000 (want ~0)
```

It is deliberately **not** part of CI: audio devices in CI containers are unreliable, and a flaky
sound assertion only teaches people to ignore a red pipeline. Run it after touching
`client/src/audio/`.

### End-to-End (Playwright)

Playwright starts its own isolated Vite dev server on `http://localhost:4173`.
Only the Go server must be available on `:8080`.

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
- UNO catch window (Catch! button, timer)
- Pending-draw counter on Draw button
- Penalty absorption (pendingDraw clears, turn advances)
- BO3 multi-round progression (round 2, auto-dismiss, game over)
- Spectating banner (local player finishes before round ends)
- WebSocket reconnect (offline/online cycle, reconnect overlay, two-client disconnect)
- Swap card PlayerPicker UI, Swap E2E hand change, GlobalSwitch discard update
- Swap / Global Swap on-screen notification banner + Framer Motion card-back trail animation between affected seats
- counter_draw stacking, interrupt_play_card lead-taking (single + batch, wilds included), interrupt window open/closed
- Rematch: host reopens the finished room and plays a full new match; a joined player is pulled back to the waiting room and keeps their seat
- Mobile touch targets (44px+), color picker, rules modal, canvas size

---

## Implemented Features

- **Lobby**: nickname-only rooms, 6-char codes, host-only start, BO1/BO3/BO5/BO7 selection, max-players 2–10, AI bots.
- **Gameplay**: full 112-card deck, 8-card deal, all action cards (Skip, Reverse, +2, Wild, +4, Swap, Global Swap), +2/+4 stacking, identical-card interrupt with no time limit — any card kind, any player, including the one who just played (single + batch), batch turn play, UNO declare + 5 s catch window, single-finisher round scoring, multi-round matches with tiebreakers and sudden-death.
- **Rematch**: after a match the host reopens the same room (same code, same roster, cleared scores); absent seats are pruned, everyone else is pulled back to the waiting room.
- **UI**: React + Framer Motion animations (transform-only card movement, seat→pile card flights, spring hand reflow, staggered deal, `prefers-reduced-motion` support), round summary overlay, match-end screen with confetti, mobile support (44 px+ targets), rules modal, EN/FR i18n, light + dark themes.
- **Art direction**: chunky cartoon system — ink outlines, solid press-down shadows, saturated card faces, felt table with a real rim. Seats resize and wrap so a nine-player table stays readable on a phone. Design tokens live in `client/src/styles/tokens.css`.
- **Streamable moments**: interception slam (banner + screen shake + sting) on a successful out-of-turn steal, UNO punch-in banner, floating SKIP/REVERSE/+N callouts, per-seat identity colours, exact card counts on every opponent.
- **Audio**: runtime-synthesised effects for every action and rule outcome, plus a generative music bed whose tempo and layer count follow the tension at the table (someone on one card, a climbing draw stack). Per-bus mixer (overall / effects / music) with mute, persisted across sessions. Nothing plays before the first user gesture.
- **Server / infra**: per-player personalized state, 60 s reconnect window with visual recovery, session tokens, per-client rate limiting (10 msg/s, burst 20), AFK auto-kick, append-only event log, `GET /health` + `GET /metrics`, structured logging, empty-room cleanup, Docker dev + prod compose.

Full grouped list: [`docs/features.md`](docs/features.md).

---

## Known Limitations

- No persistence: rooms and game state are in-memory only; server restart clears everything
- Reconnect window is 60 seconds; longer disconnects permanently drop the player
- No spectator mode
- No chat
- Wild Draw Four legality (should only be legal when no matching color) not yet enforced
- Only English and French are currently translated; adding a language requires a new file in `client/src/i18n/` and an entry in the `translations` map
- Audio is synthesised, not recorded: the result is deliberately arcade-like rather than orchestral
- The visual showcase and its screenshot harness are development tooling; they are excluded from production builds

---

## CI/CD & Deployment

GitLab CI pipeline (`.gitlab-ci.yml`) runs `test → build → deploy`; production traffic flows `Traefik → nginx → Go server`. Full pipeline breakdown, request path, and readiness checks: [`docs/deployment.md`](docs/deployment.md).

---

## Development Workflow

```
feature branch → tests → implementation → all tests green → update docs → commit
```

See `CLAUDE.md` for full engineering rules and conventions.
