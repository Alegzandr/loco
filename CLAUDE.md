# CLAUDE.md

## Project mission

Build and maintain a premium-quality real-time multiplayer online card game inspired by UNO.

Primary goals:
- real-time, low-latency multiplayer gameplay
- nickname-only access with no accounts
- server-authoritative anti-cheat architecture
- smooth, polished visuals and animations
- strong test coverage with TDD
- accurate, continuously maintained documentation
- Dockerized local development and deployment

---

## Non-negotiable product constraints

- No login, signup, email/password, or OAuth
- Players join with nickname only
- Server authority is mandatory
- Real-time reaction/counter mechanics are mandatory
- Dockerization is mandatory
- TDD is mandatory
- `README.md` must always stay in sync with the codebase
- This file (`CLAUDE.md`) must always stay in sync with the codebase

---

## Repository operating rules

When working in this repository, always follow this loop:

1. Understand the required behavior
2. Update or add tests first for non-trivial behavior
3. Implement the smallest correct change
4. Run tests and fix failures
5. Update `README.md` if setup, architecture, commands, features, or limitations changed
6. Update `CLAUDE.md` if conventions, architecture, workflows, or decision rules changed

Do not consider work complete until code, tests, and docs all align.

---

## Documentation maintenance rules

### Always update `README.md` when changing:
- setup steps
- commands
- Docker workflow
- architecture summary
- features
- current status
- limitations
- environment variables
- local dev instructions
- test instructions

### Always update `CLAUDE.md` when changing:
- repository workflow
- architecture decisions
- coding conventions
- testing strategy
- definition of done
- folder structure conventions
- operational rules for future Claude sessions

Never leave docs outdated.

---

## Engineering priorities

In order:
1. low latency
2. server-authoritative correctness
3. smooth user experience
4. deterministic behavior
5. maintainable architecture
6. testability
7. local developer experience

If tradeoffs are necessary, favor these priorities in order.

---

## Architecture principles

### Authority
The server owns:
- room state
- player state
- hand state
- deck/discard state
- turn order
- legality validation
- timing windows
- counter/catch resolution
- penalties
- winner determination

The client owns:
- presentation
- local interaction
- rendering
- animation
- sending player intents only

Never trust the client for game legality or hidden information.

### Realtime model
- Use a persistent low-latency bidirectional transport
- Prefer event-driven authoritative state updates
- Resolve simultaneous or reaction-based interactions on the server
- Make timing windows explicit and testable
- Favor deterministic resolution logic
- Reconnect: on disconnect during play, slot is held nil for 60 seconds; rejoining with the same nickname+room_code restores the slot and delivers a full game state snapshot

### Fairness model
For reaction-based interactions:
- the server records event receipt times
- the server defines the valid reaction window
- only valid server-received events inside the window are considered
- tie-breaking must be deterministic and documented
- client visuals may be optimistic, but server resolution is final

---

## Preferred implementation style

- small cohesive modules
- explicit domain types
- minimal hidden magic
- pure game/domain logic where possible
- side effects isolated at boundaries
- clear protocol contracts
- strong validation on all incoming messages
- concise comments only where useful

---

## Testing policy

TDD is mandatory.

### Required testing approach
- write or update tests before implementing non-trivial behavior
- prioritize domain logic coverage
- use deterministic tests for timing-sensitive behavior
- integration-test critical multiplayer flows
- maintain the Playwright E2E suite as a living regression layer (see Playwright conventions below)

### Minimum required test coverage areas
- room creation
- room join by code
- nickname-only entry
- game start conditions
- turn progression
- legal move validation
- illegal move rejection
- skip/reverse/draw behavior
- wild behavior
- draw penalties
- win detection
- last-card declaration mechanic
- counter/catch timing windows
- simultaneous reaction resolution
- reconnect behavior (60-second window; nickname + room_code identifies the slot)
- protocol validation and rejection paths

### Test discipline
- avoid brittle tests
- prefer deterministic clocks/timers in server logic
- keep tests fast
- keep tests targeted
- cover business/game rules more heavily than UI details

---

## README requirements

`README.md` must always include, at minimum:
- project overview
- product goals
- stack summary
- why the stack was chosen
- local setup
- Docker usage
- environment variables
- test commands
- architecture summary
- current implemented features
- known limitations
- development workflow

If the repo changes, the README must change with it when relevant.

---

## Docker requirements

The project should support a straightforward full-stack local run.

Expected artifacts:
- service Dockerfiles
- `docker-compose.yml`
- `.env.example`

The Docker setup should be documented in the README and kept current.

---

## Anti-cheat requirements

The system must defend against:
- illegal card submissions
- turn spoofing
- hidden-state manipulation
- replayed messages
- forged reaction events
- forged declaration events
- duplicated event spam
- client-tampered hand state
- client-side win claims

Required posture:
- validate every message
- reject illegal or out-of-turn actions
- keep authoritative hidden state server-side
- avoid trusting client timestamps for outcomes
- make server outcomes final
- issue cryptographically random session tokens on room create/join; require token for reconnect slot reclaim
- enforce per-client rate limits (token bucket, 10 msg/s / burst 20) at the connection layer

---

## Performance expectations

Optimize for:
- low-latency interaction
- smooth animation and rendering
- minimal unnecessary round trips
- efficient state updates
- predictable server behavior under concurrent play

Do not introduce heavy abstractions that harm responsiveness without clear benefit.

---

## UX expectations

The game should feel polished:
- smooth card animations
- clear turn indicators
- strong feedback for penalties and counters
- clean lobby flow
- responsive layout
- premium feel over basic utility UI

Visual polish matters. This is not just a protocol demo.

---

## Decision-making rules

When multiple valid options exist:
- prefer the option that improves realtime responsiveness
- prefer simpler architecture when performance is comparable
- prefer maintainable high-performance tools over hype-driven choices
- avoid adding persistence unless it provides real value
- avoid adding services that are not justified by the current product scope

Document significant architectural choices in the README and, when relevant, here.

---

## Definition of done

A task is done only when all are true:
- code is implemented
- relevant tests exist
- tests pass
- docs are updated
- Docker/dev workflow still works
- behavior matches documented expectations

---

## Expected repository sections

Adjust this section as the repo evolves. Keep it current.

Typical structure:
- `client/` frontend app
  - `src/components/` — UI screens + shared components (RulesModal, LanguageSwitcher)
  - `src/i18n/` — i18n context, English and French translations
  - `src/game/` — PixiJS rendering
  - `src/hooks/` — WebSocket connection and Zustand store
  - `src/types/` — protocol TypeScript types
  - `src/test/` — Vitest unit tests
- `server/` authoritative realtime game server
  - `game/` — pure domain logic (room, deck, hand, rules, bot, event log)
  - `hub/` — WebSocket connection management, rate limiting, session tokens, bot scheduling
  - `protocol/` — wire types shared between hub and client
- `e2e/` — Playwright end-to-end test suite
  - `tests/game-flow.spec.ts` — single-browser gameplay flow (lobby → game over)
  - `tests/multi-client.spec.ts` — two-browser synchronization tests
  - `tests/mobile.spec.ts` — mobile viewport tests (Pixel 5)
  - `tests/penalties.spec.ts` — error toast, turn timer, UNO catch window, pending-draw button
  - `tests/round-progression.spec.ts` — BO3 round advancement, game-over, spectating banner, auto-dismiss
  - `tests/reconnect.spec.ts` — offline/online reconnect, reconnect overlay, two-client disconnect/reconnect
  - `tests/special-cards.spec.ts` — Swap, GlobalSwitch, counter_draw, interrupt_play, two-client card sync
  - `helpers/game.ts` — shared E2E helpers (create room, draw/pass, takeTurn, participateInTurns, setMatchFormat, waitForPendingDraw, waitForUnoDeclared, waitForRoundNumber, clickContinue)
  - `types.d.ts` — `Window.__LOCO_E2E__` type declaration (full store state)
  - `playwright.config.ts` — Playwright project config
- `shared/` protocol/types if used
- `docs/` optional supplemental docs
- root config / Docker / env files

If structure changes, update this file and the README.

---

## Scoring and match system conventions

- `CardValue(c Card) int` in `game/card.go`: Number = face value; Skip/Reverse/DrawTwo = 20; Wild/WildDrawFour = 50.
- **Round model**: a round does NOT end when the first player empties their hand. Instead:
  - Each player who empties their hand is marked `Finished` and becomes an in-round spectator.
  - They score the sum of card values held by all *still-unfinished* players at that moment.
  - Play continues among remaining (unfinished) players; the turn order skips finished players.
  - The round ends when exactly one player remains with cards; that player scores 0.
  - The first to finish is the round winner (`Room.Winner`, `Room.RoundsWon`).
  - `GameState.Finished []bool` — per-player finish flag for the current round.
  - `GameState.Placements []int` — finish order: `Placements[0]` = 1st-place playerIdx, etc.
  - `Room.markPlayerFinished(playerIdx)` handles scoring, placement tracking, and round-end detection.
- Scores accumulate across rounds in `Room.Scores []int` (indexed by playerID).
- `Room.RoundsWon []int` tracks first-place wins per player; `Room.LostHandTotal []int` tracks the last-place finisher's remaining hand value per round (tiebreaker).
- `Room.RoundEnded bool` is set to `true` by `markPlayerFinished` when the round ends; the hub clears it after broadcasting `round_end`.
- `Room.MatchOver bool` + `Room.MatchWinner string` indicate match completion.
- Match formats: BO1=1, BO3=3, BO5=5, BO7=7 (stored as `game.MatchFormat`).
- Tiebreaker order: (1) highest total score → (2) most rounds won → (3) lowest lost-hand total → (4) sudden-death extra round.
- If `determineMatchWinner()` returns `""`, a sudden-death extra round is played automatically.
- Hub broadcasts `round_end` (with scoreboard) then `game_started` (new round state) to each player when a round ends mid-match.
- Hub broadcasts `match_end` (with scoreboard + match_winner) when the match is fully over.
- `card_played` server message includes `players` (updated list with `Finished` and `Placement` populated) so clients immediately learn when a player finishes.
- `PlayerDTO` includes `finished bool` and `placement int` (1-based; 0 = not yet finished).
- Finished players' turns are automatically skipped via `GameState.nextTurn`, which iterates until an unfinished player is found.

## Lobby configuration conventions

- Host can set match format via `set_match_format` client message (lobby only).
- Host can set max players via `set_max_players` client message (lobby only).
- Max players constraints: `serverMinPlayers` (2) ≤ n ≤ `serverMaxPlayers` (10); cannot drop below current player count.
- Any config change broadcasts `lobby_config_changed` with updated `match_format` and `max_players` to all connected clients.
- `room_created` and `room_joined` messages include `match_format` and `max_players`.
- Default: BO1, 10 max players.

## Room code conventions

- Codes are 6 characters from charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I/l for readability).
- Uniqueness is guaranteed server-side: `generateCode()` retries on collision (loop until a free code is found).
- 6 chars × 32-char alphabet = ~1 billion combinations; collision risk is effectively zero at realistic scale.

## Mobile support conventions

- All action buttons have `min-height: 44px` and `touch-action: manipulation` to prevent double-tap zoom.
- A 400ms debounce (`guardDoubleTap`) prevents accidental repeated action button presses.
- Wild color picker uses large 64px+ touch targets arranged in a row.
- `user-scalable=no` and `maximum-scale=1.0` set in the HTML `<meta viewport>` tag.
- CSS uses `@media (max-width: 480px)` blocks for responsive layout on small screens.

## Bot player conventions

- Bots are added by the host in the lobby via `add_bot` message.
- Bot nicknames are auto-assigned (`Bot1`, `Bot2`, …).
- Bot AI lives in `game/bot.go` (`BotThink(state, playerIdx) BotAction`).
- Bot actions are scheduled via the `botMove` channel with a short delay (`botThinkDelay = 800ms`).
- Bots auto-declare UNO when playing to 1 card.
- Bot state is tracked in `hub.botSlots[code][playerID]`.

## Game event log conventions

- `GameState.EventLog []GameEvent` is append-only; never remove events.
- Events are recorded inside domain methods (`PlayCard`, `DrawCard`, `PassTurn`, `DeclareLastCard`, `CatchUndeclared`, `CounterDraw`, `Start`).
- `GameEventDTO` is included in `GameStateDTO` and delivered to reconnecting players.
- Event timestamps are in UTC (`time.Now()`); wire format is Unix milliseconds.
- `playerGameState` caps the exported event log to the last 50 events (`maxEventLogExport = 50`) to prevent unbounded serialization overhead on reconnect/round-start.

## Session token conventions

- Tokens are 32 hex characters (128 bits of randomness via `crypto/rand`).
- Tokens are issued in `room_created` and `room_joined` server messages.
- Client must store and include `session_token` in reconnect `join_room` message.
- Invalid or missing token on reconnect returns an error; slot is not reclaimed.
- Token maps (`hub.sessionTokens`) are cleaned up when rooms are deleted.

## Rate limiting conventions

- Token bucket per client: 10 tokens/sec refill rate, burst of 20.
- Implemented in `hub/client.go` as `rateLimiter` (thread-safe).
- Rate-limited messages receive an `error` server message and are dropped.
- The bucket is per-connection, not per-player-identity.

---

## Playwright E2E conventions

- E2E tests live in `e2e/` (root-level, separate `package.json`).
- Stack: `@playwright/test` with Chromium (desktop) and Pixel 5 profile (mobile).
- Tests require the Go server on `:8080`. Playwright starts an isolated Vite dev server on `:4173` from `playwright.config.ts`.
  - Local: run `docker compose -f docker-compose.dev.yml up --build` first (for backend), then `cd e2e && npm test`.
  - CI: `backend_test` builds a static `server-bin` artifact; `e2e_test` starts it and runs Playwright.
- `window.__LOCO_E2E__` is exposed by the client in dev mode only (`import.meta.env.DEV`):
  - `send(msg)` — dispatch any WebSocket message through the live connection
  - `getState()` — read the current Zustand store state (hand, turn, players, etc.)
  - `playCard(card)` — call `handleCardClick` directly (animates + sends `play_card`)
  - This object is **never present in production builds** (Vite tree-shakes `import.meta.env.DEV` blocks).
- Type declarations for `window.__LOCO_E2E__` are in `e2e/types.d.ts`.
- Helper functions in `e2e/helpers/game.ts` abstract common flows (createRoom, addBot, drawAndPass, waitForMyTurn, etc.).
- Tests must be kept reliable: prefer `waitForFunction` + store state over fragile DOM polling.
- Prefer a small number of high-value tests over many fragile ones.
- **Maintenance rule**: when gameplay rules, UI flow, or protocol messages change, update the Playwright suite in the same commit. Never leave E2E tests diverged from the real product behavior.
- Canvas (PixiJS) is not inspected directly; UI state is verified via DOM elements (ActionBar, RoundSummary, GameOver) and via `window.__LOCO_E2E__.getState()`.

---

## CI/CD conventions

- Pipeline defined in `.gitlab-ci.yml` with three stages: `test` → `build` → `deploy`.
- `test` stage has three jobs that run on **every push** using lightweight images:
  - `backend_test` (`golang:1.24.7-alpine`): `cd server && go test ./...` + builds static `server-bin` artifact
  - `frontend_test` (`node:20-alpine`): `cd client && npm ci && npm run lint && npm run test && npm run build`
  - `e2e_test` (`mcr.microsoft.com/playwright:v1.52.0-jammy`): starts `server-bin`, runs Playwright; needs both above jobs
- `build` stage (Docker image builds) only runs on `develop` branch or `v*` tags, and only after all test jobs pass (`needs: [backend_test, frontend_test]`).
- Deploy jobs require the `devops` runner tag and a GitLab container registry.
- All three test jobs must pass before Docker images are built or deployed.

### Production request path

```
Browser (HTTPS) → Traefik (:443, entrypoint websecure)
  → client nginx (:80, networks: traefik + internal)
    → /ws     → Go server (:8080, network: internal only)   [WebSocket]
    → /health → Go server (:8080)
    → /       → nginx serves static SPA files directly
```

- The Go server container is on the `internal` network only; Traefik cannot reach it directly.
- nginx bridges `traefik` and `internal`, proxying WebSocket and health traffic to `server:8080`.
- Port chain is consistent: Traefik → 80 → nginx → 8080 → Go. No port mismatch.

### Production readiness conventions

- `deploy/compose.yml` server service has a healthcheck: `wget -qO- http://localhost:8080/health`, interval 10 s, timeout 5 s, 3 retries, start_period 5 s.
- `client` depends on `server` with `condition: service_healthy` — nginx only starts after Go is accepting connections.
- `write_app_env` in `.gitlab-ci.yml` writes all compose-interpolation vars (`PORT`, `DEPLOY_ENV`, `APP_HOST`, `IMAGE_TAG`, `CI_REGISTRY_IMAGE`) to `app.env`.
- All `docker compose up/down` calls use `--env-file paths.env --env-file app.env` so a manual re-deploy on the server works without CI shell exports.
- nginx `/ws` block sets `proxy_connect_timeout 10s`, `proxy_read_timeout 86400s`, `proxy_send_timeout 86400s` to prevent premature 504s on both connect and long-lived WebSocket connections.

## Linting conventions

- Client linting uses ESLint v9 with flat config (`eslint.config.js`).
- ESLint rules: `@typescript-eslint/recommended`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`.
- `@typescript-eslint/no-unused-vars` is set to `error`; prefix intentionally unused identifiers with `_` to suppress.
- Run: `cd client && npm run lint` (or `npm run lint:fix` to auto-fix).
- Linting runs in CI before tests: `npm run lint && npm run test && npm run build`.
- Server linting: `go vet ./...` is implicitly run by `go test ./...`; this is sufficient for now.

## Player bubble (in-game opponent panels) conventions

- Opponent info is rendered via `PixiGame._buildPlayerBubble` in the PixiJS canvas layer.
- `GameRenderState.players` includes `finished?: boolean` and `placement?: number` so the renderer knows each player's finish state.
- Normal (unfinished, not current turn): dark background (`#16213e`), white text, shows `"nickname (cardCount)"`.
- Active turn: blue background (`#4d96ff`), bold white text.
- Disconnected: dark-grey background, grey text, shows `"nickname ✗ (cardCount)"`.
- Finished: dark gold-tint background (`#2d2a0a`), gold text (`#ffd93d`), shows `"Nth · nickname"` (e.g., `"1st · Alice"`); card count is omitted since they have 0 cards.
- The `placementSuffix` helper in `PixiGame.ts` converts a 1-based placement integer to `"1st"`, `"2nd"`, `"3rd"`, `"Nth"`.
- Finished players are never the `currentTurn` (the server enforces this via `nextTurn`), so the active-turn highlight is never shown on finished bubbles.

## Reconnect visual recovery conventions

- On `player_reconnected`, the client sets `isReconnecting: true` in the store before applying game state.
- `GameView` detects `isReconnecting` and shows a brief "Rebuilding table…" overlay (600 ms), then calls `PixiGame.renderReconnect(state, onComplete)`.
- `renderReconnect` animates all elements in with staggered entrances: discard pile fades/scales in first, then player info bubbles (80 ms stagger), then hand cards (40 ms stagger per card).
- `onComplete` fires after the last card animation, resetting `isReconnecting: false`.
- While `isReconnecting` is true, the normal `render()` path is suppressed to avoid overwriting the animation.
- This is purely visual recovery; server state is authoritative.

## Round summary conventions

- `round_end` from server triggers `applyRoundEnd(roundWinner, roundNumber, newScoreboard)` in the store.
- `applyRoundEnd` computes per-player `round_points` as the delta (`newScore - prevScore`) using the scoreboard held before the round ended, stores them as `roundScores: RoundScoreEntry[]`, and sets `showRoundSummary: true`.
- When `game_started` (next round) arrives while `showRoundSummary` is true, the new state is buffered in `pendingGameState` instead of being applied immediately.
- `GameView` shows the summary with: round number/total, winner, per-player round breakdown sorted by placement (1st/2nd/3rd/…), points earned this round (delta), cumulative score, wins, and full match scoreboard (for BO3+).
- The summary has a "Continue (Ns)" button that calls `dismissRoundSummary()`, which applies the buffered state and clears the summary.
- Auto-dismiss fires after 8 seconds if the player does not click Continue.
- `dismissRoundSummary` applies `pendingGameState` if present, else just clears `showRoundSummary`.

## Metrics conventions

- `GET /metrics` returns JSON: `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`, `uptime_sec`, **`goroutine_count`**.
- `goroutine_count` is `runtime.NumGoroutine()` read at request time — a real-time indicator of goroutine health; should remain low and stable under normal operation.
- All other counters are `sync/atomic.Int32` fields on `Hub`; `GetMetrics()` reads them without entering the event loop.
- `statMatchesStarted` incremented in `handleStartGame` (once per `start_game` message, not per round).
- `statMatchesFinished` incremented in `handleRoundOrMatchEnd` when `room.MatchOver` is true.
- `statBotsActive` incremented in `handleAddBot`; decremented in `deleteRoom` by the number of bots in that room.

## Room lifecycle cleanup conventions

- `hub.EmptyRoomTimeout` (exported `var`, default 5 minutes) controls how long an empty room is kept before deletion.
- `hub.ReconnectTimeout` (exported `var`, default 60 seconds) controls how long a disconnected in-game player's slot is held before the reconnect window closes.
- Both vars are exported so tests can override them (e.g. 80 ms / 120 ms) and must be restored with `t.Cleanup`.
- When a room becomes empty (last member disconnects from lobby/finished, or all slots go nil in an active game), `scheduleRoomCleanup(code)` is called.
- `scheduleRoomCleanup` records `emptyRooms[code] = time.Now()` and uses `time.AfterFunc` to send a `cleanupMsg` after `EmptyRoomTimeout`. If the channel is full, retries once after 30 s; logs `WARN` if the retry also fails.
- `handleCleanup` deletes the room only if `emptyRooms[code]` still matches the recorded time (race-safe: any rejoin clears or changes the entry). Logs skip reason.
- Rejoining (lobby join) or reconnecting (active game) calls `delete(h.emptyRooms, code)` to cancel the cleanup.
- `deleteRoom(code)` is the single point of room deletion: cleans up all hub maps, adjusts `statRooms` and `statBotsActive`, and emits a structured log line.

## Server stability conventions

- All deferred async work (bot moves, reconnect expiry, room cleanup) uses `time.AfterFunc` instead of `go func() { time.Sleep(...); ch <- msg }()` to avoid long-lived goroutines.
- Critical channel sends (botMove, expire, cleanup) retry once after a short delay if the channel is full, then log `WARN` if the retry also fails. Rationale per channel:
  - `botMove`: retry after 1 s — dropping permanently stalls the game (no player acts on that turn).
  - `expire`: retry after 5 s — dropping leaves disconnected slot in `disconnectedAt` forever.
  - `cleanup`: retry after 30 s — dropping leaks an empty room until restart.
- Non-critical channel sends (per-client `send`, `inbound`) use non-blocking drop + client notification. These are tolerable losses (client can retry; hub must not block).
- `Client.Send` drops messages to a slow client (send buffer cap 256) to prevent head-of-line blocking. Logged at WARN level.
- `readPump` sends to `h.inbound` non-blocking; drops notify the client "server busy". Prevents readPump goroutines from parking on a full channel and deadlocking the `unregister` channel (cap 16).
- Every scheduled callback (`executeBotMove`, `handleExpireReconnect`, `handleCleanup`) re-checks current room/player state before acting and logs the skip reason.
- `http.Server` is configured with `ReadHeaderTimeout: 10s` and `IdleTimeout: 60s` to reclaim stale HTTP connections and guard against Slowloris.
- Goroutine stability is verified by three regression tests in `hub/hub_test.go`:
  - `TestGoroutineStability_RoomLifecycle` — rapid create/teardown (cleanup timer path).
  - `TestGoroutineStability_BotGame` — full bot game to completion.
  - `TestGoroutineStability_FullLifecycle` — all paths: cleanup, full game, mid-game disconnect (reconnect expiry path).

## Structured logging conventions

- All log output uses the standard `log` package to stdout.
- Format: `key=value` pairs on a single line, e.g. `room created code=ABC123 host=Alice`.
- Events logged: player connected (with addr), player disconnected (with code/nickname/playerID), reconnected, reconnect window expired, room created, room deleted, match started (with player count and format), match finished (with winner), WS upgrade errors, scheduled callback skips (bot move skipped, cleanup skipped, reconnect expiry skipped — with reason), channel pressure warnings (`WARN` prefix).
- No sensitive data (tokens, hand contents) in logs.

## i18n conventions

- Translations live in `client/src/i18n/en.ts` (English, source of truth) and `client/src/i18n/fr.ts` (French).
- The `Translations` interface is defined in `en.ts` and re-used as the type for all language files — missing keys cause a TypeScript error.
- `I18nProvider` (in `client/src/i18n/index.tsx`) wraps the app in `main.tsx` and exposes `useI18n()` hook returning `{ lang, t, setLang }`.
- Language detection order: (1) `localStorage.getItem('loco_lang')`, (2) `navigator.language` prefix (`'fr'` → French, else English).
- `setLang` stores the selection to `localStorage` and syncs `document.documentElement.lang` for accessibility.
- To add a new language: create `client/src/i18n/xx.ts` implementing `Translations`, add the entry to the `translations` map in `index.tsx`, and add a `{ code, label }` entry to `LANGS` in `LanguageSwitcher.tsx`.
- The `rules` field uses `readonly RulesSection[]`; sections are rendered by `RulesModal` directly from the translation object.
- Storage key: `'loco_lang'`.

## Rules modal conventions

- `RulesModal` is a full-screen backdrop modal accessible from: Lobby (top-right corner), WaitingRoom (top-right corner), and GameView (action bar "Rules" button).
- Close triggers: ✕ button, footer Close button, backdrop click, `Escape` key.
- On mobile (`max-width: 480px`) the modal slides up from the bottom as a sheet (bottom border-radius 0, max-height 92vh).
- `document.body.style.overflow = 'hidden'` is set while the modal is open and restored on unmount.
- All rules content lives in the translation files; the modal component is content-agnostic.

## Dev Docker Compose conventions

- `docker-compose.dev.yml` provides a hot-reload development environment with no host Go or Node required.
- Backend service: `golang:1.24.7-alpine` image, bind-mounts `./server:/app`, runs `go run .`, port 8080.
- Frontend service: `node:20-alpine` image, bind-mounts `./client:/app`, runs `npm ci && npm run dev`, port 5173 (mapped from container port 3000).
- **No Vite WS proxy**: the browser connects directly to `ws://<host>:8080/ws`. Vite's `http-proxy` WebSocket upgrade is unreliable under Docker networking and has been removed.
- `VITE_WS_PORT=8080` environment variable in the frontend service tells the client which port to use for direct WebSocket connections (defaults to `8080` if unset).
- `useWebSocket.ts` detects `import.meta.env.DEV` and builds the WS URL as `ws://${hostname}:${VITE_WS_PORT}/ws`; production builds use `ws://${host}/ws` (same origin, proxied by nginx).
- `vite.config.ts` has no proxy configuration.
- Go module cache (`go-mod-cache`) and node_modules (`client-node-modules`) are named Docker volumes so restarts do not re-download dependencies.
- Start command: `docker compose -f docker-compose.dev.yml up --build`.

---

## Instructions for future Claude sessions

When starting work:
1. read this file
2. read `README.md`
3. inspect current project structure
4. identify any doc drift before coding
5. use TDD for non-trivial changes
6. update docs in the same change set

Never allow `CLAUDE.md` or `README.md` to become stale.
