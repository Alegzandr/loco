# Wire Protocol

All messages are JSON over a single WebSocket per player.

**`server/protocol/` is the source.** `messages.go` holds the envelopes and DTOs, `enums.go` the wire
enums (pinned to the domain by `enums_test.go`), and `make protocol` generates the client's
`src/types/protocol.ts` and `src/types/protocolSchemas.ts` from them. Those two files carry a
"do not edit" header and CI fails on any difference. This page is prose for humans and is the one
description of the wire that a program does not check: when it disagrees with the Go, the Go wins.

## Client → Server

| Type                | Fields                                                   |
|---------------------|----------------------------------------------------------|
| `create_room`       | `nickname`                                               |
| `join_room`         | `nickname`, `room_code`, `session_token` (reconnect)     |
| `start_game`        | —                                                        |
| `add_bot`           | — (host-only)                                            |
| `set_match_format`  | `match_format` (`BO1`/`BO3`/`BO5`/`BO7`) (host-only)     |
| `set_max_players`   | `max_players` (2–10) (host-only)                         |
| `kick_player`       | `target_index` (seat to free; host-only, lobby-only, never seat 0) |
| `transfer_host`     | `target_index` (seat to hand the table to; host-only, lobby-only, never seat 0, never a bot) |
| `rematch`           | — (one seat's ask for another match; every room, every seat) |
| `find_match`        | `nickname` (enter the 1v1 queue)                         |
| `cancel_matchmaking`| —                                                        |
| `leave_room`        | — (give up the seat without dropping the socket; a forfeit in a matchmade match in progress) |
| `play_card`         | `card`, `chosen_color` — or `play_cards[]` for a batch of identical cards, which takes precedence over `card`. There is no separate `play_cards` message type. |
| `draw_card`         | —                                                        |
| `pass_turn`         | —                                                        |
| `declare_uno`       | —                                                        |
| `catch_uno`         | `target_index` (seat being caught; omitted = the window closest to expiring) |
| `counter_draw`      | `card`, `chosen_color`                                   |
| `interrupt_play_card` (alias `interrupt_play`) | `card?`, `play_cards?`, `declare_loco?` (out-of-turn identical-card interrupt) |

## Server → Client

| Type                  | Key Fields                                                                  |
|-----------------------|-----------------------------------------------------------------------------|
| `room_created`        | `room_code`, `player_id`, `session_token`, `players`, `match_format`, `max_players` |
| `room_joined`         | `room_code`, `player_id`, `session_token`, `players`, `match_format`, `max_players` |
| `lobby_config_changed`| `match_format`, `max_players`                                               |
| `player_joined`       | `nickname`, `players`                                                       |
| `host_changed`        | `nickname` (the new host), `players`, `player_id` (the recipient's own seat) — sent per recipient, because the swap moves two seats |
| `player_left`         | `nickname`, `players`                                                       |
| `player_disconnected` | `player_index`, `nickname`, `players`, `forfeit_deadline` (matchmade rooms only) |
| `player_reconnected`  | `player_index`/`player_id`, `state` (self), `players`, `session_token` (self)  |
| `game_started`        | `state` (personalized per player; includes `round_number`, `match_format`, `scoreboard`) |
| `card_played`         | `player_index`, `card`, `turn`, `pending_draw`, `players`, `chosen_player` (swap only) |
| `interrupt_success`   | `player_index`, `cards[]` (sent immediately before the matching `card_played`) |
| `card_drawn`          | `cards[]` (drawer only) / `drawn_count` (everyone else), `player_index`, `turn`, `pending_draw`, `has_drawn` |
| `turn_changed`        | `turn`                                                                      |
| `uno_declared`        | `player_index`                                                              |
| `uno_caught`          | `player_index`                                                              |
| `round_end`           | `round_number`, `round_winner`, `scoreboard`, `round_history`               |
| `match_end`           | `match_winner`, `scoreboard`, `forfeit`, `player_index` (the seat that left, on a forfeit) |
| `rematch_started`     | `room_code`, `player_id`, `players`, `match_format`, `max_players` (per-recipient) |
| `matchmaking_queued`  | — (deliberately empty: see the notes)                                       |
| `rematch_offered`     | `rematch_offers[]`, `rematch_needed`, `player_index` (whoever just asked; absent when the change was a departure) |
| `matchmaking_cancelled` | —                                                                        |
| `match_found`         | `room_code`, `player_id`, `session_token`, `players`, `match_format`, `max_players`, `starts_in_ms` (per-recipient) |
| `left_room`           | — (acknowledges `leave_room`)                                               |
| `kicked`              | — (the host freed this client's seat; sent to the removed client only)      |
| `game_over`           | `winner` (BO1 / legacy path)                                                |
| `latency`             | `latencies[]` (per-seat round trip; broadcast on a timer to playing rooms)   |
| `server_updating`     | — (this process is being replaced; the match is unaffected: see the notes)   |
| `error`               | `error`                                                                     |

## DTO shapes

- `PlayerDTO`: `index`, `nickname`, `hand_size`, `connected`.
- `LatencyEntryDTO`: `player_index`, `rtt_ms` (-1 = nothing measured), `bot`.
- `GameStateDTO`: includes `event_log` (capped to last 50 entries, **sent only on the reconnect snapshot**: it is the one unbounded field in a per-recipient payload and no client reads it during play), `round_number`, `match_format`, `max_players`, `scoreboard` (cumulative per-player scores), `round_history` (`round_history[k][player_index]` = points scored in round k+1), and the player's own hand.

## Notes

- `card_played` carries `chosen_player` only for `swap` (target seat index). `global_switch` and other cards omit it.
- `chosen_color` is required for **every** wild (`wild`, `wild_draw_four` **and** `global_switch`) on `play_card`, `play_cards`, `counter_draw` and `interrupt_play_card`. A colourless wild is rejected (`must choose a color for a wild card`); the value `wild` counts as colourless, since it matches no coloured card and would strand the whole table.
- `interrupt_success` is emitted before the corresponding `card_played` so the client can render lead-taking distinctly.
- `pending_draw` and `has_drawn` describe the **table** after the event, not the recipient, and `card_played` / `card_drawn` carry both to every seat. They are nullable on the wire on purpose: a hand can grow without anybody having drawn on their turn (the LOCO-catch penalty), so a missing `has_drawn` must mean "unchanged" and never be defaulted to `true` — a client that guessed it disabled its own draw button and had every pass refused with `you must draw a card before passing`.
- `player_id` is the **recipient's own seat** and is nullable on the wire for the same reason as `player_index`: `omitempty` drops a zero, and seat 0 is the host's. A client must not default an absent `player_id` to 0: it happened to be right while every reader already had an earlier value to fall back on, and stopped being right the moment a reloaded tab reclaimed a seat with no prior state (it seated itself at -1). `player_reconnected` also carries `state.your_index`, which is the same seat and always present.
- A reconnecting client sends `join_room` with `nickname` + `room_code` + `session_token` whether it lost the socket or the whole page; the server cannot tell the two apart, and deliberately does not need to.
- **A reclaim spends its token.** `player_reconnected` carries a fresh `session_token` and the client must store it: the one that opened the seat stops working. The old token has been on a socket that died, it is in `sessionStorage`, and if the process restarted on the way it has also been written to the shutdown snapshot on disk, so a one-shot proof is worth more than a permanent one and costs nothing.
- **A refused reclaim is indistinguishable from a refused join.** Both answer `game already in progress`. They used to differ (`invalid session token for reconnect` came back only when the nickname matched a seat actually held at that table), which let anyone holding a table code test names against it. The client owns the failed-reclaim case through its own restore timeout, so nothing legitimate read the difference.
- `rematch_started` is sent **per recipient**, not broadcast: the server first prunes seats with no connected client behind them (bots excepted), which can re-base every surviving `player_id`. Clients must adopt the `player_id` they receive.
- `latency` is server-measured: the hub times its own WebSocket ping frames against the pongs the browser answers in the transport layer, smooths them (0.6 old + 0.4 new) and broadcasts every 3 s to rooms that are playing. Nothing is self-reported by the client, and a room where nothing has been measured yet is skipped rather than sent a table of `-1`.
- `round_history` is server-owned so a reconnecting player recovers the same table: cumulative scores cannot be split back into rounds client-side once a player has won twice.
- **`matchmaking_queued` carries nothing, and that is the design.** No queue size, no position, no
  estimated wait, on any message. The number is available to an operator on `/metrics`
  (`matchmaking_queue`) and nowhere else: a client that could render it would eventually render "1",
  which reads as "close the tab" at exactly the moment the queue is trying to fill. The searching
  screen times its own wait locally instead.
- `match_found` does the work `room_joined` does (room, seat, token, roster, format) and adds
  `starts_in_ms`: the match deals itself after that delay with nobody pressing start. Absent means
  "immediately": the countdown is presentation, and the authoritative start is the `game_started`
  that follows.
- A **matchmade** room has no host. `add_bot`, `start_game`, `set_match_format`, `set_max_players`,
  `kick_player` and `transfer_host` are all refused in one with `not available in a matchmade game`.
- **`kick_player` is a departure to the table and a message to the player.** The room sees the
  ordinary `player_left` (roster re-based, seats above the freed one moved down); the removed client
  gets `kicked` on its own socket, because a table disappearing with no explanation reads as a bug.
  It is refused off the lobby (`can only remove players in the lobby`), from any seat but 0
  (`only the room owner can remove players`), and on seat 0 itself or any seat the room does not have
  (`invalid player index`). A seat with no socket behind it is a bot, and removing it is the only way
  to take one back. It is **not** a ban: the removed player still has the code and may rejoin.
- **`transfer_host` is a seat swap, not a flag.** The host is seat 0 and nothing else, so the two
  seats exchange places and every host control answers to the other player from the acknowledgement
  onwards. `host_changed` goes out **per recipient** carrying that client's own `player_id`: half the
  room's seat number changed, and the two players who moved cannot read their row off the roster
  alone. Refused off the lobby (`can only hand over the table in the lobby`), from any seat but 0
  (`only the room owner can hand over the table`), on seat 0 or a seat the room does not have
  (`invalid player index`), and on a bot (`a bot cannot host the table` — a table whose host cannot
  press start can never deal). The roster's `is_bot` is what lets a client not offer it in the first
  place.
- **`rematch` is an ask, not a decision, in every room.** Any seat sends it, every ask is broadcast as
  `rematch_offered` (so the players who have not answered know somebody is waiting on them), and the
  next match is dealt only once everybody still connected has asked. What that deal is depends on the
  room: a matchmade pair gets a fresh `match_found` and the same reveal, an ordinary table gets
  `rematch_started` back to its waiting room, where the host still owns the format, the size and the
  start. In a matchmade room, asked for after the opponent has gone, it is refused with
  `your opponent has left the table`; an ordinary table has no such floor, since whoever is left can
  reopen the room and wait in it.
- **`rematch_offered` carries the whole state, never the increment.** A seat leaving retires its ask
  and re-bases the ones above it exactly as every other `player_id`-keyed structure is re-based, so a
  client accumulating seat numbers would keep a departed player's ask forever and wait on a count
  that can never complete. `rematch_offers` may legitimately be **empty**, which is why it is
  nullable on the wire rather than `omitempty`-dropped. A departure that completes what is left of
  the agreement deals the next match on the spot: nobody waits on somebody who is not there.
- `match_end` with `forfeit: true` means the match ended because a seat stopped being there, not
  because a round was won; `player_index` names that seat. The scoreboard is unchanged: no points are
  invented for a round nobody finished.
- `forfeit_deadline` rides `player_disconnected` **only in a matchmade room**, where the hold is 15 s
  and the player still at the table is owed a countdown. An ordinary room sends no deadline and the
  seat is simply held for 60 s.
- **`server_updating` carries nothing and asks for nothing.** It is sent once to every table in
  progress when the process is asked to shut down, and again to anyone who reconnects while it is
  still draining. The match plays out unchanged; if the process is replaced before the last card, the
  restart costs the one-second reconnect the client already does on its own. Meanwhile every action
  that would start a *new* match is refused with `server updating, try again in a moment`, including
  `join_room` on a table this process does not have: the code the player typed was almost certainly
  real, and answering `room not found` there blames them for a deploy. See `docs/deployment.md`.
- `play_cards` (turn-time) and `interrupt_play_card` with `play_cards` (out-of-turn) require N identical cards; effects stack: N×+2 = `2N` pending draw, N skips skip N players, N reverses flip parity. Swap and Global Switch cannot batch.
- `declare_loco` is the LOCO! call carried by a batch that **empties the hand** — the one finish that never passes through a single card, so no catch window ever opens on it and no earlier declaration was possible (`docs/rules.md` §14.7). Without it the server refuses the batch (`must call LOCO! before playing your last card`); with it the table gets `uno_declared` immediately before `card_played`. It is ignored on every other play: a finish from a hand already down to one card is gated on a declaration that already happened, so setting the flag there buys nothing.
