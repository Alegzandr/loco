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
| `play_card`         | `card`, `chosen_color`                                   |
| `play_cards`        | `cards[]` (batch identical play; takes precedence over `card`) |
| `draw_card`         | —                                                        |
| `pass_turn`         | —                                                        |
| `declare_uno`       | —                                                        |
| `catch_uno`         | —                                                        |
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
| `card_drawn`          | `card` (own hand only), `player_index`, `turn`                              |
| `turn_changed`        | `turn`                                                                      |
| `uno_declared`        | `player_index`                                                              |
| `uno_caught`          | `player_index`                                                              |
| `round_end`           | `round_number`, `round_winner`, `scoreboard`                                |
| `match_end`           | `match_winner`, `scoreboard`                                                |
| `game_over`           | `winner` (BO1 / legacy path)                                                |
| `error`               | `error`                                                                     |

## DTO shapes

- `PlayerDTO`: `index`, `nickname`, `hand_size`, `connected`.
- `GameStateDTO`: includes `event_log` (capped to last 50 entries on export, used for reconnect history), `round_number`, `match_format`, `max_players`, `scoreboard` (cumulative per-player scores), and the player's own hand.

## Notes

- `card_played` carries `chosen_player` only for `swap` (target seat index). `global_switch` and other cards omit it.
- `interrupt_success` is emitted before the corresponding `card_played` so the client can render lead-taking distinctly.
- `play_cards` (turn-time) and `interrupt_play_card` with `play_cards` (out-of-turn) require N identical cards; effects stack: N×+2 = `2N` pending draw, N skips skip N players, N reverses flip parity. Swap and Global Swap cannot batch.
