# `loco-game` API

The pure domain: the rules of LOCO!, with no clock, no I/O and no OS randomness. The rules, the
reasoning and the bugs behind them are in
[`docs/notes/domain-rules.md`](../../../docs/notes/domain-rules.md); this file is the map of the
crate's entry points, and the reasons they are shaped the way they are.

## The shape

- **One way in.** A `Room` is owned by exactly one table task, and every command is a `&mut self`
  method that validates first and mutates second, so a command that returns `Err` has left the room
  exactly as it was (the proptests hold every command to that). The task reads what it broadcasts off
  the room afterwards; a command returns only what the room cannot tell it later (`was_host`, a
  `CatchCharge`, a lockout's end). A functional `Room::apply(&self, Action, now) -> (Room,
  Vec<Event>)` once stood beside the commands. Nothing used it, it cost a clone per message, and two
  entry points that must never disagree are one too many: it is gone. A clone before the call is the
  "previous state" wherever a test or a replay wants one.
- **Time is data.** Every command that stamps or compares an instant takes `now: Millis` (Unix ms)
  last. An instant that may not exist is `Option<Millis>`, never a sentinel instant.
- **The room's randomness cannot be missing.** `Room::new(code, seed: [u8; 32])` (the hub draws the
  bytes from the OS) or `Room::from_u64_seed` (tests and fixtures only). `Room` is not serde: the drain
  snapshot is `SavedRoom`, which carries no source, and `SavedRoom::restore(seed)` is the only way
  back to a `Room`. A room without a source is unrepresentable. Bots take their source as a
  parameter.
- **Seats are `Seat = usize`, and "nobody" is `Option<Seat>`**, in memory and in the snapshot alike.
  A newtype was weighed and declined: every seat is a `Vec` index, the hub's seats are `usize`, and a
  wrapper would be unwrapped at every one of those indexes. A `-1` sentinel was the bug class
  (`chosen_player >= 0` checks, "last played by < 0"), and `Option` removes it. A signed seat exists
  only on the wire (`loco-protocol`), converted by the hub at that border.
- **One record per seat.** `GameState.seats: Vec<SeatState>` holds what a seat owes and is owed
  (`retired`, `declared`, `last_card_at`, `catch_paid_for`, `catch_locked_until`, `near_left_at`),
  serialised as it is. The hands stay apart on purpose: a Swap or a GlobalSwitch moves hands between
  seats while every obligation stays with the chair.
- **The snapshot is plain serde.** `SavedRoom`, `GameState`, `SeatState`, `Hand`, `Deck`, `Card` and
  `GameEvent` derive it with their field names as written: instants are integer `Millis`, absences
  are `null`. Nothing here is on the wire; `loco-protocol`'s DTOs are.
- **Refusals have one kind.** `GameError`'s `Display` is a wire contract, byte for byte
  (`client/src/i18n/serverErrors.ts` matches it by regex); `GameError::kind()` returns its one
  `ErrorKind`.
- **Values that cannot be wrong.** `MatchFormat` is an enum (`TryFrom<i64>` owns the
  `invalid match format: N` refusal); `Color`, `Kind`, `Status` serialise as their integer
  discriminants through `serde_repr`; maps, hours and skies are serde enums with `FromStr`/`Display`.

## Commands (`Room`, `src/room.rs`)

| Command | Notes |
| --- | --- |
| `Room::new(code, seed)` | A lobby |
| `join(&str)` | |
| `set_format(MatchFormat)` | A bad number is `MatchFormat::try_from(n)`'s refusal |
| `set_max_players(usize)` | |
| `swap_lobby_players(a, b)` | The host transfer's half of the work |
| `remove_lobby_player(i) -> Result<bool, _>` | `true` when the seat was the host |
| `start(now)` | |
| `play_card(p, card, color, target: Option<Seat>, now)` | |
| `play_cards(p, &cards, color, target, declare, now)` | A batch, on the seat's own turn |
| `interrupt_play(p, &cards, color, target, now)` | One card; a list so a batch can be refused |
| `counter_draw(p, card, color, now)` | |
| `draw_card(p, now)`, `pass_turn(p, now)` | |
| `declare_last_card(p, now)` | |
| `catch_undeclared(c, t, now)` | |
| `penalize_failed_catch(c, now) -> CatchCharge::{Free, Charged { drawn }}` | |
| `lock_catch(c, now) -> Option<Millis>` | |
| `catch_locked(c, now)`, `catch_locked_at(c) -> Option<Millis>` | |
| `catch_offered(c, now)` | |
| `forfeit_to(w, now)` | |
| `retire_seat(p, now)`, `is_retired(p)` | |
| `begin_next_round(now)` | |
| `reset_for_rematch()` | |
| `SavedRoom::from(&room)` / `saved.restore(seed)` | The drain snapshot, out and back |

## Reads (`GameState`, `src/state.rs`)

| Read | Notes |
| --- | --- |
| `catchable_targets(now) -> Vec<Seat>` | Who is on the hook |
| `catch_window_end(i) -> Option<Millis>` | |
| `seat(i).declared`, `seat(i).last_card_at`, … | One record per seat |
| `last_play_by: Option<Seat>` | `None` for the deal or a closed window |
| `apply_effect`, `rules::can_play` | |
| `next_turn`, `rotate_seats`, `is_retired`, `active_seats` | Every one steps over a retired seat |

## Errors (`src/error.rs`)

| `ErrorKind` | Refusals |
| --- | --- |
| `StaleState` | `NotYourTurn`, `IllegalPlay`, `CardNotInHand`, `MustAnswerPenalty`, `NotEnoughCopies` |
| `LostRace` | `AlreadyDrawn`, `MustDrawBeforePass`, the three interrupt refusals, `CatchLocked`, `MustDeclareLoco` |
| `MissedCatch` | `AlreadyDeclared`, `CatchWindowExpired`, `TargetNotSingleCard` |
| `NicknameRejected` | The three nickname rules (the wire says only `error::NICKNAME_REJECTED`) |
| `Invalid` | Everything else |

`ErrorKind::is_honest()` is `LostRace | MissedCatch`: what keeps a refusal off the suspected-cheats
metric. A late catch is as honest as a lost interject, and the hub charges every missed catch
before it could count one as suspect.

## Bots (`src/bot.rs`), nicknames, maps

| Entry point | Notes |
| --- | --- |
| `bot_think(&state, p, &mut rng) -> BotAction` | `target: Option<Seat>` |
| `bot_interrupt(&state, p) -> Option<BotInterruptAction>` | One card |
| `validate_nickname`, `contains_blocked_term` | |
| `maps::MAP_IDS`, `maps::MAP_WEATHERS`, `"x".parse::<MapId>()` | |

## Constants read by client tests (plain literals, one per line)

`room.rs`: `DEFAULT_MAX_PLAYERS`, `SERVER_MIN_PLAYERS`, `SERVER_MAX_PLAYERS`, `INITIAL_HAND_SIZE`,
`CATCH_NEAR_HAND`, `CATCH_GRACE_MS`, `CATCH_NEAR_GRACE_MS` (and `CATCH_WINDOW_MS`, `CATCH_LOCKOUT_MS`).
`deck.rs`: `DECK_SIZE`, `NUMBER_LOW`, `NUMBER_HIGH`. `card.rs`: `card_value`'s arms.
`nickname.rs`: `NICKNAME_MAX_RUNES`. `maps.rs`: `MAP_IDS`, `MAP_WEATHERS`, each id's `as_str` arm.
