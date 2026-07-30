# Implemented Features

## Lobby & rooms
- Auto-generated 6-character human-friendly room codes (collision-free registry; charset excludes `0/O/1/I/l`).
- Join by room code; nickname-only entry (no accounts).
- Real-time lobby with live player list updates.
- Host-only game start.
- Match format selection (BO1/BO3/BO5/BO7), broadcast live in lobby.
- Max-players configuration (2–10), live in lobby; cannot drop below current count.
- Bot players: host adds AI bots; bots play autonomously with card-preference heuristics.

## Gameplay
- 112-card deck (numbers 1–9, Skip, Reverse, +2, Swap, Wild, +4, Global Swap).
- 8-card initial deal; opening discard always a number.
- Legal-move validation (color/number/kind matching).
- Skip, Reverse (Skip-equivalent in 2-player), +2.
- Wild and Wild Draw Four with color choice.
- +2 / +4 stacking (counter chain) and out-of-turn +2 free interrupt.
- Identical-card interrupt with 1.5 s server-enforced window (single + batch).
- Batch identical-card play on your turn (effects compound).
- Swap (colored, opponent hand swap) and Global Swap (rotate all hands in current direction).
- UNO declaration + 5 s server-enforced catch window.
- Single-finisher round scoring (number = face; Reverse = 10; Skip = 20; +2 and Swap = 30; Wild and Global Swap = 40; +4 = 50).
- Multi-round matches with persistent scoreboard.
- Tiebreakers: highest score → rounds won → lowest lost-hand total → sudden-death extra round.
- Win detection (empty hand) and deck replenishment from the discard pile.
- Rematch: once a match is over the host reopens the same room — same code, same roster, cleared scores — instead of everyone rebuilding a room from scratch. Seats with nobody behind them are pruned first.

## UI / UX
- React + Framer Motion game view. All card movement is expressed as GPU-composited `x`/`y`/`rotate` transforms — never `left`/`top` — so multiple cards can fly at once without triggering layout.
- Motion detail: cards fly from the acting player's own seat to the discard pile (so opponents' plays are legible without watching the pile), the hand fan springs closed behind a played card, a fresh deal staggers in, the discard settles with a per-card tilt, and turn-indicator text crossfades.
- `prefers-reduced-motion` is honoured throughout: transforms snap to their end state and CSS transitions are disabled, leaving the game fully playable without movement.
- Round summary overlay with placements, points earned, cumulative scoreboard; auto-dismiss after 8 s or via Continue. Next-round state is buffered so the overlay never vanishes instantly.
- Match-end screen with final scoreboard, winner highlight, host Rematch button, and Leave room.
- UNO reaction timer: countdown bar visible whenever a player declares UNO.
- Reconnect visual recovery: brief "Rebuilding table…" overlay, then staggered entrance of bubbles, hand cards, and discard pile.
- Mobile support: responsive layout, 44 px+ tap targets, 400 ms double-tap guard, touch-friendly wild color picker, `user-scalable=no`.
- Rules modal accessible from Lobby, Waiting Room, and Game View; bottom-sheet on mobile.
- Internationalisation: English + French, automatic browser detection, manual switcher persisted to `localStorage`.

## Server / infra
- Per-player personalized state (hidden hand info never leaks to other clients).
- 60-second reconnect window during active games.
- Client auto-reconnect with linear backoff.
- JSON `GET /health` endpoint (room count, client count, uptime).
- `GET /metrics` endpoint: atomic counters for `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`, `uptime_sec`, `goroutine_count`, `messages_rate_limited`, `messages_dropped_busy`, `slow_clients_closed`, `channel_retries`, `suspected_cheats`, `reconnect_expirations`, `debug_mode_active`.
- Empty-room cleanup: rooms held 5 min after empty, then deleted; rejoin cancels the timer.
- Structured server logging (room/match/connection lifecycle, channel-pressure warnings, suspected cheat).
- Session tokens (128-bit, `crypto/rand`) required for reconnect, preventing slot hijacking.
- Per-client rate limiting (token bucket, 10 msg/s sustained, burst 20).
- AFK auto-kick after consecutive turn-timeouts (~2 rounds in a 2-player game; bots exempt).
- Game event log (`EventLog`, append-only) delivered to reconnecting players for history.
- Docker + docker-compose for both production-style and bind-mounted dev workflows.
