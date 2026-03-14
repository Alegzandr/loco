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
- add end-to-end coverage for essential happy paths where practical

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
- `shared/` protocol/types if used
- `docs/` optional supplemental docs
- root config / Docker / env files

If structure changes, update this file and the README.

---

## Scoring and match system conventions

- `CardValue(c Card) int` in `game/card.go`: Number = face value; Skip/Reverse/DrawTwo = 20; Wild/WildDrawFour = 50.
- When a player empties their hand, `Room.endRound(winnerIdx)` calculates score = sum of all other players' remaining card values.
- Scores accumulate across rounds in `Room.Scores []int` (indexed by playerID).
- `Room.RoundsWon []int` tracks wins per player; `Room.LostHandTotal []int` tracks losing-hand totals for tiebreaking.
- `Room.RoundEnded bool` is set to `true` by `endRound`; the hub clears it after broadcasting `round_end`.
- `Room.MatchOver bool` + `Room.MatchWinner string` indicate match completion.
- Match formats: BO1=1, BO3=3, BO5=5, BO7=7 (stored as `game.MatchFormat`).
- Tiebreaker order: (1) highest total score → (2) most rounds won → (3) lowest lost-hand total → (4) sudden-death extra round.
- If `determineMatchWinner()` returns `""`, a sudden-death extra round is played automatically.
- Hub broadcasts `round_end` (with scoreboard) then `game_started` (new round state) to each player when a round ends mid-match.
- Hub broadcasts `match_end` (with scoreboard + match_winner) when the match is fully over.

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

## CI/CD conventions

- Pipeline defined in `.gitlab-ci.yml` with three stages: `test` → `build` → `deploy`.
- `test` stage has two jobs that run on **every push** using lightweight images (no Docker daemon):
  - `backend_test` (`golang:1.24.7-alpine`): `cd server && go test ./...`
  - `frontend_test` (`node:20-alpine`): `cd client && npm ci && npm run test && npm run build`
- `build` stage (Docker image builds) only runs on `develop` branch or `v*` tags, and only after all test jobs pass (`needs: [backend_test, frontend_test]`).
- Deploy jobs require the `devops` runner tag and a GitLab container registry.
- Both test jobs must pass before Docker images are built or deployed.

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
- `GameView` shows the summary with: round number/total, winner, per-player round breakdown (delta points, cumulative, wins), and full match scoreboard (for BO3+).
- The summary has a "Continue (Ns)" button that calls `dismissRoundSummary()`, which applies the buffered state and clears the summary.
- Auto-dismiss fires after 8 seconds if the player does not click Continue.
- `dismissRoundSummary` applies `pendingGameState` if present, else just clears `showRoundSummary`.

## Metrics conventions

- `GET /metrics` returns JSON with atomic counters: `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`, `uptime_sec`.
- All counters are `sync/atomic.Int32` fields on `Hub`; `GetMetrics()` reads them without entering the event loop.
- `statMatchesStarted` incremented in `handleStartGame` (once per `start_game` message, not per round).
- `statMatchesFinished` incremented in `handleRoundOrMatchEnd` when `room.MatchOver` is true.
- `statBotsActive` incremented in `handleAddBot`; decremented in `deleteRoom` by the number of bots in that room.

## Room lifecycle cleanup conventions

- `hub.EmptyRoomTimeout` (exported `var`, default 5 minutes) controls how long an empty room is kept before deletion.
- When a room becomes empty (last member disconnects from lobby/finished, or all slots go nil in an active game), `scheduleRoomCleanup(code)` is called.
- `scheduleRoomCleanup` records `emptyRooms[code] = time.Now()` and starts a goroutine that sends a `cleanupMsg` after `EmptyRoomTimeout`.
- `handleCleanup` deletes the room only if `emptyRooms[code]` still matches the recorded time (race-safe: any rejoin clears or changes the entry).
- Rejoining (lobby join) or reconnecting (active game) calls `delete(h.emptyRooms, code)` to cancel the cleanup.
- `deleteRoom(code)` is the single point of room deletion: cleans up all hub maps, adjusts `statRooms` and `statBotsActive`, and emits a structured log line.
- Tests override `EmptyRoomTimeout` to a short value (e.g. 80 ms) via `hub.EmptyRoomTimeout = ...` and restore it with `t.Cleanup`.

## Structured logging conventions

- All log output uses the standard `log` package to stdout.
- Format: `key=value` pairs on a single line, e.g. `room created code=ABC123 host=Alice`.
- Events logged: player connected (with addr), player disconnected (with code/nickname/playerID), reconnected, room created, room deleted, match started (with player count and format), match finished (with winner), WS upgrade errors.
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
- `VITE_WS_TARGET=ws://server:8080` environment variable in the frontend service routes the Vite WebSocket proxy to the backend container (instead of localhost).
- `vite.config.ts` reads `process.env.VITE_WS_TARGET` for the proxy target (falls back to `ws://localhost:8080` for local dev without Docker).
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
