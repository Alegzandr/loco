# Implemented Features

## Lobby & rooms
- Auto-generated 6-character human-friendly room codes (collision-free registry; charset excludes `0/O/1/I/l`).
- Join by room code; nickname-only entry (no accounts).
- Join by link: the code in the waiting room is a button that copies `<origin>/?t=CODE`, with no language on it (the arriving player's browser decides that). Opening it fills the join form with the code and asks only for a name, or seats the player outright when the browser already remembers one. The parameter is removed from the address bar on arrival, so a reload reclaims the seat rather than re-joining and a copied URL never keeps naming a closed table.
- Real-time lobby with live player list updates.
- Host-only game start.
- Leaving a table before the deal: host and guest alike get a quit button in the waiting room, behind an in-place confirmation (Stay / Yes, leave; Escape stays). Confirmed, the seat is released immediately (`leave_room`) and the rest of the table sees the roster update. Once the cards are out, an ordinary match has no way out.
- The host can free any seat but their own before the deal (`kick_player`): one icon button per roster row, no confirmation, bots included since nothing else takes a bot's seat back. The table sees an ordinary departure and the removed player is told why. It is not a ban — the code is still theirs and they may rejoin. Refused once the cards are out, and in a matchmade room, which has no host.
- Match format selection (BO1/BO3/BO5/BO7), broadcast live in lobby.
- Max-players configuration (2–10), live in lobby; cannot drop below current count.
- **1v1 matchmaking**: a single FIFO queue on the home screen. Two searchers are paired, shown a versus reveal naming their opponent, and dealt in 2.5 s later (a single round) with nobody pressing start. No host, no code, no lobby. The queue's size is never sent to a client in any form; the searching screen times its own wait and restates it at 15 s and 45 s, offering a private table past that. At the end either player may ask for a rematch: both asks are broadcast, and the same two are dealt in again only once both are in. If the opponent leaves instead, there is nobody to agree with, so the player who stayed goes back into the queue by default and cancelling the search is how they leave. No rank, and nothing calls the mode "unranked".
- **Forfeit instead of an empty seat** (matchmade matches only): a dropped opponent is held 15 s rather than 60, with the countdown on the board, and two consecutive turn timeouts end the match instead of four. Either way the match goes to whoever stayed, announced as a forfeit with the scoreboard untouched. Quitting on purpose (`leave_room`) does it immediately. Ordinary rooms keep the 60 s hold and the 4-timeout threshold.
- Bot players: host adds AI bots; bots play autonomously with card-preference heuristics, counter a draw stack, declare LOCO!, call Contre-LOCO! and interject identical cards into an open window like any other player. Every reaction is delayed and probabilistic so they stay beatable.

## Gameplay
- 112-card deck (numbers 1–9, Skip, Reverse, +2, Swap, Wild, +4, Global Switch).
- 8-card initial deal; opening discard always a number.
- Legal-move validation (color/number/kind matching).
- Skip, Reverse (Skip-equivalent in 2-player), +2.
- Wild, Wild Draw Four and Global Switch with color choice (every wild names the new active colour).
- +2 / +4 stacking (counter chain, same card only — same kind and same colour) and out-of-turn +2 free interrupt.
- A forced draw costs cards, not the turn: the victim takes the whole stack and then plays or passes.
- Identical-card interrupt (single + batch). The window has **no deadline**: it opens when a card is played and closes only when somebody draws, passes, or the round ends. Anyone may take it, including the player who just played and the player whose turn it is — it is a race decided by arrival order at the server.
- Batch identical-card play on your turn (effects compound).
- Swap (colored, opponent hand swap) and Global Switch (wild: names a colour, then rotates all hands in current direction).
- UNO declaration + 5 s server-enforced catch window.
- Single-finisher round scoring (number = face; Reverse = 10; Skip = 20; +2 and Swap = 30; Wild and Global Switch = 40; +4 = 50).
- Multi-round matches with persistent scoreboard.
- Tiebreakers: highest score → rounds won → lowest lost-hand total → sudden-death extra round.
- Win detection (empty hand) and deck replenishment from the discard pile.
- Rematch: once a match is over, the table reopens the same room (same code, same roster, cleared scores) instead of everyone rebuilding a room from scratch. It takes an ask from every player still there, not the host's word: each ask is public so nobody presses into silence, a player leaving stops being waited on, and bots are not asked. Seats with nobody behind them are pruned first.

## UI / UX
- Svelte 5 game view, animated by the browser rather than by a runtime. All card movement is expressed as GPU-composited `translate`/`rotate` transforms — never `left`/`top` — so multiple cards can fly at once without triggering layout.
- Motion detail: cards fly from the acting player's own seat to the discard pile (so opponents' plays are legible without watching the pile), the hand fan springs closed behind a played card, a fresh deal staggers in, the discard settles with a per-card tilt, and turn-indicator text crossfades.
- `prefers-reduced-motion` is honoured throughout: transforms snap to their end state and CSS transitions are disabled, leaving the game fully playable without movement.
- Round summary overlay with placements, points earned, cumulative scoreboard; auto-dismiss after 8 s or via Continue. Next-round state is buffered so the overlay never vanishes instantly.
- Match-end screen with final scoreboard, winner highlight, the rematch ask every seat gets (see above — it is not the host's call), and Leave room.
- Score table on held `TAB` (and on a **Scores** button, the only way in on a touch device): one row per seat with its identity colour, one column per finished round, cumulative total, rounds won, and a live ping. The ping is banded by colour (green under 60 ms, yellow under 120, orange under 220, red beyond) because an interrupt is decided by arrival order at the server. Bots are labelled rather than given a fake number, and a seat with no measurement yet says so.
- Play direction ring: chevrons around the felt, chasing the way play is moving and flipping over when a Reverse lands. The heading is carried by the chevrons themselves, so it still reads on a paused clip or with reduced motion, long after the REVERSE callout is gone.
- UNO reaction timer: countdown bar visible whenever a player declares UNO.
- Reconnect visual recovery: brief "Rebuilding table…" overlay, then staggered entrance of bubbles, hand cards, and discard pile.
- Mobile support: responsive layout, 44 px+ tap targets, 400 ms double-tap guard, touch-friendly wild color picker. Zooming is never forbidden: the double-tap is answered by `touch-action: manipulation` on `body`, not by `user-scalable=no`.
- Rules modal accessible from Lobby, Waiting Room, and Game View; bottom-sheet on mobile.
- Internationalisation: English + French, automatic browser detection, manual switcher persisted to `localStorage`.
- Privacy, terms and credits as one content page (`/privacy/`, `/fr/confidentialite/`), linked from every footer (last in the home page's row of links, at the right-hand end of the content pages' bar), in both languages. Three anchored sections; the copy is read at build time and ships in no bundle.

## Server / infra
- Per-player personalized state (hidden hand info never leaks to other clients).
- 60-second reconnect window during active games (15 s in a matchmade 1v1, where it expires into a forfeit).
- Client auto-reconnect with linear backoff.
- JSON `GET /health` endpoint (room count, client count, uptime). Operator-only: nginx does not proxy it, and the container healthcheck reads it from inside.
- `GET /metrics` endpoint: atomic counters for `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`, `uptime_sec`, `goroutine_count`, `messages_rate_limited`, `messages_dropped_busy`, `slow_clients_closed`, `channel_retries`, `suspected_cheats`, `reconnect_expirations`, `matchmaking_queue`, `matches_matchmade`, `debug_mode_active`, `handler_panics`, `conns_refused`, `joins_throttled`, `log_lines_dropped`, and saturation (`loop_queue_depth` and `loop_queue_capacity` for the hub's routing queue, `loop_queue_peak` for the deepest any one table's box has been, `loop_slowest_us` for the longest a single message has taken anywhere, `loop_events`). The two matchmaking counters are the only place the queue's size is readable at all.
- Empty-room cleanup: rooms held 5 min after empty, then deleted; rejoin cancels the timer.
- **One goroutine per table.** The hub owns what is between tables (the map of them, the matchmaking queue, the sockets, the drain) and routes each message to the table it is for; that table's own goroutine handles it. Bought for isolation rather than throughput: one table's slow message is no longer every other table's wait, in a game whose reaction windows are decided by arrival order.
- Structured server logging (room/match/connection lifecycle, queue-pressure warnings, suspected cheat), written **off the event loop** through a bounded asynchronous sink: a slow log consumer can no longer stall the server, and anything the sink has to drop is counted on `/metrics` and admitted in the log.
- Session tokens (128-bit, `crypto/rand`) required for reconnect, preventing slot hijacking.
- Per-client rate limiting (token bucket, 10 msg/s sustained, burst 20).
- Per-seat latency measured server-side from WebSocket ping/pong frames (5 s probe, smoothed), broadcast every 3 s to rooms in play. Browsers answer ping frames in the transport layer, so the number is a real network round trip and no client can report its own.
- Per-round score history kept on the room and exported in every snapshot, so the score table is identical for a reconnecting player.
- AFK auto-kick after consecutive turn-timeouts (~2 rounds in a 2-player game; bots exempt). A matchmade 1v1 halves the threshold and forfeits the match rather than closing the socket, so the opponent is not made to sit through a second wait.
- Game event log (`EventLog`, append-only) delivered to reconnecting players for history.
- Docker + docker-compose for both production-style and bind-mounted dev workflows.
