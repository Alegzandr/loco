# Loco – Real-time Multiplayer Card Game

A premium-quality real-time browser-based card game inspired by UNO. Play with friends in seconds using only a nickname — no accounts required.

---

## Product Goals

- Real-time, low-latency multiplayer gameplay via WebSockets
- Nickname-only access (no accounts, no passwords)
- Server-authoritative anti-cheat architecture
- Smooth, polished visuals powered by PixiJS
- Reaction mechanics with server-side timing windows (UNO catch)
- Full Docker-based local development and deployment

---

## Stack

| Layer     | Technology              | Reason                                                                |
|-----------|-------------------------|-----------------------------------------------------------------------|
| Backend   | **Go**                  | Low latency, native concurrency, small binary, excellent stdlib       |
| Realtime  | **WebSockets** (gorilla)| Persistent bidirectional connection; lowest latency for game events   |
| Frontend  | **React + TypeScript**  | Component model, type safety, wide ecosystem                          |
| Bundler   | **Vite**                | Near-instant dev server, fast HMR                                     |
| Rendering | **PixiJS**              | WebGL-accelerated 2D rendering for smooth card animations             |
| State     | **Zustand**             | Minimal, fast React global state without boilerplate                  |
| Testing   | **Go test** + **Vitest**| Standard Go testing; Vitest integrates natively with Vite             |
| Infra     | **Docker + Compose**    | Reproducible builds, simple one-command local run                     |

---

## Repository Structure

```
loco/
├── server/                  # Go game server
│   ├── main.go              # HTTP entry point
│   ├── game/                # Authoritative domain logic (TDD-covered)
│   │   ├── card.go          # Card types (Color, Kind)
│   │   ├── deck.go          # Deck: new, shuffle, draw, replenish
│   │   ├── hand.go          # Player hand management
│   │   ├── room.go          # Room lifecycle + game state
│   │   └── rules.go         # CanPlay(), ApplyEffect()
│   ├── hub/                 # WebSocket connection management
│   │   ├── hub.go           # Event loop, message routing, metrics, room cleanup
│   │   └── client.go        # Per-connection read/write pumps
│   ├── protocol/            # Shared message schema (client ↔ server)
│   │   └── messages.go
│   ├── go.mod
│   └── Dockerfile
├── client/                  # React + TypeScript + Vite frontend
│   ├── src/
│   │   ├── main.tsx         # React entry point
│   │   ├── App.tsx          # Root component + message dispatch
│   │   ├── components/      # UI screens + shared components
│   │   │   ├── Lobby.tsx
│   │   │   ├── WaitingRoom.tsx
│   │   │   ├── GameView.tsx
│   │   │   ├── GameOver.tsx
│   │   │   ├── RulesModal.tsx       # Game rules modal (accessible from all screens)
│   │   │   └── LanguageSwitcher.tsx # EN/FR language toggle
│   │   ├── game/            # PixiJS rendering
│   │   │   ├── PixiGame.ts
│   │   │   └── cardColors.ts
│   │   ├── hooks/           # WebSocket + Zustand store
│   │   │   ├── useWebSocket.ts
│   │   │   └── useGameStore.ts
│   │   ├── i18n/            # Internationalization
│   │   │   ├── index.tsx    # I18nProvider, useI18n hook, lang detection
│   │   │   ├── en.ts        # English translations + Translations type
│   │   │   └── fr.ts        # French translations
│   │   ├── types/           # Protocol TypeScript types
│   │   │   └── protocol.ts
│   │   └── test/            # Frontend unit tests
│   ├── nginx.conf           # Production reverse proxy config
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml       # Production-style full-stack compose
├── docker-compose.dev.yml   # Development compose (bind mounts, hot reload)
├── .env.example
├── .gitignore
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

All messages are JSON over WebSocket.

**Client → Server:**
| Type                | Fields                                                   |
|---------------------|----------------------------------------------------------|
| `create_room`       | `nickname`                                               |
| `join_room`         | `nickname`, `room_code`, `session_token` (reconnect)     |
| `start_game`        | —                                                        |
| `add_bot`           | — (host-only)                                            |
| `set_match_format`  | `match_format` (`BO1`/`BO3`/`BO5`/`BO7`) (host-only)    |
| `set_max_players`   | `max_players` (2–10) (host-only)                         |
| `play_card`         | `card`, `chosen_color`                                   |
| `draw_card`         | —                                                        |
| `pass_turn`         | —                                                        |
| `declare_uno`       | —                                                        |
| `catch_uno`         | —                                                        |
| `counter_draw`      | `card`, `chosen_color`                                   |

**Server → Client:**
| Type                  | Key Fields                                                                  |
|-----------------------|-----------------------------------------------------------------------------|
| `room_created`        | `room_code`, `player_id`, `session_token`, `players`, `match_format`, `max_players` |
| `room_joined`         | `room_code`, `player_id`, `session_token`, `players`, `match_format`, `max_players` |
| `lobby_config_changed`| `match_format`, `max_players`                                               |
| `player_joined`       | `nickname`, `players`                                                       |
| `player_left`         | `nickname`, `players`                                                       |
| `player_disconnected` | `player_index`, `nickname`, `players`                                       |
| `player_reconnected`  | `player_index`/`player_id`, `state` (self), `players`                      |
| `game_started`        | `state` (personalized per player, includes round_number, match_format, scoreboard) |
| `card_played`         | `player_index`, `card`, `turn`, `pending_draw`, `players` (updated list with Finished/Placement) |
| `card_drawn`          | `card` (own hand only), `player_index`, `turn`                              |
| `turn_changed`        | `turn`                                                                      |
| `uno_declared`        | `player_index`                                                              |
| `uno_caught`          | `player_index`                                                              |
| `round_end`           | `round_number`, `round_winner`, `scoreboard`                                |
| `match_end`           | `match_winner`, `scoreboard`                                                |
| `game_over`           | `winner` (BO1 / legacy path)                                                |
| `error`               | `error`                                                                     |

`PlayerDTO` includes `index`, `nickname`, `hand_size`, and `connected` (disconnected players greyed out).

`GameStateDTO` includes: `event_log` (for reconnect history), `round_number`, `match_format`, `max_players`, and `scoreboard` (cumulative per-player scores).

---

## Game Rules

- **Deck**: 112 cards.
  - Per color (red, yellow, green, blue): numbers 1–9 ×2, Skip ×2, Reverse ×2, Draw Two ×2, **Swap ×1 (colored)**.
  - Global wilds: Wild ×4, Wild Draw Four ×4, **Global Swap ×4**.
- **Starting hand**: 8 cards per player.
- **Opening discard**: always a number card.
- **Legal play**: match top card by color, number, or kind; wilds are always legal. Swap is colored — it follows normal matching rules.
- **Skip**: next player loses their turn.
- **Reverse**: direction reverses; with 2 players acts as Skip.
- **Draw Two (+2)**: next player draws 2 and loses turn, unless they counter with another +2.
- **Wild**: choose new active color.
- **Wild Draw Four (+4)**: choose color; next player draws 4 unless countered with another +4.
- **Swap (⇋)**: pick an opponent and swap entire hands. Turn-only, no stacking.
- **Global Swap (↻)**: every player passes their hand to the next player in the current direction.
- **Identical-card interrupt**: any non-current player may immediately play a card that exactly matches the top discard (color + kind + value). Fastest-server-received wins; play continues from the interrupter. Wilds cannot be used to interrupt.
- **+2 free interrupt**: a +2 may be played out of turn at any time even if it does not match top color/value. Cannot be used while a draw penalty is already active (use the normal counter chain instead).
- **Batch identical-card play**: on your turn you may play multiple identical cards (same color + value) at once; effects compound (`N` × +2 = `2N` pending draw, `N` skips skip `N` players, etc).
- **UNO declaration**: player must call UNO when they reach 1 card; other players have a 5-second window to catch them.
- **UNO catch**: if caught undeclared, the target draws 2 penalty cards.
- **Round end (single-finisher)**: the round ends the moment one player empties their hand. That player wins and scores the sum of all opponents' remaining card values; everyone else scores 0 for the round.
  - Card values: number = face (1–9); Skip / Reverse / +2 / Swap = 20; Wild / +4 / Global Swap = 50.
- **Round 1 starter**: chosen at random. **Subsequent rounds**: the player with the lowest cumulative score starts.
- **Turn timer & AFK**: each turn is time-bounded; on expiry the server auto-draws and passes. After ~2 rounds of consecutive AFK turns, the player is removed.

### Match Formats

| Format | Rounds |
|--------|--------|
| BO1    | 1      |
| BO3    | 3      |
| BO5    | 5      |
| BO7    | 7      |

**Match winner**: player with the highest total score after all rounds.

**Tiebreakers** (applied in order):
1. Highest cumulative score
2. Most rounds won
3. Lowest cumulative remaining card value across losing rounds
4. Sudden-death extra round (if still tied)

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

### Backend (Go)

```bash
cd server
go test ./...           # all tests
go test ./game/... -v   # domain tests with verbose output
```

### Frontend (Vitest + ESLint)

```bash
cd client
npm test               # single run
npm run test:watch     # watch mode
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
```

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
| `chromium`      | `game-flow`, `multi-client`, `penalties`, `round-progression`, `reconnect`, `special-cards` | Desktop   |
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
- Swap / Global Swap on-screen notification banner + PixiJS card-back trail animation between affected seats
- counter_draw stacking, interrupt_play out-of-turn
- Mobile touch targets (44px+), color picker, rules modal, canvas size

---

## Current Implemented Features

- [x] Room creation with auto-generated 6-character human-friendly code (collision-free registry)
- [x] Join by room code
- [x] Nickname-only entry (no accounts)
- [x] Real-time lobby with player list updates
- [x] Host-only game start
- [x] **Match format selection**: host sets BO1/BO3/BO5/BO7 in lobby; changes broadcast live
- [x] **Max players configuration**: host sets player cap (2–10) live in lobby; cannot drop below current count
- [x] Full UNO-style 108-card deck
- [x] 7-card initial deal
- [x] Legal move validation (color/number/kind matching)
- [x] Skip, Reverse (including 2-player mode), Draw Two
- [x] Wild and Wild Draw Four (color choice)
- [x] Draw Two / Wild Draw Four stacking (counter mechanic)
- [x] UNO declaration
- [x] UNO catch with server-side 5-second timing window
- [x] **Placement-based round scoring**: round continues until 1 player remains; each finisher scores against remaining unfinished opponents; last player scores 0; Number = face, Skip/Reverse/DrawTwo = 20, Wild/WildDrawFour = 50
- [x] **In-round spectators**: finished players watch the rest of the round; turn order skips them; their opponent bubble shows a gold placement badge (e.g., "1st · Alice") and gold tint
- [x] **Multi-round matches**: BO1/BO3/BO5/BO7 with persistent scoreboard
- [x] **Tiebreakers**: highest score → rounds won → lowest last-place hand total → sudden-death extra round
- [x] **Round summary overlay**: full per-round breakdown with placements (1st/2nd/…), points earned, cumulative scoreboard; auto-dismisses after 8 s or via Continue button; next-round state is buffered so it never vanishes instantly
- [x] **Match end screen**: final scoreboard with winner highlight
- [x] **Reconnect visual recovery**: on reconnect, a brief "Rebuilding table…" overlay appears, then hand cards, discard pile, player bubbles, and turn indicator animate in with staggered entrance — no instant snap to restored state
- [x] Win detection (empty hand)
- [x] Deck replenishment from discard pile
- [x] Polished React + PixiJS game view
- [x] Per-player personalized state (hidden hand info)
- [x] Player disconnect/reconnect during active game (60-second reconnect window)
- [x] JSON health endpoint (`GET /health`) with room count, client count, and uptime
- [x] **Metrics endpoint**: `GET /metrics` — atomic counters for rooms_active, players_connected, matches_started, matches_finished, bots_active, uptime_sec, **goroutine_count** (real-time goroutine health indicator)
- [x] **Room lifecycle cleanup**: empty rooms are kept for 5 minutes then automatically deleted; rejoining before the timer cancels the cleanup
- [x] **Structured server logging**: room created/deleted, match started/finished, player connected/disconnected, reconnect events
- [x] Client auto-reconnect with exponential backoff
- [x] Docker + docker-compose full-stack setup
- [x] **Dev Docker Compose** (`docker-compose.dev.yml`): bind-mounted source with `go run` and Vite dev server; no host toolchain required
- [x] **Session tokens**: cryptographically random token issued on join/create; required for reconnect to prevent slot hijacking
- [x] **Per-client rate limiting**: server-side token bucket (10 msg/s sustained, burst of 20) protects against message flooding
- [x] **Bot players**: host can add AI bots to the lobby; bots play autonomously with card preference heuristics
- [x] **Game event log**: every game action is recorded in an append-only `EventLog` on `GameState`; delivered to reconnecting players for history
- [x] **PixiJS card animations**: cards fly to/from the discard pile with easeOutCubic tweening; card draw also animated
- [x] **UNO reaction timer UI**: countdown bar shows the 5-second catch window whenever a player declares UNO
- [x] **Mobile support**: responsive layout, 44px+ tap targets, double-tap guard, touch-friendly wild color picker, `user-scalable=no`
- [x] **Rules modal**: in-game rules reference accessible from Lobby, Waiting Room, and Game View — covers all custom mechanics; slides up as a sheet on mobile
- [x] **Internationalisation (i18n)**: English and French UI with automatic browser language detection; manual language switcher persisted to `localStorage`; designed for easy addition of further languages

---

## Known Limitations

- No persistence: rooms and game state are in-memory only; server restart clears everything
- Reconnect window is 60 seconds; longer disconnects permanently drop the player
- No spectator mode
- No chat
- Wild Draw Four legality (should only be legal when no matching color) not yet enforced
- Only English and French are currently translated; adding a language requires a new file in `client/src/i18n/` and an entry in the `translations` map

---

## CI/CD

The pipeline is defined in `.gitlab-ci.yml` and has three stages:

| Stage    | Jobs                                        | Trigger                            |
|----------|---------------------------------------------|------------------------------------|
| `test`   | `backend_test`, `frontend_test`, `e2e_test` | Every push (all branches)          |
| `build`  | `build` (Docker images)                     | `develop` branch or `v*` tag only  |
| `deploy` | `deploy_dev` (auto on `develop`), `deploy_prod` (auto on tag), `stop_dev` (manual) | After `build` |

**Test jobs** run on every push:
- `backend_test` (`golang:1.24.7-alpine`): `go test ./...` + builds a static Linux binary (artifact for `e2e_test`)
- `frontend_test` (`node:20-alpine`): `npm ci && npm run lint && npm run test && npm run build`
- `e2e_test` (`mcr.microsoft.com/playwright`): starts the server binary, runs Vite dev, executes Playwright suite; needs both `backend_test` and `frontend_test` to pass first

**Build** and **deploy** jobs require the `devops` runner tag and a GitLab container registry.

### Production request path

```
Browser (HTTPS) → Traefik (:443, entrypoint websecure)
  → client nginx (:80, networks: traefik + internal)
    → /ws  → Go server (:8080, network: internal only)   [WebSocket]
    → /health → Go server (:8080)                        [health probe]
    → /    → nginx serves static SPA files directly
```

- Traefik terminates TLS and routes all traffic to the nginx container on port 80.
- nginx bridges the `traefik` and `internal` Docker networks; the Go server is isolated on `internal` only and is never directly reachable by Traefik.
- The Go server container exposes port 8080 internally (`expose`, not `ports`).

### Production readiness

- The `server` service in `deploy/compose.yml` has a healthcheck (`GET /health`, 10 s interval, 5 s timeout, 3 retries, 5 s start period).
- The `client` service waits for `server` to be `healthy` before starting (`condition: service_healthy`), preventing nginx from routing to a not-yet-listening Go server on deploy or restart.
- All compose-interpolation variables (`DEPLOY_ENV`, `APP_HOST`, `IMAGE_TAG`, `CI_REGISTRY_IMAGE`) are written to `app.env` by `write_app_env` and loaded via `--env-file app.env`, so a manual `docker compose up` on the server works without relying on CI shell exports.
- Dev hosts (`*-d.<domain>`) serve `robots.txt` with `Disallow: /` to prevent indexing; production hosts allow indexing by default.

---

## Development Workflow

```
feature branch → tests → implementation → all tests green → update docs → commit
```

See `CLAUDE.md` for full engineering rules and conventions.
