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
│   │   ├── hub.go           # Event loop, message routing
│   │   └── client.go        # Per-connection read/write pumps
│   ├── protocol/            # Shared message schema (client ↔ server)
│   │   └── messages.go
│   ├── go.mod
│   └── Dockerfile
├── client/                  # React + TypeScript + Vite frontend
│   ├── src/
│   │   ├── main.tsx         # React entry point
│   │   ├── App.tsx          # Root component + message dispatch
│   │   ├── components/      # UI screens
│   │   │   ├── Lobby.tsx
│   │   │   ├── WaitingRoom.tsx
│   │   │   ├── GameView.tsx
│   │   │   └── GameOver.tsx
│   │   ├── game/            # PixiJS rendering
│   │   │   ├── PixiGame.ts
│   │   │   └── cardColors.ts
│   │   ├── hooks/           # WebSocket + Zustand store
│   │   │   ├── useWebSocket.ts
│   │   │   └── useGameStore.ts
│   │   ├── types/           # Protocol TypeScript types
│   │   │   └── protocol.ts
│   │   └── test/            # Frontend unit tests
│   ├── nginx.conf           # Production reverse proxy config
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
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

### Anti-Cheat

- Card legality validated server-side on every `play_card`
- Cards verified to be in the player's hand before play
- Turn enforcement: out-of-turn actions are rejected
- Client timestamps are never trusted; only server receipt time is used for catch windows
- Hidden state (other players' hands) never sent to wrong client

### Message Protocol

All messages are JSON over WebSocket.

**Client → Server:**
| Type           | Fields                        |
|----------------|-------------------------------|
| `create_room`  | `nickname`                    |
| `join_room`    | `nickname`, `room_code`       |
| `start_game`   | —                             |
| `play_card`    | `card`, `chosen_color`        |
| `draw_card`    | —                             |
| `pass_turn`    | —                             |
| `declare_uno`  | —                             |
| `catch_uno`    | —                             |
| `counter_draw` | `card`, `chosen_color`        |

**Server → Client:**
| Type                  | Key Fields                                          |
|-----------------------|-----------------------------------------------------|
| `room_created`        | `room_code`, `player_id`, `players`                 |
| `room_joined`         | `room_code`, `player_id`, `players`                 |
| `player_joined`       | `nickname`, `players`                               |
| `player_left`         | `nickname`, `players`                               |
| `player_disconnected` | `player_index`, `nickname`, `players`               |
| `player_reconnected`  | `player_index`/`player_id`, `state` (self), `players` |
| `game_started`        | `state` (personalized per player)                   |
| `card_played`         | `player_index`, `card`, `turn`, `pending_draw`      |
| `card_drawn`          | `card` (own hand only), `player_index`, `turn`      |
| `turn_changed`        | `turn`                                              |
| `uno_declared`        | `player_index`                                      |
| `uno_caught`          | `player_index`                                      |
| `game_over`           | `winner`                                            |
| `error`               | `error`                                             |

`PlayerDTO` includes a `connected` boolean so clients can show disconnected players greyed out.

---

## Game Rules

Based on standard UNO with the following mechanics:

- **Deck**: 108 cards — 4 colors (red/yellow/green/blue), numbers 0–9, Skip, Reverse, Draw Two, plus 4 Wild and 4 Wild Draw Four
- **Starting hand**: 7 cards per player
- **Legal play**: match top card by color, number, or kind; wilds are always legal
- **Skip**: next player loses their turn
- **Reverse**: direction reverses; with 2 players acts as Skip
- **Draw Two (+2)**: next player draws 2 and loses turn, unless they counter with another +2
- **Wild**: play any time, choose new active color
- **Wild Draw Four (+4)**: play any time, choose color, next player draws 4 (unless countered with another +4)
- **UNO declaration**: player must call UNO when they reach 1 card; other players have a 5-second window to catch them
- **UNO catch**: if caught undeclared, the target draws 2 penalty cards
- **Win**: first player to empty their hand wins

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

### Quick start (full stack)

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend health: http://localhost:8080/health

### Individual services

```bash
# Build and run only the server
docker compose up server

# Rebuild after code changes
docker compose up --build
```

### Stop

```bash
docker compose down
```

---

## Environment Variables

| Variable      | Default | Description                  |
|---------------|---------|------------------------------|
| `PORT`        | `8080`  | Go server listen port        |
| `CLIENT_PORT` | `3000`  | Nginx (frontend) listen port |

Copy `.env.example` to `.env` and adjust as needed.

---

## Test Commands

### Backend (Go)

```bash
cd server
go test ./...           # all tests
go test ./game/... -v   # domain tests with verbose output
```

### Frontend (Vitest)

```bash
cd client
npm test               # single run
npm run test:watch     # watch mode
```

---

## Current Implemented Features

- [x] Room creation with auto-generated 4-character code
- [x] Join by room code
- [x] Nickname-only entry (no accounts)
- [x] Real-time lobby with player list updates
- [x] Host-only game start
- [x] Full UNO-style 108-card deck
- [x] 7-card initial deal
- [x] Legal move validation (color/number/kind matching)
- [x] Skip, Reverse (including 2-player mode), Draw Two
- [x] Wild and Wild Draw Four (color choice)
- [x] Draw Two / Wild Draw Four stacking (counter mechanic)
- [x] UNO declaration
- [x] UNO catch with server-side 5-second timing window
- [x] Win detection (empty hand)
- [x] Deck replenishment from discard pile
- [x] Polished React + PixiJS game view
- [x] Per-player personalized state (hidden hand info)
- [x] Player disconnect/reconnect during active game (60-second reconnect window)
- [x] JSON health endpoint (`GET /health`) with room count, client count, and uptime
- [x] Client auto-reconnect with exponential backoff
- [x] Docker + docker-compose full-stack setup

---

## Known Limitations

- No persistence: rooms and game state are in-memory only; server restart clears everything
- Reconnect window is 60 seconds; longer disconnects permanently drop the player
- No spectator mode
- No chat
- No game history or score tracking
- Room code is 4 characters; collision probability rises with many concurrent rooms
- Wild Draw Four legality (should only be legal when no matching color) not yet enforced
- No mobile-optimized touch controls

---

## Development Workflow

```
feature branch → tests → implementation → all tests green → update docs → commit
```

See `CLAUDE.md` for full engineering rules and conventions.
