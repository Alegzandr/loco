# Wire Protocol

All messages are JSON over a single WebSocket per player.

## Client → Server

| Type                | Fields                                                   |
|---------------------|----------------------------------------------------------|
| `create_room`       | `nickname`                                               |
| `join_room`         | `nickname`, `room_code`, `session_token` (reconnect)     |
| `start_game`        | —                                                        |
| `add_bot`           | — (host-only)                                            |
| `set_match_format`  | `match_format` (`BO1`/`BO3`/`BO5`/`BO7`) (host-only)     |
| `set_max_players`   | `max_players` (2–10) (host-only)                         |
| `rematch`           | — (host-only; reopens a finished room as a lobby)        |
| `play_card`         | `card`, `chosen_color` — or `play_cards[]` for a batch of identical cards, which takes precedence over `card`. There is no separate `play_cards` message type. |
| `draw_card`         | —                                                        |
| `pass_turn`         | —                                                        |
| `declare_uno`       | —                                                        |
| `catch_uno`         | `target_index` (seat being caught; omitted = the window closest to expiring) |
| `counter_draw`      | `card`, `chosen_color`                                   |
| `interrupt_play_card` (alias `interrupt_play`) | `card?`, `play_cards?` (out-of-turn identical-card interrupt) |

## Server → Client

| Type                  | Key Fields                                                                  |
|-----------------------|-----------------------------------------------------------------------------|
| `room_created`        | `room_code`, `player_id`, `session_token`, `players`, `match_format`, `max_players` |
| `room_joined`         | `room_code`, `player_id`, `session_token`, `players`, `match_format`, `max_players` |
| `lobby_config_changed`| `match_format`, `max_players`                                               |
| `player_joined`       | `nickname`, `players`                                                       |
| `player_left`         | `nickname`, `players`                                                       |
| `player_disconnected` | `player_index`, `nickname`, `players`                                       |
| `player_reconnected`  | `player_index`/`player_id`, `state` (self), `players`                       |
| `game_started`        | `state` (personalized per player; includes `round_number`, `match_format`, `scoreboard`) |
| `card_played`         | `player_index`, `card`, `turn`, `pending_draw`, `players`, `chosen_player` (swap only) |
| `interrupt_success`   | `player_index`, `cards[]` (sent immediately before the matching `card_played`) |
| `card_drawn`          | `cards[]` (drawer only) / `drawn_count` (everyone else), `player_index`, `turn`, `pending_draw`, `has_drawn` |
| `turn_changed`        | `turn`                                                                      |
| `uno_declared`        | `player_index`                                                              |
| `uno_caught`          | `player_index`                                                              |
| `round_end`           | `round_number`, `round_winner`, `scoreboard`, `round_history`               |
| `match_end`           | `match_winner`, `scoreboard`                                                |
| `rematch_started`     | `room_code`, `player_id`, `players`, `match_format`, `max_players` (per-recipient) |
| `game_over`           | `winner` (BO1 / legacy path)                                                |
| `latency`             | `latencies[]` (per-seat round trip; broadcast on a timer to playing rooms)   |
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
- `rematch_started` is sent **per recipient**, not broadcast: the server first prunes seats with no connected client behind them (bots excepted), which can re-base every surviving `player_id`. Clients must adopt the `player_id` they receive.
- `latency` is server-measured: the hub times its own WebSocket ping frames against the pongs the browser answers in the transport layer, smooths them (0.6 old + 0.4 new) and broadcasts every 3 s to rooms that are playing. Nothing is self-reported by the client, and a room where nothing has been measured yet is skipped rather than sent a table of `-1`.
- `round_history` is server-owned so a reconnecting player recovers the same table: cumulative scores cannot be split back into rounds client-side once a player has won twice.
- `play_cards` (turn-time) and `interrupt_play_card` with `play_cards` (out-of-turn) require N identical cards; effects stack: N×+2 = `2N` pending draw, N skips skip N players, N reverses flip parity. Swap and Global Swap cannot batch.
